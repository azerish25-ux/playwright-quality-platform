import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  RESULT_SCHEMA_VERSION,
  evaluateGates,
  planChangedArea,
  redactValue,
} from '@azerish25-ux/forgeqa-core';
import { validateQuarantine } from '@azerish25-ux/forgeqa-flake-analysis';
import { mergeShardResults } from '@azerish25-ux/forgeqa-reporter';

const revision = { repository: 'repo', sourceCommit: 'a', testedCommit: 'b' };
const manifest = {
  schemaVersion: RESULT_SCHEMA_VERSION,
  runId: 'run',
  selectionHash: 'selection',
  configHash: 'config',
  expected: [
    { executionId: 'e1', logicalTestId: 't1', project: 'chromium', environment: 'local', shardIndex: 1, shardTotal: 2 },
    { executionId: 'e2', logicalTestId: 't2', project: 'chromium', environment: 'local', shardIndex: 2, shardTotal: 2 },
  ],
};

function attempt(id, executionId, logicalTestId, retry = 0, outcome = 'passed') {
  return {
    schemaVersion: RESULT_SCHEMA_VERSION,
    attemptId: id,
    executionId,
    logicalTestId,
    retry,
    outcome,
    startedAt: `2026-01-01T00:00:0${retry}.000Z`,
    durationMs: 1,
  };
}

function shard(index, attempts) {
  return {
    schemaVersion: RESULT_SCHEMA_VERSION,
    runId: 'run',
    shardId: `s${index}`,
    shardIndex: index,
    shardTotal: 2,
    selectionHash: 'selection',
    configHash: 'config',
    completion: 'complete',
    revision,
    attempts,
    finalizedAt: '2026-01-01T00:01:00.000Z',
    journalSha256: `${index}`.repeat(64).slice(0, 64),
  };
}

function baseRun(attempts) {
  return {
    schemaVersion: RESULT_SCHEMA_VERSION,
    runId: 'run',
    completion: 'complete',
    selectionHash: 'selection',
    configHash: 'config',
    revision,
    attempts,
    missingExecutions: [],
    unexpectedExecutions: [],
    duplicateExecutions: [],
    shardIds: ['s1'],
  };
}

function gateOracle(evaluator) {
  const recovered = baseRun([
    attempt('a0', 'e1', 't1', 0, 'failed'),
    attempt('a1', 'e1', 't1', 1, 'passed'),
  ]);
  const decision = evaluator(recovered, [], {
    failOnRetryRecovered: true,
    unexpectedSkipBudget: 0,
    requireCompleteShards: true,
    maxQuarantineEntries: 20,
  });
  assert.equal(decision.outcome, 'fail');
  assert.ok(decision.violations.some((entry) => entry.id === 'test.retry-recovered'));
}

function mergeOracle(merge) {
  const complete = merge([
    shard(1, [attempt('a1', 'e1', 't1')]),
    shard(2, [attempt('a2', 'e2', 't2')]),
  ], manifest);
  assert.equal(complete.completion, 'complete');
  assert.equal(complete.attempts.length, 2);
  assert.throws(
    () => merge([shard(1, [attempt('a1', 'e1', 't1')])], manifest),
    /Missing required shards/,
  );
}

function selectionOracle(planner) {
  const result = planner({
    changedFiles: ['unknown/service.ts'],
    allTests: ['a', 'b'],
    smokeTests: [],
    mapping: {},
    baselineAvailable: true,
  });
  assert.equal(result.mode, 'full');
  assert.deepEqual(result.selected, ['a', 'b']);
}

function quarantineOracle(validator) {
  const now = new Date('2026-01-10T00:00:00.000Z');
  const result = validator([
    {
      schemaVersion: RESULT_SCHEMA_VERSION,
      testId: 'test-a',
      owner: '',
      reason: 'seeded defect',
      issue: 'ISSUE-1',
      createdAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-01-02T00:00:00.000Z',
    },
  ], ['test-a'], now);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((entry) => /owner is required/.test(entry)));
  assert.ok(result.errors.some((entry) => /expired/.test(entry)));
}

function redactionOracle(redactor) {
  const canary = 'FORGEQA-CANARY-SECRET-123';
  const result = redactor({ authorization: `Bearer ${canary}`, nested: `password=${canary}` });
  assert.doesNotMatch(JSON.stringify(result), new RegExp(canary));
}

test('production gate policy kills an always-pass mutant', () => {
  assert.doesNotThrow(() => gateOracle(evaluateGates));
  const alwaysPass = () => ({ outcome: 'pass', violations: [] });
  assert.throws(() => gateOracle(alwaysPass), /Expected values to be strictly equal/);
});

test('strict merge oracle kills a mutant that drops shard completeness checks', () => {
  assert.doesNotThrow(() => mergeOracle(mergeShardResults));
  const dropsCompleteness = (shards) => ({
    schemaVersion: RESULT_SCHEMA_VERSION,
    runId: 'run',
    completion: 'complete',
    selectionHash: 'selection',
    configHash: 'config',
    revision,
    attempts: shards.flatMap((entry) => entry.attempts),
    missingExecutions: [],
    unexpectedExecutions: [],
    duplicateExecutions: [],
    shardIds: shards.map((entry) => entry.shardId),
  });
  assert.throws(() => mergeOracle(dropsCompleteness), /Missing expected exception/);
});

test('conservative selection oracle kills an empty-selection mutant', () => {
  assert.doesNotThrow(() => selectionOracle(planChangedArea));
  const selectsNothing = () => ({ mode: 'changed', selected: [], reasons: [], warnings: [] });
  assert.throws(() => selectionOracle(selectsNothing), /Expected values to be strictly equal/);
});

test('quarantine policy oracle kills a validation-bypass mutant', () => {
  assert.doesNotThrow(() => quarantineOracle(validateQuarantine));
  const acceptsEverything = () => ({ valid: true, errors: [], warnings: [] });
  assert.throws(() => quarantineOracle(acceptsEverything), /Expected values to be strictly equal/);
});

test('redaction oracle kills an identity-transform mutant', () => {
  assert.doesNotThrow(() => redactionOracle(redactValue));
  assert.throws(() => redactionOracle((value) => value), /was expected to not match/);
});

test('CI structure makes hardening a release-blocking aggregate lane', async () => {
  const workflow = await readFile('.github/workflows/ci.yml', 'utf8');
  assert.match(workflow, /\n  hardening:\n/);
  assert.match(workflow, /needs:\s*\[verify, consumer, teamboard, ledgerguard, hardening, action\]/);
  assert.match(workflow, /HARDENING_RESULT/);
  assert.match(workflow, /test "\$HARDENING_RESULT" = success/);
  assert.match(workflow, /hardening:\s*required\('REPORT_HARDENING_RESULT'\)/);
});
