import { createHash } from 'node:crypto';
import { ResourceScope, runBounded, withResourceScope, RecoveryJournal, type RecoveryOptions, type RecoveryAdapter, type RecoveryOwner, type RecoveryRecord } from '@azerish25-ux/forgeqa-core';
import type { APIRequestContext } from '@playwright/test';
import { OwnedFiles } from './owned-files.js';

export interface AuthenticationIdentity {
  application: string;
  environment: string;
  role: string;
  project: string;
  configHash: string;
  namespace: string;
  runId: string;
  shard: number;
  parallelIndex: number;
  workerIndex: number;
  testId?: string;
  attempt?: number;
}
export interface AuthenticationRecoveryContext { owner: Readonly<RecoveryOwner>; record: Readonly<RecoveryRecord>; }
export interface AuthenticationAdapter<Session> {
  id: string;
  /** Register acquired accounts/contexts immediately, before subsequent fallible setup. */
  authenticate(identity: Readonly<AuthenticationIdentity>, scope: ResourceScope, signal: AbortSignal, recovery?: AuthenticationRecoveryContext): Promise<Session>;
  /** Must verify the actual session/role; a TTL alone is not authentication validation. */
  validate(session: Session, identity: Readonly<AuthenticationIdentity>, signal: AbortSignal): Promise<boolean>;
  /** Only for genuinely owned remote resources; borrowed users must not implement this. */
  recovery?: { adapter: RecoveryAdapter; key(identity: Readonly<AuthenticationIdentity>, owner: Readonly<RecoveryOwner>): string };
  storageState?(session: Session, signal: AbortSignal): Promise<Awaited<ReturnType<APIRequestContext['storageState']>>>;
}
export interface AuthenticationOptions {
  /** No cross-test reuse by default. Worker reuse is an explicit consumer isolation decision. */
  reuse?: 'none' | 'worker';
  maxAgeMs?: number;
  timeoutMs?: number;
  cleanupTimeoutMs?: number;
  recovery?: RecoveryOptions;
}
interface SessionRecord<Session> {
  scope: ResourceScope;
  session: Session;
  expiresAt: number;
  files?: OwnedFiles;
  statePath?: string;
  stateDigest?: string;
}
const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');

export function authenticationKey(adapterId: string, identity: AuthenticationIdentity): string {
  const strings = [adapterId, identity.application, identity.environment, identity.role, identity.project,
    identity.configHash, identity.namespace, identity.runId];
  if (strings.some(value => typeof value !== 'string' || !value.trim() || value.length > 4096)) throw new Error('Incomplete authentication identity.');
  const numbers = [identity.shard, identity.parallelIndex, identity.workerIndex, identity.attempt ?? 0];
  if (numbers.some(value => !Number.isSafeInteger(value) || value < 0)) throw new Error('Invalid authentication execution identity.');
  if (identity.testId !== undefined && (typeof identity.testId !== 'string' || !identity.testId.trim())) throw new Error('Invalid authentication test identity.');
  return digest(JSON.stringify([...strings, ...numbers, identity.testId ?? null]));
}

/** Per-worker manager. Same-key leases are serialized, so stale refresh cannot dispose an active lease. */
export class AuthenticationManager<Session> {
  #adapter: AuthenticationAdapter<Session>;
  #options: Required<AuthenticationOptions>;
  #records = new Map<string, SessionRecord<Session>>();
  #queues = new Map<string, Promise<unknown>>();
  #closed = false;
  #closing?: Promise<void>;

