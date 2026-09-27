import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  addQuarantine,
  analyzeHistory,
  createHistoryRecord,
  importHistory,
  readHistory,
  readHistoryRecords,
  readQuarantine,
  removeQuarantine,
  selectComparableHistory
} from '@azerish25-ux/forgeqa-flake-analysis';
import { RESULT_SCHEMA_VERSION } from '@azerish25-ux/forgeqa-core';

function attempt(runId, logicalTestId, retry, outcome, startedAt = '2026-01-01T00:00:00.000Z') {
  return {
    schemaVersion: RESULT_SCHEMA_VERSION,
    attemptId: `${runId}-${logicalTestId}-${retry}`,
    executionId: `${logicalTestId}-chromium`,
    logicalTestId,
    retry,
    outcome,
    startedAt,
    durationMs: 10,
    project: 'chromium',
    browser: 'chromium',
    environment: 'ci',
    owner: 'quality@example.test'
  };
}

function run(runId, testedCommit, attempts, overrides = {}) {
  return {
    schemaVersion: RESULT_SCHEMA_VERSION,
    runId,
    completion: 'complete',
    selectionHash: 'selection-a',
    configHash: 'config-a',
    revision: {
      repository: 'example/repository',
      sourceCommit: testedCommit,
      testedCommit,
      branch: 'main'
    },
    attempts,
    missingExecutions: [],
    unexpectedExecutions: [],
    duplicateExecutions: [],
    shardIds: [`${runId}-shard`],
    inventory: [...new Map(attempts.map(value => [value.logicalTestId, {
      executionId: value.executionId,
      logicalTestId: value.logicalTestId,
      project: 'chromium',
      browser: 'chromium',
      environment: 'ci',
      shardIndex: 1,
      shardTotal: 1
    }])).values()],
    ...overrides
  };
}

test('history import is immutable and identical duplicates are idempotent', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'forgeqa-history-'));
  const report = resolve(root, 'report.json');
  const store = resolve(root, 'store');
  const original = run('run-1', 'a'.repeat(40), [attempt('run-1', 'login', 0, 'passed')]);
  await writeFile(report, `${JSON.stringify(original)}\n`);
  const first = await importHistory(store, [report], { now: new Date('2026-01-02T00:00:00Z'), maxAgeDays: 365 });
  assert.equal(first.imported, 1);
  const second = await importHistory(store, [report], { now: new Date('2026-01-02T00:00:01Z'), maxAgeDays: 365 });
  assert.deepEqual({ imported: second.imported, skipped: second.skipped }, { imported: 0, skipped: 1 });
  const records = await readHistoryRecords(store);
  assert.equal(records.length, 1);
  assert.equal(records[0].result.runId, 'run-1');
});

test('conflicting duplicate history identity fails closed', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'forgeqa-history-conflict-'));
  const report = resolve(root, 'report.json');
  const store = resolve(root, 'store');
  const first = run('run-conflict', 'b'.repeat(40), [attempt('run-conflict', 'checkout', 0, 'passed')]);
  await writeFile(report, `${JSON.stringify(first)}\n`);
  await importHistory(store, [report], { now: new Date('2026-01-02T00:00:00Z'), maxAgeDays: 365 });
  const changed = run('run-conflict', 'b'.repeat(40), [attempt('run-conflict', 'checkout', 0, 'failed')]);
  await writeFile(report, `${JSON.stringify(changed)}\n`);
  await assert.rejects(
    importHistory(store, [report], { now: new Date('2026-01-02T00:00:01Z'), maxAgeDays: 365 }),
    error => error?.code === 'FORGEQA_INTEGRITY' && /Conflicting duplicate/.test(error.message)
  );
});

test('concurrent identical imports serialize without corrupting the manifest', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'forgeqa-history-concurrent-'));
  const report = resolve(root, 'report.json');
  const store = resolve(root, 'store');
  await writeFile(report, `${JSON.stringify(run('run-concurrent', 'c'.repeat(40), [attempt('run-concurrent', 'profile', 0, 'passed')]))}\n`);
  const results = await Promise.all([
    importHistory(store, [report], { now: new Date('2026-01-02T00:00:00Z'), maxAgeDays: 365 }),
    importHistory(store, [report], { now: new Date('2026-01-02T00:00:01Z'), maxAgeDays: 365 })
  ]);
  assert.equal(results.reduce((sum, value) => sum + value.imported, 0), 1);
  assert.equal(results.reduce((sum, value) => sum + value.skipped, 0), 1);
  assert.equal((await readHistoryRecords(store)).length, 1);
});

