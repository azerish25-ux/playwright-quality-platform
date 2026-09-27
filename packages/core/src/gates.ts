import type { AttemptRecord, MergedRunResult, QuarantineRecord } from './contracts.js';
import type { ForgeQualityGates } from './config.js';

export interface GateViolation {
  id: string;
  severity: 'error' | 'warning';
  message: string;
  observed?: unknown;
  threshold?: unknown;
  affected?: string[];
  remediation: string;
}

export interface GatePolicy {
  failOnRetryRecovered: boolean;
  unexpectedSkipBudget: number;
  requireCompleteShards: boolean;
  maxQuarantineEntries: number;
  requireArtifacts?: string[];
  durationBudgetMs?: number;
}

export interface GateDecision {
  outcome: 'pass' | 'fail';
  violations: GateViolation[];
}

export function gatePolicy(input: ForgeQualityGates = {}): GatePolicy {
  return {
    failOnRetryRecovered: true,
    unexpectedSkipBudget: 0,
    requireCompleteShards: true,
    maxQuarantineEntries: 20,
    ...input,
  };
}

function violationOrder(left: GateViolation, right: GateViolation): number {
  return left.id.localeCompare(right.id)
    || left.message.localeCompare(right.message)
    || (left.affected ?? []).join('\0').localeCompare((right.affected ?? []).join('\0'));
}

export function evaluateGates(run: MergedRunResult, quarantines: QuarantineRecord[], policy: GatePolicy): GateDecision {
  const violations: GateViolation[] = [];
  const fail = (id: string, message: string, affected?: string[]) => violations.push({
    id,
    severity: 'error',
    message,
    ...(affected ? { affected: [...affected].sort() } : {}),
    remediation: 'Repair the reported defect or infrastructure; do not suppress execution evidence.',
  });

  if (run.completion !== 'complete') fail('run.incomplete', `Run completion is ${run.completion}.`);
  if (run.infrastructureErrors?.length) fail('run.infrastructure', [...run.infrastructureErrors].sort().join('; '));
  if (run.runnerStatus && run.runnerStatus !== 'passed') fail('runner.failed', `Native runner status: ${run.runnerStatus}.`);
  if (run.missingExecutions.length || run.unexpectedExecutions.length || run.duplicateExecutions.length) {
    fail(
      'inventory.incomplete',
      'Execution inventory was not reconciled.',
      [...run.missingExecutions, ...run.unexpectedExecutions, ...run.duplicateExecutions],
    );
  }

  const executions = new Map<string, AttemptRecord[]>();
  for (const attempt of run.attempts) {
    executions.set(attempt.executionId, [...(executions.get(attempt.executionId) ?? []), attempt]);
  }

  let skipped = 0;
  for (const [id, attempts] of [...executions.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    attempts.sort((left, right) => left.retry - right.retry || left.attemptId.localeCompare(right.attemptId));
    const last = attempts.at(-1)!;
    if (attempts.some((attempt, index) => attempt.retry !== index)) {
      fail('attempt.invalid-sequence', `Execution ${id} has a missing or duplicate attempt.`, [last.logicalTestId]);
    }
    if (['failed', 'timed-out', 'unexpected-pass', 'cancelled'].includes(last.outcome)) {
      fail('test.unexpected-outcome', `Execution ${id} ended as ${last.outcome}.`, [last.logicalTestId]);
    }
    if (
      last.outcome === 'passed'
      && attempts.slice(0, -1).some((attempt) => ['failed', 'timed-out'].includes(attempt.outcome))
      && policy.failOnRetryRecovered
    ) {
      fail('test.retry-recovered', `Execution ${id} recovered on retry.`, [last.logicalTestId]);
    }
    if (last.outcome === 'skipped') skipped += 1;
    for (const kind of [...(policy.requireArtifacts ?? [])].sort()) {
      if (!attempts.some((attempt) => attempt.artifacts?.some((item) => item.type === kind && item.state === 'captured'))) {
        fail('artifact.required', `Execution ${id} lacks required ${kind} evidence.`, [last.logicalTestId]);
      }
    }
  }

  if (skipped > policy.unexpectedSkipBudget) {
    fail('test.skip-budget', `Unexpected skips ${skipped} exceed budget ${policy.unexpectedSkipBudget}.`);
  }
  if (
    policy.durationBudgetMs !== undefined
    && run.attempts.reduce((total, attempt) => total + attempt.durationMs, 0) > policy.durationBudgetMs
  ) {
    fail('duration.budget', 'Total attempt time exceeds the configured budget.');
  }

  if (!Array.isArray(quarantines)) {
    fail('quarantine.invalid', 'Quarantine must be an array.');
  } else {
    if (quarantines.length > policy.maxQuarantineEntries) {
      fail('quarantine.limit', 'Quarantine count exceeds policy.');
    }
    const seen = new Set<string>();
    const orderedQuarantines = [...quarantines].sort((left, right) => {
      const leftId = left && typeof left === 'object' && typeof left.testId === 'string' ? left.testId : '';
      const rightId = right && typeof right === 'object' && typeof right.testId === 'string' ? right.testId : '';
      return leftId.localeCompare(rightId);
    });
    for (const entry of orderedQuarantines) {
      if (!entry || typeof entry !== 'object') {
        fail('quarantine.invalid', 'Invalid quarantine entry.');
        continue;
      }
      const dates = [Date.parse(entry.createdAt), Date.parse(entry.expiresAt)];
      if (
        entry.schemaVersion !== 1
        || ![entry.testId, entry.owner, entry.reason, entry.issue].every((value) => typeof value === 'string' && value.trim())
        || dates.some((value) => !Number.isFinite(value))
        || dates[1]! <= dates[0]!
        || dates[1]! - dates[0]! > 14 * 86_400_000
        || seen.has(entry.testId)
      ) {
        fail('quarantine.invalid', `Invalid ownership, dates, or duplicate record for ${entry.testId}.`);
      }
      if (dates[1]! <= Date.now()) {
        fail('quarantine.expired', `Quarantine expired for ${entry.testId}.`, [entry.testId]);
      }
      seen.add(entry.testId);
    }
  }

  violations.sort(violationOrder);
  return {
    outcome: violations.some((violation) => violation.severity === 'error') ? 'fail' : 'pass',
    violations,
  };
}
