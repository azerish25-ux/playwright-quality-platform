import { randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** Host-local monotonic observations. Never subtract clocks from different contexts. */
export interface TimingIdentity {
  sourceSha: string;
  runId: string;
  shardIndex: number;
  shardTotal: number;
}
export interface TimingContext {
  schemaVersion: 1;
  kind: 'forgeqa-timing-context';
  clockId: string;
  originNs: string;
  identity: TimingIdentity;
}
export interface TimingSpan { name: string; startMs: number; endMs: number; }
export interface TimingRecord {
  schemaVersion: 1;
  kind: 'forgeqa-timing-record';
  clockId: string;
  identity: TimingIdentity;
  component: 'application' | 'reporter';
  completion: 'incomplete' | 'complete';
  completedMs: number | null;
  spans: TimingSpan[];
  counters: Record<string, number>;
}
const LIMIT = 65536;
const MAX_MS = 24 * 60 * 60 * 1000;
const NAMES = {
  application: ['applicationReadiness', 'applicationShutdown'],
  reporter: ['testWindow', 'forgeqaFinalization', 'allReportersFinalization']
} as const;
function fail(message: string): never { throw new Error(`FORGEQA_TIMING: ${message}`); }
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function duration(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_MS; }
function identity(value: unknown): asserts value is TimingIdentity {
  if (!object(value) || typeof value.sourceSha !== 'string' || !/^[a-f0-9]{40}$/.test(value.sourceSha) || typeof value.runId !== 'string' || !/^[A-Za-z0-9_.:-]{1,200}$/.test(value.runId)
      || !Number.isSafeInteger(value.shardIndex) || !Number.isSafeInteger(value.shardTotal)
      || Number(value.shardIndex) < 1 || Number(value.shardTotal) < Number(value.shardIndex) || Number(value.shardTotal) > 256) fail('Invalid source/run/shard identity.');
}
export function sameTimingIdentity(a: TimingIdentity, b: TimingIdentity): boolean {
  return a.sourceSha === b.sourceSha && a.runId === b.runId && a.shardIndex === b.shardIndex && a.shardTotal === b.shardTotal;
}
function checkedRoot(root: string): string {
  const full = resolve(root);
  const stat = lstatSync(full);
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(full) !== full) fail('Timing directory must be a canonical, owned directory.');
  return full;
}
function readJson(path: string): unknown {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > LIMIT) fail('Invalid or oversized timing file.');
  const bytes = readFileSync(path);
  if (bytes.length > LIMIT) fail('Timing file exceeds the limit.');
  return JSON.parse(bytes.toString('utf8')) as unknown;
}
function atomic(path: string, value: unknown): void {
  const content = JSON.stringify(value) + '\n';
  if (Buffer.byteLength(content) > LIMIT) fail('Timing record exceeds the limit.');
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, content, { flag: 'wx', mode: 0o600 });
  renameSync(temporary, path);
}
export function createTimingContext(root: string, owner: TimingIdentity): string {
  identity(owner);
  // The caller supplies its already-owned run directory. Refuse reuse/collision.
  const parent = realpathSync(dirname(resolve(root)));
  const directory = resolve(parent, 'timing');
  if (resolve(root) !== resolve(dirname(resolve(root)), 'timing')) fail('Context directory must be named timing.');
  mkdirSync(directory, { mode: 0o700 });
  const context: TimingContext = { schemaVersion: 1, kind: 'forgeqa-timing-context', clockId: randomUUID(), originNs: process.hrtime.bigint().toString(), identity: { ...owner } };
  const path = resolve(directory, 'context.json');
  writeFileSync(path, JSON.stringify(context) + '\n', { flag: 'wx', mode: 0o600 });
  return path;
}
export function readTimingContext(path: string): TimingContext {
  const root = checkedRoot(dirname(path));
  if (resolve(path) !== resolve(root, 'context.json')) fail('Expected context.json in the timing directory.');
  const value = readJson(path);
  if (!object(value) || value.schemaVersion !== 1 || value.kind !== 'forgeqa-timing-context'
      || typeof value.clockId !== 'string' || !/^[a-f0-9-]{36}$/.test(value.clockId)
      || typeof value.originNs !== 'string' || !/^\d{1,30}$/.test(value.originNs)) fail('Unsupported or malformed timing context.');
  identity(value.identity);
  return value as unknown as TimingContext;
}
export class TimingRecorder {
  readonly context: TimingContext;
  private readonly path: string;
  private record: TimingRecord;
  constructor(contextPath: string, component: TimingRecord['component'], expected?: TimingIdentity) {
    if (!['application', 'reporter'].includes(component)) fail('Unknown timing component.');
    this.context = readTimingContext(contextPath);
    if (expected && !sameTimingIdentity(this.context.identity, expected)) fail('Timing context belongs to a different source/run/shard.');
    this.path = resolve(dirname(contextPath), `${component}.json`);
    this.record = { schemaVersion: 1, kind: 'forgeqa-timing-record', clockId: this.context.clockId, identity: this.context.identity, component, completion: 'incomplete', completedMs: null, spans: [], counters: {} };
    // An incomplete marker is durable before acquiring resources or running tests.
    writeFileSync(this.path, JSON.stringify(this.record) + '\n', { flag: 'wx', mode: 0o600 });
  }
  now(): number {
    const value = Number(process.hrtime.bigint() - BigInt(this.context.originNs)) / 1e6;
    if (!duration(value)) fail('Invalid monotonic clock or observation longer than one day.');
    return value;
  }
  span(name: string, startMs: number, endMs = this.now()): void {
    if (this.record.completion === 'complete') fail('Cannot change a finalized record.');
    if (!(NAMES[this.record.component] as readonly string[]).includes(name) || this.record.spans.some(s => s.name === name)
        || !duration(startMs) || !duration(endMs) || endMs < startMs || endMs > this.now()) fail('Unknown, duplicate or invalid timing span.');
    this.record.spans.push({ name, startMs, endMs });
    atomic(this.path, this.record);
  }
  counter(name: 'attemptWorkMs' | 'attempts', value: number): void {
    if (this.record.completion === 'complete' || !['attemptWorkMs', 'attempts'].includes(name) || !duration(value) || (name === 'attempts' && !Number.isSafeInteger(value))) fail('Invalid timing counter.');
    this.record.counters[name] = value;
  }
  finish(complete: boolean): void {
    if (this.record.completion === 'complete') fail('Record already finalized.');
    this.record.completedMs = this.now();
    this.record.completion = complete ? 'complete' : 'incomplete';
    atomic(this.path, this.record);
  }
}
export interface ExecutionTimingProfile {
  schemaVersion: 1;
  kind: 'forgeqa-execution-timing';
  identity: TimingIdentity;
  clockId: string;
  cliRunMs: number;
  observedLifecycleMs: number;
  observedPhaseUnionMs: number;
  unattributedCliMs: number;
  stages: Record<string, number>;
  attemptWorkMs: number;
  attempts: number;
  records: TimingRecord[];
}
/** Union of overlapping intervals, not the sum of parallel work or nested reporters. */
export function timingUnion(spans: TimingSpan[]): number {
  const sorted = [...spans].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  let end = 0, total = 0;
  for (const span of sorted) {
    if (!duration(span.startMs) || !duration(span.endMs) || span.endMs < span.startMs) fail('Invalid interval.');
    total += Math.max(0, span.endMs - Math.max(end, span.startMs));
    end = Math.max(end, span.endMs);
  }
  return total;
}
export function validateExecutionTiming(records: unknown, expected: TimingIdentity, cliRunMs: number): ExecutionTimingProfile {
  identity(expected);
  if (!duration(cliRunMs) || !Array.isArray(records) || records.length !== 2) fail('Missing timing records or invalid CLI duration.');
  const components = new Set<string>(), clocks = new Set<string>();
  const stages: Record<string, number> = {};
  const allSpans: TimingSpan[] = [];
  let observedLifecycleMs = 0, attemptWorkMs = 0, attempts = 0;
  for (const value of records) {
    if (!object(value) || value.schemaVersion !== 1 || value.kind !== 'forgeqa-timing-record' || value.completion !== 'complete'
        || !['application', 'reporter'].includes(String(value.component)) || typeof value.clockId !== 'string' || !/^[a-f0-9-]{36}$/.test(value.clockId)
        || !duration(value.completedMs) || value.completedMs > cliRunMs || !Array.isArray(value.spans) || !object(value.counters)) fail('Incomplete, incompatible or out-of-envelope timing record.');
    identity(value.identity);
    if (!sameTimingIdentity(value.identity, expected) || components.has(String(value.component))) fail('Wrong-run or duplicate timing record.');
    components.add(String(value.component)); clocks.add(value.clockId);
    const component = value.component as TimingRecord['component'];
    const names = new Set<string>();
    for (const span of value.spans) {
      if (!object(span) || typeof span.name !== 'string' || !(NAMES[component] as readonly string[]).includes(span.name) || names.has(span.name)
          || !duration(span.startMs) || !duration(span.endMs) || span.endMs < span.startMs || span.endMs > value.completedMs) fail('Missing, duplicate or invalid timing span.');
      names.add(span.name);
      stages[span.name] = span.endMs - span.startMs;
      allSpans.push(span as unknown as TimingSpan);
    }
    if (NAMES[component].some(name => !names.has(name))) fail('A required stage was not measured.');
    if (component === 'reporter') {
      if (!duration(value.counters.attemptWorkMs) || !Number.isSafeInteger(value.counters.attempts) || Number(value.counters.attempts) < 1) fail('Missing real attempt measurements.');
      attemptWorkMs = value.counters.attemptWorkMs;
      attempts = Number(value.counters.attempts);
    }
    observedLifecycleMs = Math.max(observedLifecycleMs, value.completedMs);
  }
  if (clocks.size !== 1) fail('Cross-host or mixed-context clocks cannot be combined.');
  const find = (name: string) => allSpans.find(span => span.name === name)!;
  const final = find('forgeqaFinalization'), reporters = find('allReportersFinalization');
  if (final.startMs < reporters.startMs || final.endMs > reporters.endMs || find('testWindow').endMs > final.startMs
      || find('applicationReadiness').endMs > find('applicationShutdown').startMs) fail('Contradictory lifecycle ordering.');
  const observedPhaseUnionMs = timingUnion(allSpans);
  return { schemaVersion: 1, kind: 'forgeqa-execution-timing', identity: { ...expected }, clockId: [...clocks][0]!, cliRunMs, observedLifecycleMs, observedPhaseUnionMs,
    unattributedCliMs: cliRunMs - observedPhaseUnionMs, stages, attemptWorkMs, attempts, records: records as TimingRecord[] };
}
export function readExecutionTiming(root: string, expected: TimingIdentity, cliRunMs: number): ExecutionTimingProfile {
  const directory = checkedRoot(root);
  const context = readTimingContext(resolve(directory, 'context.json'));
  if (!sameTimingIdentity(context.identity, expected)) fail('Context identity mismatch.');
  const records = ['application', 'reporter'].map(name => readJson(resolve(directory, `${name}.json`)));
  const profile = validateExecutionTiming(records, expected, cliRunMs);
  if (context.clockId !== profile.clockId) fail('Records do not belong to their context.');
  return profile;
}
