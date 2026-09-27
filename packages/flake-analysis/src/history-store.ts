import { open, mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { ConfigurationError, IntegrityError } from '@azerish25-ux/forgeqa-core';
import {
  DEFAULT_HISTORY_MAX_BYTES,
  createHistoryRecord,
  emptyHistoryManifest,
  historyManifestChecksum,
  isHistoryRecordValue,
  readBoundedHistoryJson,
  validateHistoryManifest,
  validateHistoryRecord,
  validateHistoryResult
} from './history-record.js';
import type {
  HistoryManifest,
  HistoryManifestEntry,
  HistoryProvenance,
  HistoryRecord,
  ImportHistoryOptions,
  ImportHistoryResult
} from './history-types.js';

const DEFAULT_MAX_RECORDS = 500;
const DEFAULT_MAX_AGE_DAYS = 90;
const LOCK_ATTEMPTS = 80;

function safe(root: string, file: string): string {
  const base = resolve(root);
  const full = resolve(base, file);
  const rel = relative(base, full);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new IntegrityError('History path escapes storage root.');
  return full;
}

async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, content, { flag: 'wx', mode: 0o600 });
  await rename(temp, path);
}

async function pause(milliseconds: number): Promise<void> {
  await new Promise<void>(resolvePromise => setTimeout(resolvePromise, milliseconds));
}

async function withStoreLock<T>(root: string, action: () => Promise<T>): Promise<T> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const lockPath = safe(root, '.history-import.lock');
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt += 1) {
    try {
      handle = await open(lockPath, 'wx', 0o600);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      await pause(Math.min(250, 10 + attempt * 5));
    }
  }
  if (!handle) throw new IntegrityError('Timed out acquiring the history import lock.');
  try {
    await handle.writeFile(`${process.pid}\n`, 'utf8');
    return await action();
  } finally {
    await handle.close();
    await rm(lockPath, { force: true });
  }
}

async function loadManifest(root: string, now: Date): Promise<HistoryManifest> {
  const path = safe(root, 'manifest.json');
  try {
    return validateHistoryManifest(await readBoundedHistoryJson(path));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyHistoryManifest(now);
    throw error;
  }
}

function entryFor(record: HistoryRecord): HistoryManifestEntry {
  return {
    importKey: record.importKey,
    file: `records/${record.importKey}.json`,
    runId: record.result.runId,
    repository: record.result.revision.repository,
    testedCommit: record.result.revision.testedCommit,
    provenance: record.provenance,
    observedAt: record.observedAt,
    checksum: record.checksum
  };
}

