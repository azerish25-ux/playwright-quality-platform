import type { AttemptRecord, MergedRunResult, QuarantineRecord } from './contracts.js';
import type { ForgeQualityGates } from './config.js';
export interface GateViolation {
  id: string; severity: 'error' | 'warning'; message: string;
  observed?: unknown; threshold?: unknown; affected?: string[]; remediation: string;
}
export interface GatePolicy {
  failOnRetryRecovered: boolean; unexpectedSkipBudget: number;
  requireCompleteShards: boolean; maxQuarantineEntries: number;
  requireArtifacts?: string[]; durationBudgetMs?: number;
}
export interface GateDecision { outcome: 'pass' | 'fail'; violations: GateViolation[]; }
export function gatePolicy(input: ForgeQualityGates = {}): GatePolicy {
  return { failOnRetryRecovered: true, unexpectedSkipBudget: 0, requireCompleteShards: true, maxQuarantineEntries: 20, ...input };
}
export function evaluateGates(run: MergedRunResult, quarantines: QuarantineRecord[], policy: GatePolicy): GateDecision {
  const violations: GateViolation[] = [];
  const fail = (id: string, message: string, affected?: string[]) => violations.push({ id, severity: 'error', message, ...(affected ? { affected } : {}), remediation: 'Repair the reported defect or infrastructure; do not suppress execution evidence.' });
  if (run.completion !== 'complete') fail('run.incomplete', `Run completion is ${run.completion}.`);
  if (run.infrastructureErrors?.length) fail('run.infrastructure', run.infrastructureErrors.join('; '));
  if (run.runnerStatus && run.runnerStatus !== 'passed') fail('runner.failed', `Native runner status: ${run.runnerStatus}.`);
  if (run.missingExecutions.length || run.unexpectedExecutions.length || run.duplicateExecutions.length) fail('inventory.incomplete', 'Execution inventory was not reconciled.', [...run.missingExecutions, ...run.unexpectedExecutions, ...run.duplicateExecutions]);
  const executions = new Map<string, AttemptRecord[]>();
  for (const attempt of run.attempts) executions.set(attempt.executionId, [...(executions.get(attempt.executionId) ?? []), attempt]);
  let skipped = 0;
  for (const [id, attempts] of executions) {
    attempts.sort((a, b) => a.retry - b.retry);
    const last = attempts.at(-1)!;
    if (attempts.some((a, i) => a.retry !== i)) fail('attempt.invalid-sequence', `Execution ${id} has a missing or duplicate attempt.`, [last.logicalTestId]);
    if (['failed', 'timed-out', 'unexpected-pass', 'cancelled'].includes(last.outcome)) fail('test.unexpected-outcome', `Execution ${id} ended as ${last.outcome}.`, [last.logicalTestId]);
    if (last.outcome === 'passed' && attempts.slice(0, -1).some(a => ['failed', 'timed-out'].includes(a.outcome)) && policy.failOnRetryRecovered) fail('test.retry-recovered', `Execution ${id} recovered on retry.`, [last.logicalTestId]);
    if (last.outcome === 'skipped') skipped++;
    for (const kind of policy.requireArtifacts ?? []) if (!attempts.some(a => a.artifacts?.some(item => item.type === kind && item.state === 'captured'))) fail('artifact.required', `Execution ${id} lacks required ${kind} evidence.`, [last.logicalTestId]);
  }
  if (skipped > policy.unexpectedSkipBudget) fail('test.skip-budget', `Unexpected skips ${skipped} exceed budget ${policy.unexpectedSkipBudget}.`);
  if (policy.durationBudgetMs !== undefined && run.attempts.reduce((n,a)=>n+a.durationMs,0) > policy.durationBudgetMs) fail('duration.budget', 'Total attempt time exceeds the configured budget.');
  if (!Array.isArray(quarantines)) fail('quarantine.invalid', 'Quarantine must be an array.');
  else {
    if (quarantines.length > policy.maxQuarantineEntries) fail('quarantine.limit', 'Quarantine count exceeds policy.');
    const seen = new Set<string>();
    for (const entry of quarantines) {
      if (!entry || typeof entry !== 'object') { fail('quarantine.invalid', 'Invalid quarantine entry.'); continue; }
      const dates = [Date.parse(entry.createdAt), Date.parse(entry.expiresAt)];
      if (entry.schemaVersion !== 1 || ![entry.testId,entry.owner,entry.reason,entry.issue].every(v=>typeof v==='string' && v.trim()) || dates.some(v=>!Number.isFinite(v)) || dates[1]! <= dates[0]! || dates[1]!-dates[0]! > 14*86_400_000 || seen.has(entry.testId)) fail('quarantine.invalid', `Invalid ownership, dates, or duplicate record for ${entry.testId}.`);
      if (dates[1]! <= Date.now()) fail('quarantine.expired', `Quarantine expired for ${entry.testId}.`, [entry.testId]);
      seen.add(entry.testId);
    }
  }
  return { outcome: violations.some(v=>v.severity==='error') ? 'fail' : 'pass', violations };
}
