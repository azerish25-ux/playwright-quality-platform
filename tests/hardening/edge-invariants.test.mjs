import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  RESULT_SCHEMA_VERSION,
  attemptIdentity,
  evaluateGates,
  executionIdentity,
  gatePolicy,
  logicalTestIdentity,
  planChangedArea,
  redactText,
  redactUrl,
  redactValue,
  runIdentity,
  sha256,
  shardIdentity,
  stableHash,
  stableStringify,
} from '@azerish25-ux/forgeqa-core';
import { allocateNamespace, defineDataFactory } from '@azerish25-ux/forgeqa-test-data';
import {
  addQuarantine,
  readQuarantine,
  removeQuarantine,
  validateQuarantine,
} from '@azerish25-ux/forgeqa-flake-analysis';
import { mergeShardResults } from '@azerish25-ux/forgeqa-reporter';

const revision = {
  repository: 'azerish25-ux/playwright-quality-platform',
  sourceCommit: '1'.repeat(40),
  testedCommit: '2'.repeat(40),
};

function attempt(index, retry = 0, outcome = 'passed') {
  return {
    schemaVersion: RESULT_SCHEMA_VERSION,
    attemptId: `attempt-${index}-${retry}`,
    executionId: `execution-${index}`,
    logicalTestId: `test-${index}`,
    retry,
    outcome,
    startedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index + retry)).toISOString(),
    durationMs: index + retry + 1,
    artifacts: [{ path: `trace-${index}.zip`, type: 'trace', state: 'captured' }],
  };
}

function shard(index, total, attempts = [attempt(index)], extra = {}) {
  return {
    schemaVersion: RESULT_SCHEMA_VERSION,
    runId: 'run-property',
    shardId: `shard-${index}`,
    shardIndex: index,
    shardTotal: total,
    selectionHash: 'selection-property',
    configHash: 'config-property',
    completion: 'complete',
    revision,
    attempts,
    finalizedAt: '2026-01-01T01:00:00.000Z',
    journalSha256: `${index}`.repeat(64).slice(0, 64),
    ...extra,
  };
}

function manifest(total) {
  return {
    schemaVersion: RESULT_SCHEMA_VERSION,
    runId: 'run-property',
    selectionHash: 'selection-property',
    configHash: 'config-property',
    expected: Array.from({ length: total }, (_, offset) => ({
      executionId: `execution-${offset + 1}`,
      logicalTestId: `test-${offset + 1}`,
      project: 'chromium',
      environment: 'local',
      shardIndex: offset + 1,
      shardTotal: total,
    })),
  };
}

test('stable serialization and identity helpers cover edge values and invalid dimensions', () => {
  const left = { z: 1, a: { y: Number.POSITIVE_INFINITY, x: 2n }, ignored: undefined };
  const right = { a: { x: 2n, y: Number.POSITIVE_INFINITY }, z: 1 };
  assert.equal(stableStringify(left), stableStringify(right));
  assert.equal(stableStringify([undefined, () => 1, Symbol('x')]), '[null,null,null]');
  assert.equal(stableHash(left), sha256(stableStringify(left)));
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => stableStringify(cyclic), /cyclic structure/);

  assert.equal(logicalTestIdentity({ explicitId: 'payments:refund-1', relativePath: 'ignored', titlePath: [] }), 'payments:refund-1');
  assert.throws(() => logicalTestIdentity({ explicitId: 'x', relativePath: 'ignored', titlePath: [] }), /Invalid explicit test id/);
  assert.throws(() => logicalTestIdentity({ relativePath: '', titlePath: [] }), /requires a relative path/);
  const logical = logicalTestIdentity({ relativePath: './tests\\payments.spec.ts', titlePath: [' Payments ', ' refund  flow '] });
  const execution = executionIdentity({ consumer: 'demo', environment: 'local', project: 'chromium', repetition: 0, logicalTestId: logical });
  assert.match(logical, /^auto:[0-9a-f]{24}$/);
  assert.match(execution, /^exec:[0-9a-f]{32}$/);
  assert.notEqual(attemptIdentity(execution, 0), attemptIdentity(execution, 1));
  assert.notEqual(
    runIdentity({ repository: 'a/b', workflow: 'CI', runNumber: '1', runAttempt: '1', testedCommit: 'a'.repeat(40) }),
    runIdentity({ repository: 'a/b', workflow: 'CI', runNumber: '1', runAttempt: '2', testedCommit: 'a'.repeat(40) }),
  );
  assert.match(shardIdentity({ runId: 'run', project: 'chromium', index: 1, total: 2 }), /^shard:[0-9a-f]{32}$/);
  for (const dimensions of [{ index: 0, total: 2 }, { index: 3, total: 2 }, { index: 1.5, total: 2 }]) {
    assert.throws(() => shardIdentity({ runId: 'run', project: 'chromium', ...dimensions }), /Invalid shard/);
  }
});