async function resolveSource(path: string): Promise<string> {
  const resolved = resolve(path);
  const sourceStat = await stat(resolved);
  if (sourceStat.isFile()) return resolved;
  if (!sourceStat.isDirectory()) throw new IntegrityError(`History source is not a file or directory: ${path}`);
  for (const candidate of ['history-record.json', 'report.json']) {
    const file = resolve(resolved, candidate);
    try {
      if ((await stat(file)).isFile()) return file;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  throw new IntegrityError(`History directory contains neither history-record.json nor report.json: ${path}`);
}

async function sourceRecord(path: string, options: Required<Pick<ImportHistoryOptions, 'provenance' | 'maxBytes'>> & { now: Date }): Promise<HistoryRecord> {
  const file = await resolveSource(path);
  const value = await readBoundedHistoryJson(file, options.maxBytes);
  if (isHistoryRecordValue(value)) return validateHistoryRecord(value);
  return createHistoryRecord(validateHistoryResult(value), options.provenance, options.now.toISOString());
}

async function persistRecord(root: string, record: HistoryRecord): Promise<void> {
  const path = safe(root, `records/${record.importKey}.json`);
  try {
    const existing = await readHistory(path);
    if (existing.checksum !== record.checksum) throw new IntegrityError(`Conflicting history record already exists for ${record.importKey}.`);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await atomicWrite(path, `${JSON.stringify(record, null, 2)}\n`);
}

function retention(entries: HistoryManifestEntry[], now: Date, maxRecords: number, maxAgeDays: number): { kept: HistoryManifestEntry[]; removed: HistoryManifestEntry[] } {
  const cutoff = now.getTime() - maxAgeDays * 86_400_000;
  const ordered = [...entries].sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt) || a.importKey.localeCompare(b.importKey));
  const kept: HistoryManifestEntry[] = [];
  const removed: HistoryManifestEntry[] = [];
  for (const entry of ordered) {
    if (kept.length < maxRecords && Date.parse(entry.observedAt) >= cutoff) kept.push(entry);
    else removed.push(entry);
  }
  kept.sort((a, b) => a.importKey.localeCompare(b.importKey));
  return { kept, removed };
}

export async function importHistory(root: string, sources: string[], options: ImportHistoryOptions = {}): Promise<ImportHistoryResult> {
  if (!sources.length) throw new ConfigurationError('history import requires at least one report file or report directory.');
  const now = options.now ?? new Date();
  const provenance = options.provenance ?? 'trusted-default-branch';
  const maxBytes = options.maxBytes ?? DEFAULT_HISTORY_MAX_BYTES;
  const maxRecords = options.maxRecords ?? DEFAULT_MAX_RECORDS;
  const maxAgeDays = options.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS;
  if (!Number.isInteger(maxRecords) || maxRecords < 1 || maxRecords > 10_000) throw new ConfigurationError('History maxRecords must be between 1 and 10000.');
  if (!Number.isFinite(maxAgeDays) || maxAgeDays < 1 || maxAgeDays > 3650) throw new ConfigurationError('History maxAgeDays must be between 1 and 3650.');
  const store = resolve(root);
  return await withStoreLock(store, async () => {
    const manifest = await loadManifest(store, now);
    const entries = new Map(manifest.entries.map(entry => [entry.importKey, entry]));
    const importedKeys: string[] = [];
    let skipped = 0;
    for (const source of sources) {
      const record = await sourceRecord(source, { provenance, maxBytes, now });
      const existing = entries.get(record.importKey);
      if (existing) {
        if (existing.checksum !== record.checksum) {
          throw new IntegrityError(`Conflicting duplicate history import for run ${record.result.runId}.`, { importKey: record.importKey });
        }
        skipped += 1;
        continue;
      }
      await persistRecord(store, record);
      entries.set(record.importKey, entryFor(record));
      importedKeys.push(record.importKey);
    }
    const { kept, removed } = retention([...entries.values()], now, maxRecords, maxAgeDays);
    for (const entry of removed) await rm(safe(store, entry.file), { force: true });
    const next: HistoryManifest = {
      schemaVersion: 1,
      updatedAt: now.toISOString(),
      entries: kept,
      checksum: historyManifestChecksum(kept)
    };
    const manifestPath = safe(store, 'manifest.json');
    await atomicWrite(manifestPath, `${JSON.stringify(next, null, 2)}\n`);
    return { imported: importedKeys.length, skipped, pruned: removed.length, manifestPath, importedKeys };
  });
}

export async function writeHistory(root: string, result: Parameters<typeof createHistoryRecord>[0], provenance: HistoryProvenance): Promise<string> {
  const record = createHistoryRecord(result, provenance);
  const temporary = await writeTemporaryRecord(root, record);
  try {
    await importHistory(root, [temporary], { provenance, maxAgeDays: DEFAULT_MAX_AGE_DAYS, maxRecords: DEFAULT_MAX_RECORDS });
  } finally {
    await rm(temporary, { force: true });
  }
  return safe(root, `records/${record.importKey}.json`);
}

async function writeTemporaryRecord(root: string, record: HistoryRecord): Promise<string> {
  const directory = safe(root, '.incoming');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = safe(directory, `${record.importKey}.${process.pid}.json`);
  await atomicWrite(path, `${JSON.stringify(record, null, 2)}\n`);
  return path;
}

export async function readHistory(file: string): Promise<HistoryRecord> {
  return validateHistoryRecord(await readBoundedHistoryJson(resolve(file)));
}

export async function readHistoryRecords(root: string): Promise<HistoryRecord[]> {
  const store = resolve(root);
  const manifest = await loadManifest(store, new Date());
  const records: HistoryRecord[] = [];
  for (const entry of manifest.entries) {
    const record = await readHistory(safe(store, entry.file));
    if (record.importKey !== entry.importKey || record.checksum !== entry.checksum || record.result.runId !== entry.runId) {
      throw new IntegrityError(`History manifest does not match record ${entry.importKey}.`);
    }
    records.push(record);
  }
  return records;
}

export async function discoverHistorySources(root: string): Promise<string[]> {
  const directory = resolve(root);
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter(entry => entry.isDirectory() || (entry.isFile() && entry.name.endsWith('.json')))
    .map(entry => resolve(directory, entry.name))
    .sort();
}
