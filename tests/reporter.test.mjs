import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeShardResults, toHtmlReport, toJUnit } from '@azerish25-ux/forgeqa-reporter';
import { RESULT_SCHEMA_VERSION } from '@azerish25-ux/forgeqa-core';
const revision = { repository: 'repo', sourceCommit: 'a', testedCommit: 'b' };
function shard(index, total, attempts, extra = {}) {
  return {
    schemaVersion: RESULT_SCHEMA_VERSION,
    runId: 'run',
    shardId: `s${index}`,
    shardIndex: index,
    shardTotal: total,
    selectionHash: 'sel',
    configHash: 'cfg',
    completion: 'complete',
    revision,
    attempts,
    finalizedAt: '2026-01-01T00:00:00Z',
    journalSha256: 'x',
    ...extra
  };
}
function attempt(id, executionId, testId, outcome = 'passed', retry = 0) {
  return {
    schemaVersion: RESULT_SCHEMA_VERSION,
    attemptId: id,
    executionId,
    logicalTestId: testId,
    retry,
    outcome,
    startedAt: '2026-01-01T00:00:00Z',
    durationMs: 2
  };
}
const manifest = {
  schemaVersion: RESULT_SCHEMA_VERSION,
  runId: 'run',
  selectionHash: 'sel',
  configHash: 'cfg',
  expected: [
    {
      executionId: 'e1',
      logicalTestId: '<script>alert(1)</script>',
      project: 'chromium',
      environment: 'local',
      shardIndex: 1,
      shardTotal: 2
    },
    {
      executionId: 'e2',
      logicalTestId: 't2',
      project: 'chromium',
      environment: 'local',
      shardIndex: 2,
      shardTotal: 2
    }
  ]
};

test('compatible shards merge once and preserve attempts', () => {
  const merged = mergeShardResults(
    [
      shard(2, 2, [attempt('a2', 'e2', 't2')]),
      shard(1, 2, [attempt('a1', 'e1', 't1', 'failed', 0), attempt('a1r', 'e1', 't1', 'passed', 1)])
    ],
    manifest
  );
  assert.equal(merged.completion, 'complete');
  assert.equal(merged.attempts.length, 3);
});

test('missing, duplicate and incompatible shards fail integrity', () => {
  assert.throws(
    () => mergeShardResults([shard(1, 2, [attempt('a', 'e1', 't1')])], manifest),
    /Missing required shards/
  );
  assert.throws(
    () =>
      mergeShardResults(
        [shard(1, 2, [attempt('a', 'e1', 't1')]), shard(1, 2, [attempt('b', 'e2', 't2')])],
        manifest
      ),
    /Duplicate shard/
  );
  assert.throws(
    () =>
      mergeShardResults(
        [
          shard(1, 2, [attempt('a', 'e1', 't1')]),
          shard(2, 2, [attempt('b', 'e2', 't2')], { configHash: 'other' })
        ],
        manifest
      ),
    /incompatible/
  );
});

test('HTML and JUnit escape hostile test content', () => {
  const merged = mergeShardResults(
    [shard(1, 2, [attempt('a', 'e1', '<script>alert(1)</script>')]), shard(2, 2, [attempt('b', 'e2', 't2')])],
    manifest
  );
  const html = toHtmlReport(merged);
  const xml = toJUnit(merged);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(xml, /&lt;script&gt;/);
});

test('retry-recovered timeout stays flaky in HTML and is a JUnit failure under strict gates', async () => {
  const { evaluateGates } = await import('@azerish25-ux/forgeqa-core');
  const merged = mergeShardResults(
    [
      shard(1, 2, [
        {
          ...attempt('a', 'e1', 't1', 'timed-out'),
          error: { name: 'TimeoutError', message: 'Original timeout evidence' }
        },
        attempt('ar', 'e1', 't1', 'passed', 1)
      ]),
      shard(2, 2, [attempt('b', 'e2', 't2')])
    ],
    manifest
  );
  merged.gate = evaluateGates(merged, [], {
    failOnRetryRecovered: true,
    unexpectedSkipBudget: 0,
    maxQuarantineEntries: 20,
    requireCompleteShards: true
  });
  assert.equal(merged.gate.outcome, 'fail');
  const html = toHtmlReport(merged),
    xml = toJUnit(merged);
  assert.match(html, /data-outcome="flaky"/);
  assert.match(html, /Original timeout evidence/);
  assert.match(xml, /failures="1"/);
  assert.match(xml, /type="flaky"/);
  assert.match(xml, /Original timeout evidence/);
});

