import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, readdir, realpath, rename, rm, rmdir, link, unlink, readlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { hostname, platform, tmpdir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { ConfigurationError, IntegrityError } from './errors.js';
import { runBounded } from './lifecycle.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_RECORD_BYTES = 16_384;
export const OWNED_FILES_ADAPTER = 'forgeqa-owned-files-v1';
const FILE_TARGET = 'local-private-files';

export interface RecoveryIdentity { runId: string; consumer: string; namespace: string; }
export interface RecoveryOwner extends RecoveryIdentity {
  schemaVersion: 1; id: string; host: string; pid: number; createdAt: number; expiresAt: number;
}
/** Identifiers only. Never store credentials, storage state, callbacks, URLs or arbitrary paths here. */
export interface RecoveryDescriptor { adapter: string; target: string; key: string; }
export interface RecoveryRecord extends RecoveryDescriptor {
  schemaVersion: 1; ownerId: string; id: string; sequence: number;
}
export interface RecoveryAdapter {
  id: string;
  target: string;
  /** Must independently verify exact target/ownership and be idempotent. No prefix-wide deletion. */
  reclaim(record: Readonly<RecoveryRecord>, owner: Readonly<RecoveryOwner>, signal: AbortSignal): Promise<void>;
}
export interface RecoveryOptions { root?: string; graceMs?: number; }
export interface RecoveryEvent {
  ownerId: string; resourceId?: string;
  status: 'eligible' | 'reclaimed' | 'active' | 'grace' | 'foreign-host' | 'busy' | 'blocked' | 'failed';
  reason: string;
}
export interface RecoveryReport {
  schemaVersion: 1; dryRun: boolean; ownersScanned: number; reclaimed: number;
  incomplete: boolean; events: RecoveryEvent[];
}
export interface RecoverOptions {
  root?: string; apply?: boolean; adapters?: readonly RecoveryAdapter[];
  consumer?: string; namespace?: string; maxOwners?: number; timeoutMs?: number; budgetMs?: number;
}
interface DirectoryIdentity { dev: number; ino: number; }
interface Root extends DirectoryIdentity { path: string; }
interface Actor { host: string; pid: number; }
interface Claim extends Actor { schemaVersion: 1; ownerId: string; id: string; generation: number; }

function integer(value: unknown, low: number, high: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= low && (value as number) <= high;
}
function identifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:@+-]{0,239}$/.test(value);
}
function label(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 240 && value.trim().length > 0 && !/[\\/\x00-\x1f\x7f]/u.test(value);
}
function identity(value: RecoveryIdentity): void {
  if (!value || ![value.runId, value.consumer, value.namespace].every(label)) throw new ConfigurationError('Recovery requires bounded non-secret run, consumer and namespace identifiers.');
}
function descriptor(value: RecoveryDescriptor): void {
  if (!value || ![value.adapter, value.target, value.key].every(identifier)) throw new ConfigurationError('Recovery descriptors must contain identifiers, not paths, URLs or credentials.');
}
function exact(value: any, keys: string[]): void {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join() !== keys.sort().join()) throw new IntegrityError('Invalid recovery record fields.');
}
function absent(error: unknown): boolean { return (error as NodeJS.ErrnoException)?.code === 'ENOENT'; }
function exists(error: unknown): boolean { return (error as NodeJS.ErrnoException)?.code === 'EEXIST'; }
async function actor(): Promise<Actor> {
  // A shared hostname is not sufficient to identify a Linux PID namespace.
  let domain = '';
  if (platform() === 'linux') {
    domain = `${(await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim()}:${await readlink('/proc/self/ns/pid')}`;
  }
  return { pid: process.pid, host: createHash('sha256').update(`${hostname()}|${platform()}|${domain}`).digest('hex') };
}
function stopped(owner: Actor, current: Actor): boolean {
  if (owner.host !== current.host) return false;
  try { process.kill(owner.pid, 0); return false; }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH'; }
}
async function directory(path: string, expected?: DirectoryIdentity): Promise<DirectoryIdentity> {
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(path) !== resolve(path)
    || (process.getuid && (stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0))
    || (expected && (expected.dev !== stat.dev || expected.ino !== stat.ino))) throw new IntegrityError('Unsafe or replaced recovery directory.');
  return { dev: stat.dev, ino: stat.ino };
}
async function readJson(path: string): Promise<any> {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.size > MAX_RECORD_BYTES
    || before.nlink !== 1 || (process.getuid && (before.uid !== process.getuid() || (before.mode & 0o077) !== 0))) throw new IntegrityError('Unsafe recovery metadata file.');
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const actual = await file.stat();
    if (actual.dev !== before.dev || actual.ino !== before.ino || actual.size !== before.size || actual.nlink !== 1) throw new IntegrityError('Recovery metadata changed during access.');
    const buffer = Buffer.alloc(MAX_RECORD_BYTES + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead !== actual.size || bytesRead > MAX_RECORD_BYTES) throw new IntegrityError('Recovery metadata exceeds its read limit.');
    return JSON.parse(buffer.subarray(0, bytesRead).toString('utf8')) as unknown;
  } finally { await file.close(); }
}
/** Atomic, no-overwrite publication: an incomplete write is never a claim or resource record. */
async function publish(path: string, value: unknown): Promise<boolean> {
  const temporary = `${path}.writing-${randomUUID()}`;
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text) > MAX_RECORD_BYTES) throw new IntegrityError('Recovery record is too large.');
  const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
  try {
    await file.writeFile(text); await file.sync(); await file.close();
    try { await link(temporary, path); return true; }
    catch (error) { if (exists(error)) return false; throw error; }
  } finally { await file.close(); await unlink(temporary); }
}
async function rootPath(requested?: string): Promise<string> {
  return resolve(requested ?? process.env.FORGEQA_RECOVERY_ROOT ?? join(await realpath(tmpdir()), `forgeqa-recovery-${process.getuid?.() ?? 'user'}`));
}
async function createPrivateRoot(path: string): Promise<void> {
  try {
    const stat = await lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(path) !== resolve(path)) throw new IntegrityError('Unsafe recovery root ancestor.');
  } catch (error) {
    if (!absent(error)) throw error;
    const parent = dirname(path);
    if (parent === path) throw error;
    await createPrivateRoot(parent);
    try { await mkdir(path, { mode: 0o700 }); } catch (conflict) { if (!exists(conflict)) throw conflict; }
    const stat = await lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(path) !== resolve(path)) throw new IntegrityError('Unsafe recovery root ancestor.');
  }
}
async function openRoot(requested: string | undefined, create: boolean): Promise<Root | undefined> {
  const path = await rootPath(requested);
  if (create) await createPrivateRoot(path);
  let stat: DirectoryIdentity;
  try { stat = await directory(path); } catch (error) { if (!create && absent(error)) return undefined; throw error; }
  const marker = { schemaVersion: 1, kind: 'forgeqa-recovery-root', ...stat };
  if (create) await publish(join(path, 'root.json'), marker);
  const actual = await readJson(join(path, 'root.json'));
  exact(actual, ['schemaVersion', 'kind', 'dev', 'ino']);
  if (JSON.stringify(actual) !== JSON.stringify(marker)) throw new IntegrityError('Recovery root ownership does not match.');
  return { path, ...stat };
}
function parseOwner(value: any, id: string): RecoveryOwner {
  exact(value, ['schemaVersion', 'id', 'host', 'pid', 'createdAt', 'expiresAt', 'runId', 'consumer', 'namespace']);
  identity(value);
  if (value.schemaVersion !== 1 || !UUID.test(id) || value.id !== id || !/^[a-f0-9]{64}$/.test(value.host)
    || !integer(value.pid, 1, 2 ** 31 - 1) || !integer(value.createdAt, 0, Number.MAX_SAFE_INTEGER)
    || !integer(value.expiresAt, value.createdAt, Number.MAX_SAFE_INTEGER)) throw new IntegrityError('Invalid recovery owner.');
  return Object.freeze(value) as RecoveryOwner;
}
function parseRecord(value: any, owner: RecoveryOwner, name: string): RecoveryRecord {
  exact(value, ['schemaVersion', 'ownerId', 'id', 'sequence', 'adapter', 'target', 'key']); descriptor(value);
  if (value.schemaVersion !== 1 || value.ownerId !== owner.id || !UUID.test(value.id) || !integer(value.sequence, 0, 999)
    || name !== `resource-${String(value.sequence).padStart(4, '0')}-${value.id}.json`) throw new IntegrityError('Invalid resource ownership or sequence.');
  if (value.adapter === OWNED_FILES_ADAPTER && (value.target !== FILE_TARGET || value.key !== value.id)) throw new IntegrityError('Invalid private-file descriptor.');
  return Object.freeze(value) as RecoveryRecord;
}
async function acknowledged(path: string, name: string, ownerId: string, id: string): Promise<boolean> {
  let value;
  try { value = await readJson(join(path, name)); } catch (error) { if (absent(error)) return false; throw error; }
  exact(value, ['schemaVersion', 'ownerId', 'id']);
  if (value.schemaVersion !== 1 || value.ownerId !== ownerId || value.id !== id) throw new IntegrityError('Recovery acknowledgment ownership mismatch.');
  return true;
}
async function acknowledge(path: string, name: string, ownerId: string, id: string): Promise<void> {
  if (!await publish(join(path, name), { schemaVersion: 1, ownerId, id })) await acknowledged(path, name, ownerId, id);
}
async function records(path: string, owner: RecoveryOwner): Promise<RecoveryRecord[]> {
  const names = await readdir(path);
  if (names.length > 10_000) throw new IntegrityError('Recovery owner exceeds its bounded inventory.');
  const result: RecoveryRecord[] = [], sequences = new Set<number>();
  for (const name of names.filter(name => name.startsWith('resource-') && name.endsWith('.json')).sort()) {
    const record = parseRecord(await readJson(join(path, name)), owner, name);
    if (sequences.has(record.sequence)) throw new IntegrityError('Duplicate recovery resource sequence.');
    sequences.add(record.sequence);
    if (!await acknowledged(path, `done-${record.id}.json`, owner.id, record.id)) result.push(record);
  }
  return result.reverse();
}

