import { ConfigurationError } from './errors.js';
import { sha256, stableStringify } from './stable.js';
function segment(value: string): string { return value.trim().replace(/\\/g, '/').replace(/\s+/g, ' '); }
export function logicalTestIdentity(input: { explicitId?: string; relativePath: string; titlePath: string[] }): string {
  if (input.explicitId) {
    const id = segment(input.explicitId);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{2,159}$/.test(id)) throw new ConfigurationError(`Invalid explicit test id: ${id}`);
    return id;
  }
  const path = segment(input.relativePath).replace(/^\.\//, '');
  const titles = input.titlePath.map(segment).filter(Boolean);
  if (!path || !titles.length) throw new ConfigurationError('A logical test identity requires a relative path and title hierarchy.');
  return `auto:${sha256(stableStringify({ path, titles })).slice(0, 24)}`;
}
export function executionIdentity(input: { consumer: string; environment: string; project: string; repetition: number; logicalTestId: string }): string {
  return `exec:${sha256(stableStringify(input)).slice(0, 32)}`;
}
export function attemptIdentity(executionId: string, retry: number): string { return `attempt:${sha256(`${executionId}:${retry}`).slice(0, 32)}`; }
export function runIdentity(input: { repository: string; workflow: string; runNumber: string; runAttempt: string; testedCommit: string }): string {
  return `run:${sha256(stableStringify(input)).slice(0, 32)}`;
}
export function shardIdentity(input: { runId: string; project: string; index: number; total: number }): string {
  if (!Number.isInteger(input.index) || !Number.isInteger(input.total) || input.index < 1 || input.index > input.total) {
    throw new ConfigurationError(`Invalid shard ${input.index}/${input.total}.`);
  }
  return `shard:${sha256(stableStringify(input)).slice(0, 32)}`;
}
