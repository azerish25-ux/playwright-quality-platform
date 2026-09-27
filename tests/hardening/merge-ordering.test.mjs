import test from 'node:test';
import assert from 'node:assert/strict';
import { RESULT_SCHEMA_VERSION, stableStringify } from '@azerish25-ux/forgeqa-core';
import { mergeShardResults } from '@azerish25-ux/forgeqa-reporter';

const revision = {
  repository: 'azerish25-ux/playwright-quality-platform',
  sourceCommit: '1'.repeat(40),
  testedCommit: '2'.repeat(40),
};

function attempt(index) {
  return {
    schemaVersion: RESULT_SCHEMA_VERSION,
    attemptId: `attempt-${index}`,
    executionId: `execution-${index}`,
    logicalTestId: `test-${index}`,
    retry: 0,
    outcome: 'passed',
    startedAt: '2026-01-01T00:00:00.000Z',
    durationMs: 1,
  };
}

function shard(index, total) {
  return {
    schemaVersion: RESULT_SCHEMA_VERSION,
    runId: 'run-tied-order',
    shardId: `shard-${index}`,
    shardIndex: index,
    shardTotal: total,
    selectionHash: 'selection-tied-order',
    configHash: 'config-tied-order',
    completion: 'complete',
    revision,
    attempts: [attempt(index)],
    finalizedAt: '2026-01-01T01:00:00.000Z',
    journalSha256: `${index}`.repeat(64).slice(0, 64),
  };
}

function manifest(total) {
  return {
    schemaVersion: RESULT_SCHEMA_VERSION,
    runId: 'run-tied-order',
    selectionHash: 'selection-tied-order',
    configHash: 'config-tied-order',
    expected: Array.from({ length: total }, (_, offset) => ({
      executionId: `execution-${offset + 1}`,
      logicalTestId: `test-${offset + 1}`,
      project: 'api',
      environment: 'local',
      shardIndex: offset + 1,
      shardTotal: total,
    })),
  };
}

function permutations(values) {
  if (values.length <= 1) return [values];
  const output = [];
  for (let index = 0; index < values.length; index += 1) {
    const head = values[index];
    const rest = [...values.slice(0, index), ...values.slice(index + 1)];
    for (const tail of permutations(rest)) output.push([head, ...tail]);
  }
  return output;
}

test('canonical merge ordering is stable when timestamps and retry indexes tie', () => {
  const shards = [shard(1, 4), shard(2, 4), shard(3, 4), shard(4, 4)];
  const expected = stableStringify(mergeShardResults(shards, manifest(4)));
  for (const order of permutations(shards)) {
    assert.equal(stableStringify(mergeShardResults(order, manifest(4))), expected);
  }
  assert.deepEqual(
    mergeShardResults([...shards].reverse(), manifest(4)).attempts.map((entry) => entry.executionId),
    ['execution-1', 'execution-2', 'execution-3', 'execution-4'],
  );
});
