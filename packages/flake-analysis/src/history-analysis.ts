import { ConfigurationError, stableHash, type AttemptRecord, type MergedRunResult } from '@azerish25-ux/forgeqa-core';
import { compareRuns } from './compare.js';
import { calculateReliability, calculateReliabilityByTest } from './metrics.js';
import { validateHistoryResult } from './history-record.js';
import type { HistoryAnalysis, HistoryProvenance, HistoryRecord, HistorySelection, HistorySelectionOptions } from './history-types.js';

function dimensions(run: MergedRunResult): string {
  const entries = run.inventory?.map(item => ({ project: item.project, browser: item.browser ?? '', environment: item.environment }))
    ?? run.attempts.map(item => ({ project: item.project ?? '', browser: item.browser ?? '', environment: item.environment ?? '' }));
  const unique = [...new Set(entries.map(item => `${item.project}\u0000${item.browser}\u0000${item.environment}`))].sort();
  return stableHash(unique);
}

function rejectionReason(current: MergedRunResult, record: HistoryRecord, provenance: HistoryProvenance, cutoff: number): string | undefined {
  const candidate = record.result;
  if (record.provenance !== provenance) return 'provenance';
  if (Date.parse(record.observedAt) < cutoff) return 'outside-window';
  if (candidate.runId === current.runId) return 'current-run';
  if (candidate.completion !== 'complete') return 'incomplete';
  if (candidate.schemaVersion !== current.schemaVersion) return 'schema';
  if (candidate.revision.repository !== current.revision.repository) return 'repository';
  if (candidate.configHash !== current.configHash) return 'configuration';
  if (dimensions(candidate) !== dimensions(current)) return 'dimensions';
  return undefined;
}

export function selectComparableHistory(current: MergedRunResult, records: HistoryRecord[], options: HistorySelectionOptions = {}): HistorySelection {
  validateHistoryResult(current);
  const now = options.now ?? new Date();
  const provenance = options.provenance ?? 'trusted-default-branch';
  const windowDays = options.windowDays ?? 30;
  const maxRuns = options.maxRuns ?? 50;
  if (!Number.isFinite(windowDays) || windowDays < 1 || windowDays > 3650) throw new ConfigurationError('History windowDays must be between 1 and 3650.');
  if (!Number.isInteger(maxRuns) || maxRuns < 1 || maxRuns > 1000) throw new ConfigurationError('History maxRuns must be between 1 and 1000.');
  const cutoff = now.getTime() - windowDays * 86_400_000;
  const rejected: Record<string, number> = {};
  const accepted: HistoryRecord[] = [];
  for (const record of records) {
    const reason = rejectionReason(current, record, provenance, cutoff);
    if (reason) rejected[reason] = (rejected[reason] ?? 0) + 1;
    else accepted.push(record);
  }
  accepted.sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt) || a.importKey.localeCompare(b.importKey));
  return {
    records: accepted.slice(0, maxRuns),
    rejected,
    windowStart: new Date(cutoff).toISOString(),
    windowEnd: now.toISOString()
  };
}

function historicalAttempts(current: MergedRunResult, records: HistoryRecord[]): AttemptRecord[] {
  const runs = [
    { runId: current.runId, attempts: current.attempts },
    ...records.map(record => ({ runId: record.result.runId, attempts: record.result.attempts }))
  ];
  return runs.flatMap(run => run.attempts.map(attempt => ({
    ...attempt,
    attemptId: `${run.runId}:${attempt.attemptId}`,
    executionId: `${run.runId}:${attempt.executionId}`
  })));
}

export function analyzeHistory(
  current: MergedRunResult,
  records: HistoryRecord[],
  minimumSamples = 20,
  options: HistorySelectionOptions = {}
): HistoryAnalysis {
  const selection = selectComparableHistory(current, records, options);
  const attempts = historicalAttempts(current, selection.records);
  const metrics = calculateReliability(attempts, minimumSamples);
  const tests = calculateReliabilityByTest(attempts, minimumSamples);
  const baseline = selection.records[0]?.result;
  const comparison = compareRuns(current, baseline);
  const rejectedCount = Object.values(selection.rejected).reduce((sum, count) => sum + count, 0);
  let status: HistoryAnalysis['status'];
  if (!selection.records.length) status = rejectedCount ? 'HISTORY_INCOMPLETE' : 'NO_BASELINE';
  else if (!metrics.sufficientSamples) status = 'INSUFFICIENT_HISTORY';
  else status = 'COMPARABLE';
  return {
    status,
    currentRunId: current.runId,
    comparableRuns: selection.records.length,
    rejectedRuns: selection.rejected,
    observationWindow: { start: selection.windowStart, end: selection.windowEnd },
    metrics,
    tests,
    comparison
  };
}
