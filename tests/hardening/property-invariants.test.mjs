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
import {
  CleanupRegistry,
  allocateNamespace,
  assertOwnedIdentifier,
  defineDataFactory,
} from '@azerish25-ux/forgeqa-test-data';
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

function permutations(values) {
  if (values.length <= 1) return [values];
  const result = [];
  for (let index = 0; index < values.length; index += 1) {
    const head = values[index];
    const tail = [...values.slice(0, index), ...values.slice(index + 1)];
    for (const rest of permutations(tail)) result.push([head, ...rest]);
  }
  return result;
}

function canonicalMerged(result) {
  return stableStringify({
    ...result,
    attempts: result.attempts.map((entry) => ({ ...entry })),
    shardIds: [...result.shardIds],
  });
}

test('compatible shard merge is order-independent and repeatable', () => {
  const shards = [shard(1, 4), shard(2, 4), shard(3, 4), shard(4, 4)];
  const expected = canonicalMerged(mergeShardResults(shards, manifest(4)));
  for (const order of permutations(shards)) {
    assert.equal(canonicalMerged(mergeShardResults(order, manifest(4))), expected);
    assert.equal(canonicalMerged(mergeShardResults(structuredClone(order), structuredClone(manifest(4)))), expected);
  }
});

test('merge rejects conflicting, incomplete, duplicated, and substituted evidence', () => {
  const valid = [shard(1, 2), shard(2, 2)];
  assert.throws(() => mergeShardResults([valid[0]], manifest(2)), /Missing required shards/);
  assert.throws(() => mergeShardResults([valid[0], { ...valid[1], shardIndex: 1 }], manifest(2)), /Duplicate shard/);
  assert.throws(() => mergeShardResults([valid[0], { ...valid[1], configHash: 'substituted' }], manifest(2)), /incompatible/);
  assert.throws(() => mergeShardResults([valid[0], { ...valid[1], revision: { ...revision, testedCommit: '3'.repeat(40) } }], manifest(2)), /conflicting run dimensions/);
  assert.throws(() => mergeShardResults([valid[0], { ...valid[1], attempts: [{ ...attempt(2), attemptId: attempt(1).attemptId }] }], manifest(2)), /Duplicate attempt id/);
  assert.throws(() => mergeShardResults([{ ...valid[0], finalizedAt: undefined }, valid[1]], manifest(2)), /finalization evidence/);
});

test('gate decisions are deterministic across attempt order and enforce every strict policy dimension', () => {
  const run = {
    schemaVersion: RESULT_SCHEMA_VERSION,
    runId: 'run-gates',
    completion: 'complete',
    selectionHash: 'selection',
    configHash: 'config',
    revision,
    attempts: [
      attempt(1, 1, 'passed'),
      attempt(1, 0, 'failed'),
      attempt(2, 0, 'skipped'),
      { ...attempt(3), artifacts: [] },
    ],
    missingExecutions: [],
    unexpectedExecutions: [],
    duplicateExecutions: [],
    shardIds: ['s1'],
  };
  const policy = { ...gatePolicy(), unexpectedSkipBudget: 0, requireArtifacts: ['trace'], durationBudgetMs: 3 };
  const expected = stableStringify(evaluateGates(structuredClone(run), [], policy));
  for (const order of permutations(run.attempts)) {
    const decision = evaluateGates({ ...structuredClone(run), attempts: order.map((entry) => structuredClone(entry)) }, [], policy);
    assert.equal(stableStringify(decision), expected);
  }
  const ids = new Set(evaluateGates(structuredClone(run), [], policy).violations.map((entry) => entry.id));
  assert.deepEqual(
    [...ids].sort(),
    ['artifact.required', 'duration.budget', 'test.retry-recovered', 'test.skip-budget'].sort(),
  );
});