test('logical-test policy violations block the matching execution in HTML and JUnit', async () => {
  const { evaluateGates } = await import('@azerish25-ux/forgeqa-core');
  const run = mergeShardResults(
    [
      shard(1, 2, [attempt('a', 'e1', 't1')]),
      shard(2, 2, [
        {
          ...attempt('b', 'e2', 't2'),
          artifacts: [{ type: 'trace', state: 'captured', path: 'artifacts/trace.zip' }]
        }
      ])
    ],
    manifest
  );
  run.gate = evaluateGates(run, [], {
    failOnRetryRecovered: true,
    unexpectedSkipBudget: 0,
    maxQuarantineEntries: 20,
    requireCompleteShards: true,
    requireArtifacts: ['trace']
  });
  assert.equal(run.gate.outcome, 'fail');
  assert.match(toJUnit(run), /failures="1"/);
  const html = toHtmlReport(run);
  assert.match(html, /data-outcome="passed" data-attention="1"/);
  assert.match(html, /policy blocked/);
});

test('HTML rejects active and traversing native-evidence links, preserving safe local links', () => {
  const run = mergeShardResults(
    [shard(1, 2, [attempt('a', 'e1', 't1')]), shard(2, 2, [attempt('b', 'e2', 't2')])],
    manifest
  );
  run.evidence = {
    nativeReport: 'javascript:alert(1)',
    nativeJson: '../private.json',
    artifactManifest: 'artifacts/manifest.json',
    nativeBlobCount: 2,
    capturedArtifacts: 1,
    missingArtifacts: 0,
    unavailableArtifacts: 0,
    reconciliation: { status: 'MATCHED' }
  };
  const html = toHtmlReport(run);
  assert.doesNotMatch(html, /href="(?:javascript:|\.\.\/)/);
  assert.match(html, /href="artifacts\/manifest.json"/);
  assert.match(html, /unsafe path omitted/);
});

test('HTML retains artifact checksums and explicit missing, empty and unevaluated states', () => {
  const run = mergeShardResults(
    [
      shard(1, 2, [
        {
          ...attempt('a', 'e1', 't1'),
          artifacts: [
            { type: 'log', state: 'captured', path: 'artifacts/log.txt', sha256: 'a'.repeat(64), size: 12 }
          ]
        }
      ]),
      shard(2, 2, [attempt('b', 'e2', 't2')])
    ],
    manifest
  );
  assert.match(toHtmlReport(run), /SHA-256/);
  assert.match(toHtmlReport(run), /The gate is not evaluated/);
  assert.match(
    toHtmlReport({ ...run, attempts: [], missingExecutions: ['missing-test'], completion: 'incomplete' }),
    /No executions recorded/
  );
  assert.match(
    toHtmlReport({ ...run, attempts: [], missingExecutions: ['missing-test'], completion: 'incomplete' }),
    /The evidence is incomplete/
  );
  assert.match(
    toHtmlReport({ ...run, attempts: [], missingExecutions: ['missing-test'], completion: 'incomplete' }),
    /missing-test/
  );
});

test('an empty report never introduces an externally passed gate as clean evidence', () => {
  const run = mergeShardResults(
    [shard(1, 2, [attempt('a', 'e1', 't1')]), shard(2, 2, [attempt('b', 'e2', 't2')])],
    manifest
  );
  const html = toHtmlReport({ ...run, attempts: [], gate: { outcome: 'pass', violations: [] } });
  assert.match(html, /No executions were recorded\./);
  assert.doesNotMatch(html, /The evidence checks out\./);
});