  constructor(adapter: AuthenticationAdapter<Session>, options: AuthenticationOptions = {}) {
    if (!adapter.id.trim()) throw new Error('An authentication adapter ID is required.');
    this.#adapter = adapter;
    this.#options = { reuse: options.reuse ?? 'none', maxAgeMs: options.maxAgeMs ?? 300_000,
      timeoutMs: options.timeoutMs ?? 30_000, cleanupTimeoutMs: options.cleanupTimeoutMs ?? 5_000, recovery: options.recovery ?? {} };
    if (!['none', 'worker'].includes(this.#options.reuse)) throw new Error('Invalid authentication reuse policy.');
    for (const value of [this.#options.maxAgeMs, this.#options.timeoutMs, this.#options.cleanupTimeoutMs]) {
      if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) throw new RangeError('Invalid authentication deadline.');
    }
  }

  withSession<T>(identity: AuthenticationIdentity, use: (session: Session, statePath?: string) => Promise<T>): Promise<T> {
    if (this.#closed) return Promise.reject(new Error('Authentication manager is closed.'));
    const key = authenticationKey(this.#adapter.id, identity);
    const ownedIdentity = Object.freeze({ ...identity });
    const previous = this.#queues.get(key) ?? Promise.resolve();
    const task = previous.catch(() => undefined).then(async () => {
      let record = this.#records.get(key);
      if (record) {
        let valid: boolean;
        try {
          valid = record.expiresAt > Date.now();
          if (valid && record.files) valid = digest(await record.files.read('state.json')) === record.stateDigest;
          if (valid) valid = await runBounded(signal => this.#adapter.validate(record!.session, ownedIdentity, signal), this.#options.timeoutMs, 'Session validation');
        } catch (error) {
          // Infrastructure/validation errors must not be disguised as an ordinary expired login.
          this.#records.delete(key);
          return withResourceScope(record.scope, async () => { throw error; });
        }
        if (!valid) { this.#records.delete(key); await record.scope.close(); record = undefined; }
      }
      if (!record) { record = await this.#create(key, ownedIdentity); this.#records.set(key, record); }
      if (this.#options.reuse === 'worker') return use(record.session, record.statePath);
      this.#records.delete(key);
      return withResourceScope(record.scope, () => use(record!.session, record!.statePath));
    });
    this.#queues.set(key, task);
    const clear = () => { if (this.#queues.get(key) === task) this.#queues.delete(key); };
    void task.then(clear, clear);
    return task;
  }

  async #create(key: string, identity: Readonly<AuthenticationIdentity>): Promise<SessionRecord<Session>> {
    const scope = new ResourceScope(identity.namespace, this.#options.cleanupTimeoutMs);
    try {
      const recoveryIdentity = { runId: identity.runId, consumer: identity.application, namespace: identity.namespace };
      const recovery = this.#adapter.recovery;
      const journal = recovery ? await RecoveryJournal.create(recoveryIdentity, this.#options.recovery) : undefined;
      if (journal) scope.defer({ id: 'recovery-journal', cleanup: () => journal.close() });
      const recoveryRecord = journal && recovery ? await journal.reserve({ adapter: recovery.adapter.id, target: recovery.adapter.target, key: recovery.key(identity, journal.owner) }) : undefined;
      if (journal && recoveryRecord && recovery) scope.defer({ id: 'recoverable-authentication', cleanup: signal => journal.dispose(recoveryRecord, recovery.adapter, signal) });
      const session = await runBounded(signal => journal && recoveryRecord
        ? journal.acquire(recoveryRecord, () => this.#adapter.authenticate(identity, scope, signal, { owner: journal.owner, record: recoveryRecord }))
        : this.#adapter.authenticate(identity, scope, signal), this.#options.timeoutMs, 'Authentication setup');
      const valid = await runBounded(signal => this.#adapter.validate(session, identity, signal), this.#options.timeoutMs, 'Initial session validation');
      if (!valid) throw new Error('Authentication adapter returned an invalid session or role.');
      const record: SessionRecord<Session> = { scope, session, expiresAt: Date.now() + this.#options.maxAgeMs };
      if (this.#adapter.storageState) {
        const files = await OwnedFiles.create(10 * 1024 * 1024, {
          ...this.#options.recovery, identity: recoveryIdentity, ...(journal ? { journal } : {}),
        });
        scope.defer({ id: 'authentication-state-files', cleanup: () => files.close() });
        const state = await runBounded(signal => this.#adapter.storageState!(session, signal), this.#options.timeoutMs, 'Authentication state export');
        if (!state || !Array.isArray(state.cookies) || !Array.isArray(state.origins)) throw new Error('Invalid Playwright authentication storage state.');
        const text = JSON.stringify(state);
        record.statePath = await files.write('state.json', text);
        record.stateDigest = digest(text);
        record.files = files;
        await files.write('metadata.json', JSON.stringify({ schemaVersion: 1, key, expiresAt: record.expiresAt, sha256: record.stateDigest }));
      }
      return record;
    } catch (error) { return withResourceScope(scope, async () => { throw error; }); }
  }

  close(): Promise<void> {
    this.#closed = true;
    if (!this.#closing) this.#closing = (async () => {
      // Native worker teardown calls close after all dependent test fixtures have completed.
      await Promise.allSettled([...this.#queues.values()]);
      const failures: unknown[] = [];
      for (const record of [...this.#records.values()].reverse()) {
        try { await record.scope.close(); } catch (error) { failures.push(error); }
      }
      this.#records.clear();
      if (failures.length) throw new AggregateError(failures, 'Authentication cleanup failed.');
    })();
    return this.#closing;
  }
}

/** Test-scoped adoption helper. Application-specific login and ownership stay in the adapter. */
export async function withAuthentication<Session, T>(adapter: AuthenticationAdapter<Session>, identity: AuthenticationIdentity,
  use: (session: Session, statePath?: string) => Promise<T>, options: AuthenticationOptions = {}): Promise<T> {
  const manager = new AuthenticationManager(adapter, options);
  const scope = new ResourceScope(identity.namespace, options.cleanupTimeoutMs ?? 5_000);
  scope.defer({ id: 'authentication-manager', cleanup: () => manager.close() });
  return withResourceScope(scope, () => manager.withSession(identity, use));
}