test('seeded factories reproduce logical values while namespaces remain collision resistant', () => {
  const accountFactory = defineDataFactory('account-property', (context) => ({
    account: context.integer(100_000, 999_999),
    role: context.pick(['owner', 'editor', 'viewer']),
    sample: [context.random(), context.random(), context.random()],
  }));
  for (let sequence = 0; sequence < 200; sequence += 1) {
    const left = accountFactory.build({ seed: `seed-${sequence % 17}`, logicalTestId: `test-${sequence % 11}`, namespace: 'worker-a', sequence });
    const right = accountFactory.build({ seed: `seed-${sequence % 17}`, logicalTestId: `test-${sequence % 11}`, namespace: 'worker-b', sequence });
    assert.deepEqual(left, right);
  }

  const namespaces = new Set();
  for (let shardIndex = 1; shardIndex <= 5; shardIndex += 1) {
    for (const project of ['chromium', 'firefox', 'webkit']) {
      for (let repetition = 0; repetition < 3; repetition += 1) {
        for (let parallelIndex = 0; parallelIndex < 16; parallelIndex += 1) {
          for (let attemptIndex = 0; attemptIndex < 2; attemptIndex += 1) {
            const namespace = allocateNamespace({
              consumer: 'Property Consumer',
              runId: 'run-property',
              shardIndex,
              project,
              repetition,
              parallelIndex,
              attempt: attemptIndex,
            });
            assert.equal(namespaces.has(namespace), false, `collision for ${namespace}`);
            namespaces.add(namespace);
            assert.doesNotThrow(() => assertOwnedIdentifier(`${namespace}-resource`, namespace));
          }
        }
      }
    }
  }
  assert.equal(namespaces.size, 5 * 3 * 3 * 16 * 2);
  assert.throws(() => assertOwnedIdentifier('foreign-resource', [...namespaces][0]), /not owned/);
});

test('cleanup is ownership-limited, reverse ordered, failure-aware, and idempotent', async () => {
  const order = [];
  const registry = new CleanupRegistry('property-run');
  assert.throws(() => registry.register({ id: 'foreign', ownerNamespace: 'other-run', description: 'foreign', cleanup: async () => {} }), /another namespace/);
  for (let index = 0; index < 25; index += 1) {
    registry.register({
      id: `owned-${index}`,
      ownerNamespace: 'property-run',
      description: `resource ${index}`,
      cleanup: async () => {
        order.push(index);
        if (index === 7) throw new Error('seeded cleanup failure');
      },
    });
  }
  assert.throws(() => registry.register({ id: 'owned-1', ownerNamespace: 'property-run', description: 'duplicate', cleanup: async () => {} }), /Duplicate cleanup id/);
  const result = await registry.run();
  assert.deepEqual(order, Array.from({ length: 25 }, (_, offset) => 24 - offset));
  assert.equal(result.attempted, 25);
  assert.equal(result.succeeded, 24);
  assert.deepEqual(result.failures, [{ id: 'owned-7', message: 'seeded cleanup failure' }]);
  assert.deepEqual(await registry.run(), { attempted: 0, succeeded: 0, failures: [] });
  assert.throws(() => registry.register({ id: 'late', ownerNamespace: 'property-run', description: 'late', cleanup: async () => {} }), /already closed/);
});

test('redaction is idempotent and removes seeded secrets from nested publishable data', () => {
  for (let index = 0; index < 100; index += 1) {
    const canary = `forgeqa-canary-${index}-UNIQUE`;
    const value = {
      authorization: `Bearer ${canary}`,
      nested: [
        `password=${canary}`,
        { apiKey: canary, url: `https://user:${canary}@example.test/path?token=${canary}&safe=1` },
      ],
    };
    const once = redactValue(value);
    const twice = redactValue(once);
    assert.deepEqual(twice, once);
    assert.doesNotMatch(JSON.stringify(once), new RegExp(canary));
  }
});

test('changed-area selection remains conservative for missing baselines and unknown shared paths', () => {
  const allTests = ['api.auth', 'api.payments', 'ui.smoke'];
  const missing = planChangedArea({ allTests, smokeTests: ['ui.smoke'], mapping: {}, baselineAvailable: false });
  assert.equal(missing.mode, 'full');
  assert.deepEqual(missing.selected, [...allTests].sort());

  const unknown = planChangedArea({ changedFiles: ['unmapped/service.ts'], allTests, smokeTests: ['ui.smoke'], mapping: {}, baselineAvailable: true });
  assert.equal(unknown.mode, 'full');
  assert.deepEqual(unknown.selected, [...allTests].sort());

  const shared = planChangedArea({ changedFiles: ['packages/core/src/gates.ts'], allTests, smokeTests: ['ui.smoke'], mapping: {}, baselineAvailable: true });
  assert.equal(shared.mode, 'full');

  const docs = planChangedArea({ changedFiles: ['docs/hardening.md'], allTests, smokeTests: [], mapping: {}, baselineAvailable: true });
  assert.deepEqual(docs, { mode: 'docs-only', selected: [], reasons: [], warnings: ['Only documentation files changed.'] });
});