test('redaction handles URLs, fallbacks, allowlists, and custom secret keys', () => {
  assert.equal(redactText('Authorization: Bearer abc.def and password=hunter2'), 'Authorization: [REDACTED] and password=[REDACTED]');
  assert.match(redactUrl('https://user:pass@example.test/path?api_key=secret&safe=yes'), /REDACTED/);
  assert.equal(redactUrl('not-a-url token=secret'), 'not-a-url token=[REDACTED]');
  const structured = redactValue({
    password: 'visible-only-because-allowed',
    customCredential: 'secret',
    ordinary: 'Bearer token-value',
  }, { allowedKeys: ['password'], extraKeys: [/credential/i], replacement: '<hidden>' });
  assert.equal(structured.password, 'visible-only-because-allowed');
  assert.equal(structured.customCredential, '<hidden>');
  assert.equal(structured.ordinary, '<hidden>');
  assert.equal(redactValue(42), 42);
});

test('gate policy exposes every release-blocking failure category', () => {
  const now = Date.now();
  const base = {
    schemaVersion: RESULT_SCHEMA_VERSION,
    runId: 'gate-branches',
    completion: 'incomplete',
    selectionHash: 'selection',
    configHash: 'config',
    revision,
    attempts: [
      { ...attempt(1, 1, 'passed'), artifacts: [] },
      attempt(2, 0, 'cancelled'),
    ],
    missingExecutions: ['missing'],
    unexpectedExecutions: ['unexpected'],
    duplicateExecutions: ['duplicate'],
    shardIds: ['s1'],
    runnerStatus: 'failed',
    infrastructureErrors: ['network unavailable'],
  };
  const policy = { ...gatePolicy(), requireArtifacts: ['trace'], durationBudgetMs: 1 };
  const decision = evaluateGates(base, null, policy);
  const ids = new Set(decision.violations.map((entry) => entry.id));
  for (const id of ['run.incomplete', 'run.infrastructure', 'runner.failed', 'inventory.incomplete', 'attempt.invalid-sequence', 'test.unexpected-outcome', 'artifact.required', 'duration.budget', 'quarantine.invalid']) {
    assert.equal(ids.has(id), true, `missing ${id}`);
  }

  const validRun = { ...base, completion: 'complete', attempts: [attempt(3)], missingExecutions: [], unexpectedExecutions: [], duplicateExecutions: [], runnerStatus: 'passed', infrastructureErrors: [] };
  const quarantines = Array.from({ length: 21 }, (_, index) => ({
    schemaVersion: RESULT_SCHEMA_VERSION,
    testId: `test-${index}`,
    owner: 'quality',
    reason: 'bounded investigation',
    issue: `ISSUE-${index}`,
    createdAt: new Date(now - 86_400_000).toISOString(),
    expiresAt: new Date(now + 86_400_000).toISOString(),
  }));
  const quarantineDecision = evaluateGates(validRun, [
    ...quarantines,
    null,
    { ...quarantines[0], testId: 'expired', expiresAt: new Date(now - 1).toISOString() },
  ], { ...gatePolicy(), maxQuarantineEntries: 20 });
  assert.ok(quarantineDecision.violations.some((entry) => entry.id === 'quarantine.limit'));
  assert.ok(quarantineDecision.violations.some((entry) => entry.id === 'quarantine.invalid'));
  assert.ok(quarantineDecision.violations.some((entry) => entry.id === 'quarantine.expired'));
});

test('selection, factory, namespace, and merge invalid inputs fail closed', () => {
  assert.throws(() => planChangedArea({ changedFiles: [], allTests: ['a'], smokeTests: [], mapping: {}, baselineAvailable: true }), /empty changed-file set/);
  const mapped = planChangedArea({ changedFiles: ['apps/payments/a.ts'], allTests: ['smoke', 'pay', 'new'], smokeTests: ['smoke'], newTests: ['new'], mapping: { 'apps/payments/*': ['pay'] }, baselineAvailable: true });
  assert.deepEqual(mapped.selected, ['new', 'pay', 'smoke']);
  assert.throws(() => planChangedArea({ changedFiles: ['known/a.ts'], allTests: [], smokeTests: [], mapping: { 'known/*': ['missing'] }, baselineAvailable: true }), /empty suite/);

  assert.throws(() => defineDataFactory('x', () => ({})), /Invalid factory name/);
  const factory = defineDataFactory('edge-factory', (context) => ({
    integer: context.integer(2, 2),
    value: context.pick(['only']),
  }));
  assert.deepEqual(factory.build({ seed: 'seed', logicalTestId: 'test', namespace: 'ns' }), { integer: 2, value: 'only' });
  const badInteger = defineDataFactory('bad-integer', (context) => ({ value: context.integer(3, 2) }));
  assert.throws(() => badInteger.build({ seed: 'seed', logicalTestId: 'test', namespace: 'ns' }), /Invalid integer range/);
  const badPick = defineDataFactory('bad-pick', (context) => ({ value: context.pick([]) }));
  assert.throws(() => badPick.build({ seed: 'seed', logicalTestId: 'test', namespace: 'ns' }), /empty collection/);
  assert.throws(() => allocateNamespace({ consumer: '', runId: 'r', shardIndex: 0, project: 'p', repetition: 0, parallelIndex: 0 }), /non-negative/);
  assert.match(allocateNamespace({ consumer: '***', runId: 'r', shardIndex: 1, project: 'p', repetition: 0, parallelIndex: 0 }), /^consumer-/);

  assert.throws(() => mergeShardResults([], manifest(1)), /No shard reports/);
  assert.throws(() => mergeShardResults([{ ...shard(1, 1), shardTotal: 0 }], manifest(1)), /Invalid shard total/);
  assert.throws(() => mergeShardResults([shard(1, 1)], { ...manifest(1), schemaVersion: 99 }), /Unsupported manifest schema/);
  assert.throws(() => mergeShardResults([{ ...shard(1, 1), schemaVersion: 99 }], manifest(1)), /Unsupported shard schema/);
  assert.throws(() => mergeShardResults([{ ...shard(1, 1), runId: 'other' }], manifest(1)), /incompatible/);
  assert.throws(() => mergeShardResults([{ ...shard(1, 2), shardId: 'same' }, { ...shard(2, 2), shardId: 'same' }], manifest(2)), /Duplicate shard/);
  assert.throws(() => mergeShardResults([{ ...shard(1, 1), shardIndex: 2 }], manifest(1)), /out of range/);
  const incomplete = mergeShardResults([{ ...shard(1, 1), completion: 'incomplete' }], manifest(1));
  assert.equal(incomplete.completion, 'incomplete');
});

