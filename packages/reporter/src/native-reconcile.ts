import { isAbsolute, relative } from 'node:path';
import {
  IntegrityError,
  type AttemptOutcome,
  type ExpectedExecution,
  type MergedRunResult,
  type NativeReportReconciliation
} from '@azerish25-ux/forgeqa-core';

interface NativeExecution {
  key: string;
  project: string;
  outcomes: AttemptOutcome[];
  retries: number[];
}
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function asArray(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function normalizeFile(value: string): string {
  const normalized = value.replace(/\\/g, '/');
  const path = isAbsolute(value) ? relative(process.cwd(), value).replace(/\\/g, '/') : normalized;
  return path.replace(/^\.\//, '');
}
function executionKey(project: string, file: string, title: string): string {
  return JSON.stringify([project, normalizeFile(file), title.trim().replace(/\s+/g, ' ')]);
}
function outcome(status: unknown, expectedStatus: unknown): AttemptOutcome {
  if (status === 'skipped') return 'skipped';
  if (status === 'interrupted') return 'cancelled';
  if (status === 'passed') return expectedStatus === 'passed' || expectedStatus === undefined ? 'passed' : 'unexpected-pass';
  if (status === expectedStatus) return 'expected-failure';
  if (status === 'timedOut') return 'timed-out';
  return 'failed';
}
function outcomeCounts(): Record<AttemptOutcome, number> {
  return { passed: 0, failed: 0, 'timed-out': 0, skipped: 0, 'expected-failure': 0, 'unexpected-pass': 0, cancelled: 0 };
}
function sortedRecord(record: Record<string, number>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b))));
}
function signature(key: string, retries: number[], outcomes: AttemptOutcome[]): string {
  return `${key}\u0000${retries.map((retry, index) => `${retry}:${outcomes[index]}`).join(',')}`;
}
function inventoryKey(execution: ExpectedExecution): string {
  if (!execution.relativePath || !execution.title) throw new IntegrityError(`Expected execution ${execution.executionId} lacks file/title identity required for native reconciliation.`);
  return executionKey(execution.project, execution.relativePath, execution.title);
}
function firstDifference(left: string[], right: string[]): { index: number; forgeqa?: string; native?: string } | undefined {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const forgeqa = left[index];
    const native = right[index];
    if (forgeqa === native) continue;
    const result: { index: number; forgeqa?: string; native?: string } = { index };
    if (forgeqa !== undefined) result.forgeqa = forgeqa;
    if (native !== undefined) result.native = native;
    return result;
  }
  return undefined;
}