/** Process-crash journal. Configure a private persistent root; never upload it as test evidence. */
export class RecoveryJournal {
  readonly owner: Readonly<RecoveryOwner>;
  readonly root: string;
  readonly path: string;
  #root: Root;
  #directory: DirectoryIdentity;
  #sequence = 0;
  #closed = false;
  #active = new Set<string>();
  #disposing = new Set<string>();
  #operations = 0;
  #closing?: Promise<void>;
  private constructor(root: Root, owner: RecoveryOwner, stat: DirectoryIdentity) {
    this.#root = root; this.root = root.path; this.owner = owner;
    this.path = join(root.path, `owner-${owner.id}`); this.#directory = stat;
  }
  static async create(value: RecoveryIdentity, options: RecoveryOptions = {}): Promise<RecoveryJournal> {
    identity(value);
    const grace = options.graceMs ?? 30_000;
    if (!integer(grace, 0, 86_400_000)) throw new ConfigurationError('Recovery grace must be between 0 and 86400000 milliseconds.');
    const root = (await openRoot(options.root, true))!;
    const id = randomUUID(), now = Date.now();
    const owner: RecoveryOwner = Object.freeze({ schemaVersion: 1, id, ...await actor(), createdAt: now, expiresAt: now + grace,
      runId: value.runId, consumer: value.consumer, namespace: value.namespace });
    const staging = join(root.path, `.owner-${id}`), path = join(root.path, `owner-${id}`);
    await mkdir(staging, { mode: 0o700 });
    try {
      await publish(join(staging, 'owner.json'), owner);
      await rename(staging, path);
      return new RecoveryJournal(root, owner, await directory(path));
    } catch (error) { await rm(staging, { recursive: true, force: true }); throw error; }
  }
  async #check(): Promise<void> { await directory(this.root, this.#root); await directory(this.path, this.#directory); }
  async verify(): Promise<void> { await this.#check(); }
  async reserve(value: RecoveryDescriptor): Promise<Readonly<RecoveryRecord>> {
    if (this.#closed) throw new IntegrityError('Recovery journal is closed.');
    descriptor(value);
    const sequence = this.#sequence++;
    if (sequence > 999) throw new IntegrityError('Recovery owner exceeds 1000 resources.');
    const id = randomUUID();
    const record: RecoveryRecord = Object.freeze({ schemaVersion: 1, ownerId: this.owner.id, id, sequence,
      adapter: value.adapter, target: value.target, key: value.adapter === OWNED_FILES_ADAPTER ? id : value.key });
    if (record.adapter === OWNED_FILES_ADAPTER && record.target !== FILE_TARGET) throw new IntegrityError('Invalid private-file target.');
    this.#operations++;
    try {
      await this.#check();
      if (!await publish(join(this.path, `resource-${String(sequence).padStart(4, '0')}-${id}.json`), record)) throw new IntegrityError('Duplicate recovery record.');
      return record;
    } finally { this.#operations--; }
  }
  async #validateRecord(record: Readonly<RecoveryRecord>): Promise<void> {
    if (record.ownerId !== this.owner.id || !UUID.test(record.id) || !integer(record.sequence, 0, 999)) throw new IntegrityError('Invalid recovery resource identity.');
    const name = `resource-${String(record.sequence).padStart(4, '0')}-${record.id}.json`;
    const actual = parseRecord(await readJson(join(this.path, name)), this.owner, name);
    if (actual.adapter !== record.adapter || actual.target !== record.target || actual.key !== record.key) throw new IntegrityError('Recovery resource does not match its durable intent.');
  }
  /** Persist reserve() BEFORE calling this. A timed-out acquisition keeps its recovery record. */
  async acquire<T>(record: Readonly<RecoveryRecord>, operation: () => Promise<T>): Promise<T> {
    if (this.#closed || this.#active.has(record.id) || this.#disposing.has(record.id)) throw new IntegrityError('Invalid or closed recovery acquisition.');
    this.#active.add(record.id);
    try {
      await this.#check(); await this.#validateRecord(record);
      if (await acknowledged(this.path, `done-${record.id}.json`, this.owner.id, record.id)) throw new IntegrityError('Recovery resource is already complete.');
      return await operation();
    } finally { this.#active.delete(record.id); }
  }
  async complete(record: Readonly<RecoveryRecord>): Promise<void> {
    if (this.#active.has(record.id) || this.#disposing.has(record.id)) throw new IntegrityError('Cannot acknowledge still-acquiring or disposing resources.');
    this.#operations++;
    try {
      await this.#check(); await this.#validateRecord(record);
      await acknowledge(this.path, `done-${record.id}.json`, this.owner.id, record.id);
    } finally { this.#operations--; }
  }
  async dispose(record: Readonly<RecoveryRecord>, adapter: RecoveryAdapter, signal: AbortSignal): Promise<void> {
    if (this.#active.has(record.id) || this.#disposing.has(record.id) || record.adapter !== adapter.id || record.target !== adapter.target) throw new IntegrityError('Cannot clean up an active or mismatched recovery resource.');
    this.#disposing.add(record.id); this.#operations++;
    try {
      await this.#check(); await this.#validateRecord(record); signal.throwIfAborted();
      if (await acknowledged(this.path, `done-${record.id}.json`, this.owner.id, record.id)) return;
      await adapter.reclaim(record, this.owner, signal);
      await acknowledge(this.path, `done-${record.id}.json`, this.owner.id, record.id);
    } finally { this.#operations--; this.#disposing.delete(record.id); }
  }
  async createDirectory(): Promise<{ directory: string; record: Readonly<RecoveryRecord> }> {
    const record = await this.reserve({ adapter: OWNED_FILES_ADAPTER, target: FILE_TARGET, key: 'allocation' });
    return this.acquire(record, async () => {
      const path = join(this.path, `files-${record.id}`);
      await mkdir(path, { mode: 0o700 });
      await publish(join(this.path, `directory-${record.id}.json`), { schemaVersion: 1, ownerId: this.owner.id, id: record.id, ...await directory(path) });
      return { directory: path, record };
    });
  }
  /** Seal only after dependent fixtures have stopped using their resources. */
  close(): Promise<void> {
    this.#closed = true;
    this.#closing ??= (async () => {
      await this.#check();
      if (this.#active.size || this.#operations) throw new IntegrityError('Recovery journal still has in-flight operations; ownership is retained.');
      if ((await records(this.path, this.owner)).length) await acknowledge(this.path, 'retired.json', this.owner.id, this.owner.id);
      else await rm(this.path, { recursive: true, force: false });
    })();
    return this.#closing;
  }
}

async function reclaimDirectory(path: string, owner: RecoveryOwner, record: RecoveryRecord): Promise<void> {
  const target = join(path, `files-${record.id}`);
  let actual: DirectoryIdentity;
  try { actual = await directory(target); } catch (error) { if (absent(error)) return; throw error; }
  let stamp;
  try { stamp = await readJson(join(path, `directory-${record.id}.json`)); }
  catch (error) {
    if (!absent(error)) throw error;
    // Acquisition may die between mkdir and the identity stamp. It cannot publish data yet.
    if ((await readdir(target)).length) throw new IntegrityError('Unstamped allocation is not empty.');
    await rmdir(target); return;
  }
  exact(stamp, ['schemaVersion', 'ownerId', 'id', 'dev', 'ino']);
  if (stamp.schemaVersion !== 1 || stamp.ownerId !== owner.id || stamp.id !== record.id || stamp.dev !== actual.dev || stamp.ino !== actual.ino) throw new IntegrityError('Private directory ownership changed.');
  // Only this guarded directory is removed; descriptors never supply deletion paths.
  await rm(target, { recursive: true, force: false });
}
async function claim(path: string, owner: RecoveryOwner, current: Actor): Promise<Claim | undefined> {
  // Append-only generations avoid the stale-lock unlink/replacement race. Never steal from a live claimant.
  for (let generation = 0; generation < 1000; generation++) {
    const name = `claim-${generation}.json`;
    const candidate: Claim = { schemaVersion: 1, ownerId: owner.id, id: randomUUID(), generation, ...current };
    if (await publish(join(path, name), candidate)) return candidate;
    const previous = await readJson(join(path, name));
    exact(previous, ['schemaVersion', 'ownerId', 'id', 'generation', 'host', 'pid']);
    if (previous.schemaVersion !== 1 || previous.ownerId !== owner.id || !UUID.test(previous.id) || previous.generation !== generation
      || !integer(previous.pid, 1, 2 ** 31 - 1) || !/^[a-f0-9]{64}$/.test(previous.host)) throw new IntegrityError('Invalid recovery claim.');
    if (!await acknowledged(path, `released-${generation}.json`, owner.id, previous.id) && !stopped(previous, current)) return undefined;
  }
  throw new IntegrityError('Recovery claim history exceeds 1000 attempts.');
}

/** Dry-run by default. Local PID-namespace death or an explicitly retired owner is required. */
export async function recoverResources(options: RecoverOptions = {}): Promise<RecoveryReport> {
  const limit = options.maxOwners ?? 100, timeout = options.timeoutMs ?? 5_000, budget = options.budgetMs ?? 60_000;
  if ((options.apply !== undefined && typeof options.apply !== 'boolean') || !integer(limit, 1, 1000) || !integer(timeout, 1, 60_000) || !integer(budget, 1, 300_000)
    || (options.consumer !== undefined && !label(options.consumer)) || (options.namespace !== undefined && !label(options.namespace))) throw new ConfigurationError('Invalid recovery limits or exact ownership filters.');
  if (options.adapters !== undefined && !Array.isArray(options.adapters)) throw new ConfigurationError('Recovery adapters must be an array.');
  const adapters = new Map<string, RecoveryAdapter>();
  for (const adapter of options.adapters ?? []) {
    if (!adapter || typeof adapter !== 'object') throw new ConfigurationError('Invalid recovery adapter.');
    const key = JSON.stringify([adapter.id, adapter.target]);
    if (!identifier(adapter.id) || !identifier(adapter.target) || adapter.id === OWNED_FILES_ADAPTER || typeof adapter.reclaim !== 'function' || adapters.has(key)) throw new ConfigurationError('Recovery adapters must have unique, non-reserved IDs and targets.');
    adapters.set(key, adapter);
  }
  const report: RecoveryReport = { schemaVersion: 1, dryRun: options.apply !== true, ownersScanned: 0, reclaimed: 0, incomplete: false, events: [] };
  const root = await openRoot(options.root, false);
  if (!root) return report;
  const current = await actor(), started = Date.now();
  const names = (await readdir(root.path)).filter(name => name.startsWith('owner-')).sort();
  if (names.length > limit) report.incomplete = true;
  for (const name of names.slice(0, limit)) {
    const ownerId = name.slice(6), path = join(root.path, name);
    const event = (status: RecoveryEvent['status'], reason: string, resourceId?: string) => report.events.push({ ownerId, status, reason, ...(resourceId ? { resourceId } : {}) });
    if (Date.now() - started >= budget) { report.incomplete = true; event('blocked', 'budget-exhausted'); break; }
    report.ownersScanned++;
    let held: Claim | undefined;
    let release = true;
    let removed = false;
    try {
      await directory(root.path, root); const stat = await directory(path);
      const owner = parseOwner(await readJson(join(path, 'owner.json')), ownerId);
      if ((options.consumer && options.consumer !== owner.consumer) || (options.namespace && options.namespace !== owner.namespace)) continue;
      const retired = await acknowledged(path, 'retired.json', owner.id, owner.id);
      if (!retired && owner.host !== current.host) { report.incomplete = true; event('foreign-host', 'owner-liveness-unverifiable'); continue; }
      if (!retired && !stopped(owner, current)) { event('active', 'owner-process-present-or-unverifiable'); continue; }
      if (!retired && owner.expiresAt > Date.now()) { event('grace', 'minimum-grace-not-elapsed'); continue; }
      if (options.apply) { held = await claim(path, owner, current); if (!held) { report.incomplete = true; event('busy', 'another-reclaimer-owns-claim'); continue; } }
      for (const record of await records(path, owner)) {
        if (Date.now() - started >= budget) { report.incomplete = true; event('blocked', 'budget-exhausted', record.id); break; }
        const adapter = adapters.get(JSON.stringify([record.adapter, record.target]));
        if (record.adapter !== OWNED_FILES_ADAPTER && !adapter) { report.incomplete = true; event('blocked', 'trusted-adapter-required', record.id); continue; }
        if (!options.apply) { event('eligible', 'ownership-and-liveness-verified', record.id); continue; }
        await directory(root.path, root); await directory(path, stat);
        let settled = false;
        try {
          await runBounded(async signal => {
            try { if (record.adapter === OWNED_FILES_ADAPTER) await reclaimDirectory(path, owner, record); else await adapter!.reclaim(record, owner, signal); }
            finally { settled = true; }
          }, Math.min(timeout, Math.max(1, budget - (Date.now() - started))), 'Recovery cleanup');
          await acknowledge(path, `done-${record.id}.json`, owner.id, record.id);
          report.reclaimed++; event('reclaimed', 'owned-resource-cleaned', record.id);
        } catch {
          report.incomplete = true; event('failed', 'cleanup-failed-or-timed-out', record.id);
          if (!settled) { release = false; break; }
        }
      }
      if (held && release && (await records(path, owner)).length === 0) {
        await directory(root.path, root); await directory(path, stat);
        await rm(path, { recursive: true, force: false }); removed = true;
      }
    } catch (error) {
      let gone = false;
      if (absent(error)) { try { await lstat(path); } catch (check) { gone = absent(check); } }
      if (!gone) { report.incomplete = true; event('blocked', 'invalid-or-unsafe-recovery-metadata'); }
    }
    finally {
      // An uncooperative timed-out callback may still write remotely. Do NOT release its live claim.
      if (held && release && !removed) {
        try { await acknowledge(path, `released-${held.generation}.json`, held.ownerId, held.id); }
        catch { report.incomplete = true; event('blocked', 'claim-release-failed'); }
      }
    }
  }
  return report;
}
