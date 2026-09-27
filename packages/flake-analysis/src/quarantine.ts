import { open, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  ConfigurationError,
  IntegrityError,
  PolicyError,
  RESULT_SCHEMA_VERSION,
  type QuarantineRecord
} from '@azerish25-ux/forgeqa-core';

export interface QuarantineValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface QuarantineMutation {
  file: string;
  changed: boolean;
  records: QuarantineRecord[];
}

const LOCK_ATTEMPTS = 80;

function scope(record: QuarantineRecord): string {
  return [...(record.projects ?? [])].sort().join(',');
}

function key(record: QuarantineRecord): string {
  return `${record.testId}\u0000${scope(record)}`;
}

function recordOrder(a: QuarantineRecord, b: QuarantineRecord): number {
  return a.testId.localeCompare(b.testId) || scope(a).localeCompare(scope(b));
}

function normalized(record: QuarantineRecord): QuarantineRecord {
  const projects = record.projects ? [...new Set(record.projects.map(project => project.trim()).filter(Boolean))].sort() : undefined;
  return {
    schemaVersion: record.schemaVersion,
    testId: record.testId.trim(),
    owner: record.owner.trim(),
    reason: record.reason.trim(),
    issue: record.issue.trim(),
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    ...(projects?.length ? { projects } : {})
  };
}

export function validateQuarantine(
  records: QuarantineRecord[],
  knownTests: Iterable<string>,
  now = new Date(),
  maxDays = 14
): QuarantineValidation {
  const tests = new Set(knownTests);
  const errors: string[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const raw of records) {
    const record = normalized(raw);
    const label = record.projects?.length ? `${record.testId} [${record.projects.join(',')}]` : record.testId;
    if (record.schemaVersion !== RESULT_SCHEMA_VERSION) errors.push(`${label}: unsupported schema version`);
    if (!record.testId) errors.push(`${label || '<empty>'}: test ID is required`);
    if (!record.owner) errors.push(`${label}: owner is required`);
    if (!record.reason || !record.issue) errors.push(`${label}: reason and issue are required`);
    if (record.projects?.some(project => project === '*' || project.includes('..') || project.includes('/') || project.includes('\\'))) {
      errors.push(`${label}: project scope must use exact project names`);
    }
    const recordKey = key(record);
    if (seen.has(recordKey)) errors.push(`${label}: duplicate record`);
    seen.add(recordKey);
    if (!tests.has(record.testId)) errors.push(`${label}: unknown/orphaned test`);
    const created = Date.parse(record.createdAt);
    const expires = Date.parse(record.expiresAt);
    if (!Number.isFinite(created) || !Number.isFinite(expires)) errors.push(`${label}: invalid dates`);
    else {
      if (expires <= created) errors.push(`${label}: expiry must follow creation`);
      if (expires - created > maxDays * 86_400_000) errors.push(`${label}: expiry exceeds ${maxDays} days`);
      if (expires <= now.getTime()) errors.push(`${label}: expired`);
      else if (expires - now.getTime() <= 3 * 86_400_000) warnings.push(`${label}: expires within three days`);
    }
  }
  return { valid: !errors.length, errors, warnings };
}

async function pause(milliseconds: number): Promise<void> {
  await new Promise<void>(resolvePromise => setTimeout(resolvePromise, milliseconds));
}

async function withLock<T>(file: string, action: () => Promise<T>): Promise<T> {
  const resolved = resolve(file);
  await mkdir(dirname(resolved), { recursive: true, mode: 0o700 });
  const lock = `${resolved}.lock`;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt += 1) {
    try {
      handle = await open(lock, 'wx', 0o600);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      await pause(Math.min(250, 10 + attempt * 5));
    }
  }
  if (!handle) throw new IntegrityError('Timed out acquiring the quarantine mutation lock.');
  try {
    await handle.writeFile(`${process.pid}\n`, 'utf8');
    return await action();
  } finally {
    await handle.close();
    await rm(lock, { force: true });
  }
}

async function atomicWrite(file: string, records: QuarantineRecord[]): Promise<void> {
  const resolved = resolve(file);
  await mkdir(dirname(resolved), { recursive: true, mode: 0o700 });
  const temp = `${resolved}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, `${JSON.stringify(records, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  await rename(temp, resolved);
}

export async function readQuarantine(file: string): Promise<QuarantineRecord[]> {
  try {
    const value = JSON.parse(await readFile(resolve(file), 'utf8')) as unknown;
    if (!Array.isArray(value)) throw new IntegrityError('Quarantine file must contain an array.');
    return value.map(record => normalized(record as QuarantineRecord)).sort(recordOrder);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    if (error instanceof IntegrityError) throw error;
    throw new IntegrityError('Quarantine file is invalid or unreadable.', { message: error instanceof Error ? error.message : String(error) });
  }
}

export async function addQuarantine(
  file: string,
  record: QuarantineRecord,
  knownTests: Iterable<string>,
  now = new Date(),
  maxDays = 14
): Promise<QuarantineMutation> {
  const candidate = normalized(record);
  return await withLock(file, async () => {
    const records = await readQuarantine(file);
    if (records.some(existing => key(existing) === key(candidate))) {
      throw new ConfigurationError(`Quarantine entry already exists for ${candidate.testId}${candidate.projects?.length ? ` [${candidate.projects.join(',')}]` : ''}.`);
    }
    const next = [...records, candidate].sort(recordOrder);
    const validation = validateQuarantine(next, knownTests, now, maxDays);
    if (!validation.valid) throw new PolicyError('Quarantine entry violates policy.', { errors: validation.errors, warnings: validation.warnings });
    await atomicWrite(file, next);
    return { file: resolve(file), changed: true, records: next };
  });
}

export async function removeQuarantine(file: string, testId: string, projects?: string[]): Promise<QuarantineMutation> {
  const target = key({
    schemaVersion: RESULT_SCHEMA_VERSION,
    testId: testId.trim(),
    owner: 'target',
    reason: 'target',
    issue: 'target',
    createdAt: new Date(0).toISOString(),
    expiresAt: new Date(1).toISOString(),
    ...(projects?.length ? { projects } : {})
  });
  if (!testId.trim()) throw new ConfigurationError('quarantine remove requires a stable test ID.');
  return await withLock(file, async () => {
    const records = await readQuarantine(file);
    const next = records.filter(record => key(record) !== target);
    if (next.length === records.length) return { file: resolve(file), changed: false, records };
    await atomicWrite(file, next);
    return { file: resolve(file), changed: true, records: next };
  });
}
