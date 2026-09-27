import { stableHash, type MergedRunResult } from '@azerish25-ux/forgeqa-core';

export interface RunComparison {
  status: 'COMPARABLE' | 'NO_BASELINE';
  reason?: 'missing-baseline' | 'schema' | 'repository' | 'configuration' | 'dimensions';
  added: string[];
  removed: string[];
  shared: string[];
  currentFailures: string[];
  baselineFailures: string[];
  newFailures: string[];
  recoveredFailures: string[];
}

function ids(run: MergedRunResult): Set<string> {
  return new Set(run.attempts.map(attempt => attempt.logicalTestId));
}

function failures(run: MergedRunResult): string[] {
  const latest = new Map<string, { retry: number; outcome: string }>();
  for (const attempt of run.attempts) {
    const previous = latest.get(attempt.logicalTestId);
    if (!previous || attempt.retry >= previous.retry) latest.set(attempt.logicalTestId, { retry: attempt.retry, outcome: attempt.outcome });
  }
  return [...latest]
    .filter(([, value]) => ['failed', 'timed-out', 'unexpected-pass', 'cancelled'].includes(value.outcome))
    .map(([id]) => id)
    .sort();
}

function dimensions(run: MergedRunResult): string {
  const values = run.inventory?.map(item => ({ project: item.project, browser: item.browser ?? '', environment: item.environment }))
    ?? run.attempts.map(item => ({ project: item.project ?? '', browser: item.browser ?? '', environment: item.environment ?? '' }));
  return stableHash([...new Set(values.map(value => `${value.project}\u0000${value.browser}\u0000${value.environment}`))].sort());
}

function noBaseline(current: MergedRunResult, reason: NonNullable<RunComparison['reason']>): RunComparison {
  return {
    status: 'NO_BASELINE',
    reason,
    added: [...ids(current)].sort(),
    removed: [],
    shared: [],
    currentFailures: failures(current),
    baselineFailures: [],
    newFailures: failures(current),
    recoveredFailures: []
  };
}

export function compareRuns(current: MergedRunResult, baseline?: MergedRunResult): RunComparison {
  if (!baseline) return noBaseline(current, 'missing-baseline');
  if (baseline.schemaVersion !== current.schemaVersion) return noBaseline(current, 'schema');
  if (baseline.revision.repository !== current.revision.repository) return noBaseline(current, 'repository');
  if (baseline.configHash !== current.configHash) return noBaseline(current, 'configuration');
  if (dimensions(baseline) !== dimensions(current)) return noBaseline(current, 'dimensions');
  const currentIds = ids(current);
  const baselineIds = ids(baseline);
  const currentFailures = failures(current);
  const baselineFailures = failures(baseline);
  const currentFailureSet = new Set(currentFailures);
  const baselineFailureSet = new Set(baselineFailures);
  return {
    status: 'COMPARABLE',
    added: [...currentIds].filter(id => !baselineIds.has(id)).sort(),
    removed: [...baselineIds].filter(id => !currentIds.has(id)).sort(),
    shared: [...currentIds].filter(id => baselineIds.has(id)).sort(),
    currentFailures,
    baselineFailures,
    newFailures: currentFailures.filter(id => !baselineFailureSet.has(id)),
    recoveredFailures: baselineFailures.filter(id => !currentFailureSet.has(id))
  };
}