test('quarantine persistence validates policy, locking, sorting, mutation, and malformed storage', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'forgeqa-quarantine-hardening-'));
  const file = join(directory, 'quarantine.json');
  const now = new Date('2026-01-10T00:00:00.000Z');
  try {
    assert.deepEqual(await readQuarantine(file), []);
    const warning = validateQuarantine([{
      schemaVersion: RESULT_SCHEMA_VERSION,
      testId: 'test-b',
      owner: 'quality',
      reason: 'investigation',
      issue: 'ISSUE-2',
      createdAt: '2026-01-09T00:00:00.000Z',
      expiresAt: '2026-01-12T00:00:00.000Z',
      projects: ['webkit', 'webkit', 'chromium'],
    }], ['test-b'], now);
    assert.equal(warning.valid, true);
    assert.equal(warning.warnings.length, 1);

    const invalid = validateQuarantine([
      {
        schemaVersion: 99,
        testId: '',
        owner: '',
        reason: '',
        issue: '',
        createdAt: 'invalid',
        expiresAt: 'invalid',
        projects: ['*', '../escape'],
      },
      {
        schemaVersion: RESULT_SCHEMA_VERSION,
        testId: 'test-a',
        owner: 'quality',
        reason: 'investigation',
        issue: 'ISSUE',
        createdAt: '2026-01-10T00:00:00.000Z',
        expiresAt: '2026-01-09T00:00:00.000Z',
      },
      {
        schemaVersion: RESULT_SCHEMA_VERSION,
        testId: 'test-a',
        owner: 'quality',
        reason: 'investigation',
        issue: 'ISSUE',
        createdAt: '2026-01-01T00:00:00.000Z',
        expiresAt: '2026-02-01T00:00:00.000Z',
      },
    ], ['known'], now);
    assert.equal(invalid.valid, false);
    assert.ok(invalid.errors.length >= 8);

    const first = {
      schemaVersion: RESULT_SCHEMA_VERSION,
      testId: 'test-b',
      owner: 'quality',
      reason: 'investigation',
      issue: 'ISSUE-2',
      createdAt: '2026-01-10T00:00:00.000Z',
      expiresAt: '2026-01-20T00:00:00.000Z',
      projects: ['webkit', 'chromium', 'webkit'],
    };
    const second = { ...first, testId: 'test-a', issue: 'ISSUE-1', projects: undefined };
    assert.equal((await addQuarantine(file, first, ['test-a', 'test-b'], now)).changed, true);
    const added = await addQuarantine(file, second, ['test-a', 'test-b'], now);
    assert.deepEqual(added.records.map((entry) => entry.testId), ['test-a', 'test-b']);
    assert.deepEqual(added.records[1].projects, ['chromium', 'webkit']);
    await assert.rejects(addQuarantine(file, first, ['test-a', 'test-b'], now), /already exists/);
    await assert.rejects(addQuarantine(file, { ...first, testId: 'unknown' }, ['test-a', 'test-b'], now), /violates policy/);
    assert.equal((await removeQuarantine(file, 'missing')).changed, false);
    assert.equal((await removeQuarantine(file, 'test-b', ['webkit', 'chromium'])).changed, true);
    assert.deepEqual((await readQuarantine(file)).map((entry) => entry.testId), ['test-a']);
    await assert.rejects(removeQuarantine(file, '  '), /stable test ID/);

    await writeFile(file, '{broken', 'utf8');
    await assert.rejects(readQuarantine(file), /invalid or unreadable/);
    await writeFile(file, '{}', 'utf8');
    await assert.rejects(readQuarantine(file), /must contain an array/);
    assert.equal((await readFile(file, 'utf8')).trim(), '{}');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
