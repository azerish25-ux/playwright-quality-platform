import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { measuredDurations, validateShardTimings } from '../benchmarks/lib/measurement.mjs';
import { BENCHMARK_CONDITIONS } from '../benchmarks/lib/conditions.mjs';
import { summarizeBenchmarkRecords, validateBenchmarkRecord } from '../benchmarks/lib/records.mjs';

function shard(offset = 0) {
  return { timings: { jobStartMs: offset, setupEndMs: offset + 100, runStartMs: offset + 200, runEndMs: offset + 500, setupMs: 100, runMs: 300, totalMs: 500 } };
}
function records() {
  return BENCHMARK_CONDITIONS.map(condition => ({
    schemaVersion: 1, measurementVersion: 3, kind: 'forgeqa-benchmark-run', sourceSha: 'a'.repeat(40), protocolDigest: 'b'.repeat(64),
    status: 'PASS', condition: condition.id, repetition: 1, warmups: 1, workers: condition.workers, shards: condition.shards,
    runners: Array.from({length:condition.shards},()=>({cpuModel:'test-cpu',cpuCount:4,totalMemoryBytes:16*1024**3})),
    inventory: { count: 20, expectedDigest: 'c'.repeat(64), observedDigest: 'c'.repeat(64) },
    durations: measuredDurations(Array.from({ length: condition.shards }, () => shard()), 10, 600, 800, 900)
  }));
}
test('queue skew cannot manufacture execution speedup', () => {
  const simultaneous = measuredDurations([shard(), shard()], 10, 600, 800, 900);
  const queued = measuredDurations([shard(), shard(10_000)], 10, 20_600, 20_800, 20_900);
  assert.equal(simultaneous.criticalPathMs, 400);
  assert.equal(queued.criticalPathMs, simultaneous.criticalPathMs);
  assert.equal(queued.schedulingSkewMs, 10_000);
  assert.ok(queued.wallMs > simultaneous.wallMs);
  const cohort = records();
  cohort[4].durations = queued;
  assert.equal(summarizeBenchmarkRecords(cohort, 1).conditions['distributed-4x1'].speedup, 1);
});
test('missing, forged and non-monotonic timings fail closed', () => {
  assert.throws(() => validateShardTimings({}), /non-negative integer/);
  assert.throws(() => validateShardTimings({ ...shard().timings, runMs: 1 }), /disagrees/);
  assert.throws(() => validateShardTimings({ ...shard().timings, runEndMs: 10 }), /monotonic/);
  assert.throws(() => measuredDurations([], 1, 2, 3, 4), /No shard/);
});
test('failed cohorts retain measurements but suppress every speedup and efficiency', () => {
  const cohort = records();
  cohort[1].status = 'FAIL';
  const summary = summarizeBenchmarkRecords(cohort, 1);
  assert.equal(summary.status, 'FAIL');
  for (const condition of Object.values(summary.conditions)) {
    assert.equal(condition.speedup, null);
    assert.equal(condition.parallelEfficiency, null);
  }
});
test('dimension, source, protocol and inventory count substitutions are rejected', () => {
  const cohort = records();
  assert.throws(() => validateBenchmarkRecord({ ...cohort[0], sourceSha: 'main' }), /exact commit/);
  assert.throws(() => validateBenchmarkRecord({ ...cohort[0], workers: 4 }), /dimensions/);
  cohort[1].protocolDigest = 'd'.repeat(64);
  assert.throws(() => summarizeBenchmarkRecords(cohort, 1), /protocols/);
  cohort[1].protocolDigest = cohort[0].protocolDigest;
  cohort[1].inventory.count = 21;
  assert.throws(() => summarizeBenchmarkRecords(cohort, 1), /counts/);
});
test('workflow guard remains strict with LF and Windows CRLF checkout', async () => {
  const source = (await readFile('.github/workflows/benchmark.yml', 'utf8')).replaceAll('\r\n', '\n');
  const guard = /Verify inventory equivalence and summarize measurements\r?\n\s+if: always\(\)/;
  for (const text of [source, source.replaceAll('\n', '\r\n')]) {
    assert.match(text, guard);
    assert.doesNotMatch(text.replace('if: always()', 'if: false').replaceAll('if: always()', 'if: false'), guard);
  }
  assert.match(source, /warmup\.mjs/);
  assert.match(source, /benchmark-warmup-/);
});

test('heterogeneous CPUs retain observations without implying comparable speedup', () => {
  const cohort = records();
  cohort[1].runners[0].cpuModel = 'different-silicon';
  const summary = summarizeBenchmarkRecords(cohort, 1);
  assert.equal(summary.status, 'PASS');
  assert.equal(summary.hardwareComparable, false);
  for (const condition of Object.values(summary.conditions)) assert.equal(condition.speedup, null);
});

test('memory variance blocks performance eligibility without discarding successful execution evidence', () => {
  const cohort = records();
  cohort[1].runners[0].totalMemoryBytes -= 1;
  const summary = summarizeBenchmarkRecords(cohort, 1);
  assert.equal(summary.status, 'PASS');
  assert.equal(summary.performanceStatus, 'NOT_COMPARABLE');
  assert.equal(summary.releaseEvidenceEligible, false);
  for (const condition of Object.values(summary.conditions)) assert.equal(condition.speedup, null);
});

test('every benchmark job pins the same exact Node patch rather than resolving a rolling major', async () => {
  const versions = [];
  for (const name of ['benchmark.yml', 'benchmark-controlled.yml', 'benchmark-secondary.yml']) {
    const source = await readFile(`.github/workflows/${name}`, 'utf8');
    const values = [...source.matchAll(/node-version:\s*([^,}\s]+)/g)].map(match => match[1]);
    assert(values.length > 0);
    for (const value of values) assert.match(value, /^\d+\.\d+\.\d+$/);
    versions.push(...values);
  }
  assert.equal(new Set(versions).size, 1);
});

test('Node and runner-image drift still change the strict software protocol digest', async () => {
  const { protocolDigest } = await import('../benchmarks/lib/measurement.mjs');
  const runner = { platform: 'linux', arch: 'x64', node: 'v22.23.3', playwright: '1.58.2', image: 'ubuntu24', imageVersion: '20260927.320.1', cpuCount: 4 };
  const original = await protocolDigest(runner);
  assert.notEqual(await protocolDigest({ ...runner, node: 'v22.23.2' }), original);
  assert.notEqual(await protocolDigest({ ...runner, imageVersion: '20260920.314.1' }), original);
});
