import type { AttemptRecord } from '@azerish25-ux/forgeqa-core';

export interface ReliabilityMetrics {
  N: number;
  F: number;
  I: number;
  P: number;
  retryObservedFlakeRate: number | null;
  firstAttemptFailureRate: number | null;
  persistentFailureRate: number | null;
  retryRecoveryRate: number | null;
  sufficientSamples: boolean;
  firstObservedAt: string | null;
  lastObservedAt: string | null;
  failedAttemptDurationMs: number;
  affectedBrowsers: string[];
  affectedEnvironments: string[];
}

export interface TestReliability extends ReliabilityMetrics {
  logicalTestId: string;
  owner: string | null;
  executions: number;
}

function failed(outcome: AttemptRecord['outcome']): boolean {
  return ['failed', 'timed-out', 'cancelled', 'unexpected-pass'].includes(outcome);
}

function eligible(outcome: AttemptRecord['outcome']): boolean {
  return !['skipped', 'cancelled', 'expected-failure'].includes(outcome);
}

function rate(numerator: number, denominator: number): number | null {
  return denominator ? numerator / denominator : null;
}

function orderedGroups(attempts: AttemptRecord[]): Map<string, AttemptRecord[]> {
  const groups = new Map<string, AttemptRecord[]>();
  for (const attempt of attempts) {
    const values = groups.get(attempt.executionId) ?? [];
    values.push(attempt);
    groups.set(attempt.executionId, values);
  }
  for (const values of groups.values()) {
    values.sort((a, b) => a.retry - b.retry || Date.parse(a.startedAt) - Date.parse(b.startedAt) || a.attemptId.localeCompare(b.attemptId));
  }
  return groups;
}

export function calculateReliability(attempts: AttemptRecord[], minimumSamples = 20): ReliabilityMetrics {
  const groups = orderedGroups(attempts);
  let N = 0;
  let F = 0;
  let I = 0;
  let P = 0;
  let failedAttemptDurationMs = 0;
  let firstObservedAt: string | null = null;
  let lastObservedAt: string | null = null;
  const browsers = new Set<string>();
  const environments = new Set<string>();
  for (const values of groups.values()) {
    const first = values[0]!;
    const last = values.at(-1)!;
    if (!eligible(first.outcome)) continue;
    N += 1;
    const initialFailed = failed(first.outcome);
    const finalFailed = failed(last.outcome);
    if (initialFailed) I += 1;
    if (initialFailed && last.outcome === 'passed') F += 1;
    if (finalFailed) P += 1;
    for (const attempt of values) {
      if (failed(attempt.outcome)) failedAttemptDurationMs += Math.max(0, attempt.durationMs);
      if (attempt.browser) browsers.add(attempt.browser);
      if (attempt.environment) environments.add(attempt.environment);
      if (Number.isFinite(Date.parse(attempt.startedAt))) {
        if (!firstObservedAt || Date.parse(attempt.startedAt) < Date.parse(firstObservedAt)) firstObservedAt = attempt.startedAt;
        if (!lastObservedAt || Date.parse(attempt.startedAt) > Date.parse(lastObservedAt)) lastObservedAt = attempt.startedAt;
      }
    }
  }
  return {
    N,
    F,
    I,
    P,
    retryObservedFlakeRate: rate(F, N),
    firstAttemptFailureRate: rate(I, N),
    persistentFailureRate: rate(P, N),
    retryRecoveryRate: rate(F, I),
    sufficientSamples: N >= minimumSamples,
    firstObservedAt,
    lastObservedAt,
    failedAttemptDurationMs,
    affectedBrowsers: [...browsers].sort(),
    affectedEnvironments: [...environments].sort()
  };
}

export function calculateReliabilityByTest(attempts: AttemptRecord[], minimumSamples = 20): Record<string, TestReliability> {
  const grouped = new Map<string, AttemptRecord[]>();
  for (const attempt of attempts) {
    const values = grouped.get(attempt.logicalTestId) ?? [];
    values.push(attempt);
    grouped.set(attempt.logicalTestId, values);
  }
  const output: Record<string, TestReliability> = {};
  for (const [logicalTestId, values] of [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const metrics = calculateReliability(values, minimumSamples);
    const owners = [...new Set(values.map(value => value.owner).filter((owner): owner is string => Boolean(owner)))].sort();
    output[logicalTestId] = {
      logicalTestId,
      owner: owners.length === 1 ? owners[0]! : null,
      executions: metrics.N,
      ...metrics
    };
  }
  return output;
}
