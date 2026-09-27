import test from 'node:test';
import assert from 'node:assert/strict';
import { toHtmlReport, toJUnit, toMarkdownSummary } from '@azerish25-ux/forgeqa-reporter';
import { RESULT_SCHEMA_VERSION } from '@azerish25-ux/forgeqa-core';

const run = {
  schemaVersion: RESULT_SCHEMA_VERSION,
  runId: 'current-run',
  completion: 'complete',
  selectionHash: 'selection-a',
  configHash: 'config-a',
  revision: { repository: 'example/repo', sourceCommit: 'a'.repeat(40), testedCommit: 'a'.repeat(40), branch: 'main' },
  attempts: [{
    schemaVersion: RESULT_SCHEMA_VERSION,
    attemptId: 'attempt-1',
    executionId: 'checkout-chromium',
    logicalTestId: 'checkout-payment',
    retry: 0,
    outcome: 'passed',
    startedAt: '2026-09-27T00:00:00Z',
    durationMs: 25,
    title: 'checkout succeeds',
    project: 'chromium',
    browser: 'chromium',
    environment: 'ci',
    owner: 'payments@example.test'
  }],
  missingExecutions: [],
  unexpectedExecutions: [],
  duplicateExecutions: [],
  shardIds: ['shard-1'],
  gate: { outcome: 'pass', violations: [] }
};
const metrics = {
  N: 25,
  F: 2,
  I: 3,
  P: 1,
  retryObservedFlakeRate: 0.08,
  firstAttemptFailureRate: 0.12,
  persistentFailureRate: 0.04,
  retryRecoveryRate: 2 / 3,
  sufficientSamples: true,
  firstObservedAt: '2026-09-01T00:00:00Z',
  lastObservedAt: '2026-09-27T00:00:00Z',
  failedAttemptDurationMs: 1400,
  affectedBrowsers: ['chromium'],
  affectedEnvironments: ['ci']
};
const history = {
  status: 'COMPARABLE',
  currentRunId: 'current-run',
  comparableRuns: 24,
  rejectedRuns: { provenance: 1, 'outside-window': 2 },
  observationWindow: { start: '2026-08-28T00:00:00Z', end: '2026-09-27T00:00:00Z' },
  metrics,
  tests: {
    'checkout-payment': {
      logicalTestId: 'checkout-payment',
      owner: 'payments@example.test',
      executions: 25,
      ...metrics
    }
  },
  comparison: {
    status: 'COMPARABLE',
    added: [],
    removed: [],
    shared: ['checkout-payment'],
    currentFailures: [],
    baselineFailures: ['checkout-payment']
  }
};

test('JUnit exposes run-level and per-test historical reliability without inventing passing tests', () => {
  const junit = toJUnit(run, history);
  assert.match(junit, /forgeqa\.history\.status" value="COMPARABLE"/);
  assert.match(junit, /forgeqa\.history\.N" value="25"/);
  assert.match(junit, /retryObservedFlakeRate" value="0\.08"/);
  assert.equal((junit.match(/<testcase /g) ?? []).length, 1);
});

test('HTML and Markdown render comparable history, rates, ownership, and rejected observations', () => {
  const html = toHtmlReport(run, history);
  const markdown = toMarkdownSummary(run, history);
  assert.match(html, /Historical reliability/);
  assert.match(html, /Status: COMPARABLE/);
  assert.match(html, /8\.00%/);
  assert.match(html, /payments@example\.test/);
  assert.match(markdown, /N\/F\/I\/P: 25\/2\/3\/1/);
  assert.match(markdown, /provenance=1/);
});

test('reports state NO_BASELINE rather than presenting absent history as zero flakiness', () => {
  assert.match(toHtmlReport(run), /Status: NO_BASELINE/);
  assert.match(toJUnit(run), /forgeqa\.history\.status" value="NO_BASELINE"/);
});