test('history records reject checksum tampering', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'forgeqa-history-tamper-'));
  const result = run('run-tamper', 'd'.repeat(40), [attempt('run-tamper', 'settings', 0, 'passed')]);
  const record = createHistoryRecord(result, 'trusted-default-branch', '2026-01-02T00:00:00Z');
  const path = resolve(root, 'record.json');
  await writeFile(path, `${JSON.stringify({ ...record, checksum: '0'.repeat(64) })}\n`);
  await assert.rejects(readHistory(path), error => error?.code === 'FORGEQA_INTEGRITY' && /checksum/.test(error.message));
});

test('historical analysis separates trusted comparable runs from untrusted and incompatible observations', () => {
  const current = run('current', 'e'.repeat(40), [attempt('current', 'search', 0, 'passed', '2026-01-04T00:00:00Z')]);
  const flaky = run('flaky', 'f'.repeat(40), [
    attempt('flaky', 'search', 0, 'failed', '2026-01-03T00:00:00Z'),
    attempt('flaky', 'search', 1, 'passed', '2026-01-03T00:00:01Z')
  ]);
  const persistent = run('persistent', '1'.repeat(40), [attempt('persistent', 'search', 0, 'failed', '2026-01-02T00:00:00Z')]);
  const untrusted = createHistoryRecord(run('pr', '2'.repeat(40), [attempt('pr', 'search', 0, 'failed')]), 'untrusted-pr', '2026-01-03T00:00:00Z');
  const incompatible = createHistoryRecord(run('other', '3'.repeat(40), [attempt('other', 'search', 0, 'failed')], { configHash: 'config-b' }), 'trusted-default-branch', '2026-01-03T00:00:00Z');
  const records = [
    createHistoryRecord(flaky, 'trusted-default-branch', '2026-01-03T00:00:00Z'),
    createHistoryRecord(persistent, 'trusted-default-branch', '2026-01-02T00:00:00Z'),
    untrusted,
    incompatible
  ];
  const selection = selectComparableHistory(current, records, { now: new Date('2026-01-05T00:00:00Z') });
  assert.equal(selection.records.length, 2);
  assert.deepEqual(selection.rejected, { provenance: 1, configuration: 1 });
  const analysis = analyzeHistory(current, records, 3, { now: new Date('2026-01-05T00:00:00Z') });
  assert.equal(analysis.status, 'COMPARABLE');
  assert.deepEqual({ N: analysis.metrics.N, F: analysis.metrics.F, I: analysis.metrics.I, P: analysis.metrics.P }, { N: 3, F: 1, I: 2, P: 1 });
  assert.equal(analysis.tests.search.retryObservedFlakeRate, 1 / 3);
});

test('quarantine add and remove are explicit, atomic and do not mask policy', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'forgeqa-quarantine-'));
  const file = resolve(root, 'quarantine.json');
  const now = new Date('2026-01-01T00:00:00Z');
  const record = {
    schemaVersion: RESULT_SCHEMA_VERSION,
    testId: 'checkout-payment',
    owner: 'payments@example.test',
    reason: 'intermittent provider sandbox response',
    issue: 'https://example.test/issues/123',
    createdAt: now.toISOString(),
    expiresAt: '2026-01-10T00:00:00Z',
    projects: ['chromium']
  };
  const added = await addQuarantine(file, record, ['checkout-payment'], now);
  assert.equal(added.changed, true);
  assert.equal((await readQuarantine(file))[0].owner, 'payments@example.test');
  await assert.rejects(addQuarantine(file, record, ['checkout-payment'], now), error => error?.code === 'FORGEQA_CONFIG');
  const removed = await removeQuarantine(file, 'checkout-payment', ['chromium']);
  assert.equal(removed.changed, true);
  assert.deepEqual(await readQuarantine(file), []);
});
