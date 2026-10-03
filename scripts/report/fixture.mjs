/** Deliberately synthetic report data; never a receipt for a real test run. */
import { RESULT_SCHEMA_VERSION, evaluateGates } from '@azerish25-ux/forgeqa-core';
export function reportFixture() {
  const definitions = [
    ['tenant-boundary', 'A member cannot read another workspace', 'passed', 218, 'security', 'chromium'],
    ['checkout-recovery', 'A retry recovers the original checkout', 'failed', 1640, 'payments', 'chromium'],
    ['invoice-export', 'Export preserves the invoice line items', 'failed', 850, 'billing', 'firefox'],
    ['audit-timeout', 'The audit event arrives before the deadline', 'timed-out', 5200, 'platform', 'webkit'],
    [
      'planned-migration',
      'Legacy workspace migration remains deferred',
      'skipped',
      0,
      'platform',
      'chromium'
    ],
    [
      'documented-defect',
      'A known preview restriction stays explicit',
      'expected-failure',
      320,
      'documents',
      'firefox'
    ],
    ['permission-change', 'A revoked role loses edit permission', 'passed', 190, 'security', 'webkit']
  ];
  const attempts = definitions.map(([id, title, outcome, durationMs, owner, project]) => ({
    schemaVersion: RESULT_SCHEMA_VERSION,
    attemptId: `${id}-0`,
    executionId: `${id}-${project}`,
    logicalTestId: id,
    title,
    retry: 0,
    outcome,
    durationMs,
    owner,
    project,
    browser: project,
    environment: 'synthetic-demo',
    startedAt: '2026-10-03T12:00:00.000Z',
    ...(['failed', 'timed-out'].includes(outcome)
      ? {
          error: {
            name: 'AssertionError',
            message: `Synthetic diagnostic for ${id}.\nExpected the recorded result to match the test contract.\nThis is an illustrative fixture, not a production failure.`
          }
        }
      : {}),
    artifacts:
      id === 'checkout-recovery'
        ? [{ type: 'log', state: 'captured', path: 'artifacts/diagnostic.txt' }]
        : id === 'audit-timeout'
          ? [{ type: 'trace', state: 'unavailable', path: 'artifacts/unavailable.zip' }]
          : []
  }));
  attempts.splice(2, 0, {
    ...attempts[1],
    attemptId: 'checkout-recovery-1',
    retry: 1,
    outcome: 'passed',
    durationMs: 410,
    error: undefined,
    artifacts: []
  });
  const run = {
    schemaVersion: RESULT_SCHEMA_VERSION,
    runId: 'SYNTHETIC DEMO · not execution evidence',
    completion: 'complete',
    selectionHash: 'synthetic-selection',
    configHash: 'synthetic-configuration',
    revision: {
      repository: 'synthetic/report-fixtures',
      branch: 'demo',
      sourceCommit: 'illustrative',
      testedCommit: 'illustrative'
    },
    attempts,
    missingExecutions: [],
    unexpectedExecutions: [],
    duplicateExecutions: [],
    shardIds: ['synthetic-shard-1']
  };
  run.gate = evaluateGates(run, [], {
    failOnRetryRecovered: true,
    unexpectedSkipBudget: 0,
    requireCompleteShards: true,
    maxQuarantineEntries: 20
  });
  return run;
}