export function reconcileNativeJson(run: MergedRunResult, nativeJson: unknown): NativeReportReconciliation {
  const root = asRecord(nativeJson);
  if (!root) throw new IntegrityError('Native Playwright JSON report must be an object.');
  if (!run.inventory?.length) throw new IntegrityError('Canonical execution inventory is required for native report reconciliation.');

  const native: NativeExecution[] = [];
  const visitSuite = (value: unknown, inheritedFile = ''): void => {
    const suite = asRecord(value);
    if (!suite) return;
    const suiteFile = typeof suite['file'] === 'string' ? suite['file'] : inheritedFile;
    for (const child of asArray(suite['suites'])) visitSuite(child, suiteFile);
    for (const specValue of asArray(suite['specs'])) {
      const spec = asRecord(specValue);
      if (!spec) continue;
      const file = typeof spec['file'] === 'string' ? spec['file'] : suiteFile;
      const title = typeof spec['title'] === 'string' ? spec['title'] : '';
      if (!file || !title) throw new IntegrityError('Native Playwright JSON is missing a spec file or title.');
      for (const testValue of asArray(spec['tests'])) {
        const nativeTest = asRecord(testValue);
        if (!nativeTest) continue;
        const project = typeof nativeTest['projectName'] === 'string' ? nativeTest['projectName'] : '';
        const attempts = asArray(nativeTest['results']).map(resultValue => {
          const result = asRecord(resultValue);
          if (!result) throw new IntegrityError('Native Playwright JSON contains an invalid result.');
          const retry = typeof result['retry'] === 'number' ? result['retry'] : 0;
          return { retry, outcome: outcome(result['status'], nativeTest['expectedStatus']) };
        }).sort((a, b) => a.retry - b.retry);
        if (!attempts.length) throw new IntegrityError(`Native Playwright execution ${project}/${file}/${title} contains no attempts.`);
        if (attempts.some((attempt, index) => attempt.retry !== index)) throw new IntegrityError(`Native Playwright execution ${project}/${file}/${title} has a missing or duplicate retry index.`);
        native.push({ key: executionKey(project, file, title), project, retries: attempts.map(item => item.retry), outcomes: attempts.map(item => item.outcome) });
      }
    }
  };
  for (const suite of asArray(root['suites'])) visitSuite(suite);

  const expectedByExecution = new Map(run.inventory.map(execution => [execution.executionId, execution]));
  if (expectedByExecution.size !== run.inventory.length) throw new IntegrityError('Canonical execution inventory contains duplicate execution IDs.');
  const attemptsByExecution = new Map<string, typeof run.attempts>();
  for (const attempt of run.attempts) attemptsByExecution.set(attempt.executionId, [...(attemptsByExecution.get(attempt.executionId) ?? []), attempt]);
  const forgeSignatures: string[] = [];
  const nativeSignatures: string[] = [];
  const forgeOutcomes = outcomeCounts();
  const nativeOutcomes = outcomeCounts();
  const forgeProjects: Record<string, number> = {};
  const nativeProjects: Record<string, number> = {};

  for (const execution of run.inventory) {
    const attempts = [...(attemptsByExecution.get(execution.executionId) ?? [])].sort((a, b) => a.retry - b.retry);
    if (!attempts.length) throw new IntegrityError(`Canonical execution ${execution.executionId} contains no attempts.`);
    if (attempts.some((attempt, index) => attempt.retry !== index)) throw new IntegrityError(`Canonical execution ${execution.executionId} has a missing or duplicate retry index.`);
    const key = inventoryKey(execution);
    forgeSignatures.push(signature(key, attempts.map(item => item.retry), attempts.map(item => item.outcome)));
    forgeProjects[execution.project] = (forgeProjects[execution.project] ?? 0) + 1;
    for (const attempt of attempts) forgeOutcomes[attempt.outcome] += 1;
  }
  for (const executionId of attemptsByExecution.keys()) if (!expectedByExecution.has(executionId)) throw new IntegrityError(`Canonical attempts contain unexpected execution ${executionId}.`);
  for (const execution of native) {
    nativeSignatures.push(signature(execution.key, execution.retries, execution.outcomes));
    nativeProjects[execution.project] = (nativeProjects[execution.project] ?? 0) + 1;
    for (const value of execution.outcomes) nativeOutcomes[value] += 1;
  }
  forgeSignatures.sort(); nativeSignatures.sort();
  const forgeAttempts = run.attempts.length;
  const nativeAttempts = native.reduce((total, execution) => total + execution.outcomes.length, 0);
  const difference = firstDifference(forgeSignatures, nativeSignatures);
  if (difference || native.length !== run.inventory.length || nativeAttempts !== forgeAttempts || sortedRecord(nativeOutcomes) !== sortedRecord(forgeOutcomes) || sortedRecord(nativeProjects) !== sortedRecord(forgeProjects)) {
    throw new IntegrityError('Native Playwright report disagrees with the canonical ForgeQA result.', {
      nativeTests: native.length,
      forgeTests: run.inventory.length,
      nativeAttempts,
      forgeAttempts,
      nativeOutcomes,
      forgeOutcomes,
      nativeProjects,
      forgeProjects,
      firstIdentityOrRetryDifference: difference
    });
  }
  return {
    status: 'MATCHED',
    forgeqaTests: run.inventory.length,
    nativeTests: native.length,
    forgeqaAttempts: forgeAttempts,
    nativeAttempts,
    outcomes: forgeOutcomes,
    projects: forgeProjects
  };
}
