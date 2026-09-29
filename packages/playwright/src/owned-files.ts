import { constants } from 'node:fs';
import { lstat, open, rm, link, unlink } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import { runBounded, RecoveryJournal, type RecoveryIdentity, type RecoveryOptions, type RecoveryRecord } from '@azerish25-ux/forgeqa-core';
import type { Download } from '@playwright/test';

export interface OwnedFileRecoveryOptions extends RecoveryOptions {
  identity?: RecoveryIdentity;
  journal?: RecoveryJournal;
}
/** Private recoverable files, never an arbitrary caller-selected deletion directory. */
export class OwnedFiles {
  readonly directory: string;
  readonly maxBytes: number;
  #device: number;
  #inode: number;
  #closed = false;
  #pending = new Set<Promise<unknown>>();
  #closing?: Promise<void>;
  #journal: RecoveryJournal;
  #record: Readonly<RecoveryRecord>;
  #ownsJournal: boolean;

  private constructor(directory: string, device: number, inode: number, maxBytes: number, journal: RecoveryJournal, record: Readonly<RecoveryRecord>, ownsJournal: boolean) {
    this.directory = directory; this.#device = device; this.#inode = inode; this.maxBytes = maxBytes;
    this.#journal = journal; this.#record = record; this.#ownsJournal = ownsJournal;
  }

  static async create(maxBytes = 10 * 1024 * 1024, recovery: OwnedFileRecoveryOptions = {}): Promise<OwnedFiles> {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 64 * 1024 * 1024) throw new RangeError('Invalid owned-file size limit.');
    const journal = recovery.journal ?? await RecoveryJournal.create(recovery.identity ?? {
      runId: randomUUID(), consumer: 'owned-files', namespace: `files-${randomUUID()}`,
    }, recovery);
    const { directory, record } = await journal.createDirectory();
    const metadata = await lstat(directory);
    return new OwnedFiles(directory, metadata.dev, metadata.ino, maxBytes, journal, record, !recovery.journal);
  }

  async #check(): Promise<void> {
    await this.#journal.verify();
    const metadata = await lstat(this.directory);
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.dev !== this.#device || metadata.ino !== this.#inode) {
      throw new Error('Owned temporary directory was replaced; refusing filesystem access.');
    }
  }

  #name(name: string): string {
    if (!name || name.length > 180 || basename(name) !== name || /[\\/:\x00-\x1f\x7f]/u.test(name)
      || name === '.' || name === '..' || /[. ]$/u.test(name) || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/iu.test(name)) {
      throw new Error('Unsafe owned-file name.');
    }
    return join(this.directory, name);
  }

  #track<T>(operation: () => Promise<T>): Promise<T> {
    if (this.#closed) return Promise.reject(new Error('Owned files are closed.'));
    const task = operation();
    this.#pending.add(task);
    void task.then(() => this.#pending.delete(task), () => this.#pending.delete(task));
    return task;
  }

  async write(name: string, data: string | Uint8Array): Promise<string> {
    const path = this.#name(name);
    const bytes = typeof data === 'string' ? Buffer.from(data) : data;
    if (bytes.byteLength > this.maxBytes) throw new Error('Owned-file size limit exceeded.');
    return this.#track(async () => {
      await this.#check();
      const temporary = join(this.directory, `.writing-${randomUUID()}`);
      const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
      try {
        await file.writeFile(bytes);
        await file.sync();
        await file.close();
        // Publish complete contents without overwriting an existing file or symlink.
        await link(temporary, path);
      } finally {
        await file.close();
        await unlink(temporary);
      }
      return path;
    });
  }

  async read(name: string): Promise<Buffer> {
    const path = this.#name(name);
    return this.#track(async () => {
      await this.#check();
      const metadata = await lstat(path);
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || metadata.size > this.maxBytes) throw new Error('Unsafe owned file.');
      const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const actual = await file.stat();
        if (actual.dev !== metadata.dev || actual.ino !== metadata.ino || actual.size > this.maxBytes) throw new Error('Owned file changed during access.');
        // A bounded read remains bounded even if another process grows the file.
        const bytes = Buffer.alloc(Math.min(this.maxBytes + 1, actual.size + 1));
        const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
        if (bytesRead > this.maxBytes || bytesRead !== actual.size) throw new Error('Owned file changed or exceeded its size limit.');
        return bytes.subarray(0, bytesRead);
      } finally { await file.close(); }
    });
  }

  async saveDownload(download: Download, name = download.suggestedFilename(), timeoutMs = 30_000): Promise<string> {
    const path = this.#name(name);
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) throw new RangeError('Invalid download deadline.');
    return this.#track(async () => {
      await this.#check();
      const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
      let bytes = 0;
      try {
        await runBounded(async signal => {
          const source = await download.createReadStream();
          if (!source) throw new Error('Download has no readable stream.');
          if (signal.aborted) { source.destroy(); signal.throwIfAborted(); }
          const limit = this.maxBytes;
          await pipeline(source, new Transform({ transform(chunk: Buffer, _encoding, done) {
            bytes += chunk.length;
            done(bytes > limit ? new Error('Download size limit exceeded.') : null, bytes > limit ? undefined : chunk);
          } }), file.createWriteStream(), { signal });
          const failure = await download.failure();
          if (failure) throw new Error('Browser download failed.');
        }, timeoutMs, 'Browser download');
        return path;
      } catch (error) {
        const failures: unknown[] = [error];
        try { await runBounded(() => download.cancel(), 5_000, 'Download cancellation'); } catch (cancelError) { failures.push(cancelError); }
        try { await file.close(); await rm(path, { force: true }); } catch (cleanupError) { failures.push(cleanupError); }
        if (failures.length > 1) throw new AggregateError(failures, 'Download and cleanup failed.');
        throw error;
      }
    });
  }

  close(): Promise<void> {
    this.#closed = true;
    if (!this.#closing) this.#closing = (async () => {
      await Promise.allSettled([...this.#pending]);
      await this.#check();
      // rm does not follow child symlinks; the private root identity was checked above.
      await rm(this.directory, { recursive: true, force: false });
      await this.#journal.complete(this.#record);
      if (this.#ownsJournal) await this.#journal.close();
    })();
    return this.#closing;
  }
}
