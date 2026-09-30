import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { BENCHMARK_CONDITIONS, createWorkflowMatrices } from '../benchmarks/lib/conditions.mjs';
import { summarizeBenchmarkRecords, validateBenchmarkRecord } from '../benchmarks/lib/records.mjs';

const digest = 'a'.repeat(64);

function record(condition, repetition, wallMs, overrides = {}) {
  return {
    schemaVersion: 1,
    kind: 'forgeqa-benchmark-run',
    measurementVersion: 3,
    protocolDigest: digest,
    status: 'PASS',
    sourceSha: 'b'.repeat(40),
    warmups: 0,
    condition: condition.id,
    repetition,
    workers: condition.workers,
    shards: condition.shards,
    runners: Array.from({length:condition.shards},()=>({cpuModel:'test-cpu',cpuCount:4,totalMemoryBytes:16*1024**3})),
    inventory: { count: 20, expectedDigest: digest, observedDigest: digest },
    durations: {
      planMs: 10,
      setupWallMs: 100,
      setupAggregateMs: 100 * condition.shards,
      testWallMs: wallMs - 20,
      testAggregateMs: (wallMs - 20) * condition.shards,
      mergeMs: 20,
      criticalPathMs: wallMs,
      schedulingSkewMs: 0,
      coordinationWaitMs: 0,
      wallMs,
      aggregateRunnerMs: wallMs * condition.shards
    },
    ...overrides
  };
}

test('workflow matrices preserve all five comparable conditions and bounded repetitions', () => {
  const matrices = createWorkflowMatrices(3);
  assert.equal(matrices.conditions.include.length, 5);
  assert.equal(matrices.merges.include.length, 15);
  assert.equal(matrices.shards.include.length, 27);
  assert.deepEqual(matrices.conditions.include.map(entry => entry.condition), BENCHMARK_CONDITIONS.map(entry => entry.id));
  assert.equal(matrices.shards.include.filter(entry => entry.condition === 'distributed-4x1').length, 12);
  assert.throws(() => createWorkflowMatrices(0), /between 1 and 5/);
  assert.throws(() => createWorkflowMatrices(6), /between 1 and 5/);
});

test('benchmark summaries enforce exact source, inventory, condition, and repetition equivalence', () => {
  const records = BENCHMARK_CONDITIONS.flatMap((condition, conditionIndex) => [
    record(condition, 1, 1000 - conditionIndex * 100),
    record(condition, 2, 1100 - conditionIndex * 100)
  ]);
  const summary = summarizeBenchmarkRecords(records, 2);
  assert.equal(summary.status, 'PASS');
  assert.equal(summary.inventoryCount, 20);
  assert.equal(summary.conditions['serial-1x1'].wallMs.median, 1050);
  assert.equal(summary.conditions['distributed-4x1'].speedup, 1050 / 650);
  assert.match(summary.limitations[0], /Only 2 measured repetitions/);
  assert.match(summary.limitations[1], /No unmeasured warm-up/);
  assert.throws(() => summarizeBenchmarkRecords(records.slice(1), 2), /Missing benchmark records/);
  assert.throws(() => summarizeBenchmarkRecords(records.map((entry, index) => index === 0 ? { ...entry, inventory: { ...entry.inventory, observedDigest: 'c'.repeat(64) } } : entry), 2), /identical inventory/);
  assert.throws(() => summarizeBenchmarkRecords(records.map((entry, index) => index === 0 ? { ...entry, sourceSha: 'd'.repeat(40) } : entry), 2), /one exact source SHA/);
});

test('benchmark record validation rejects malformed timing and identity claims', () => {
  const valid = record(BENCHMARK_CONDITIONS[0], 1, 1000);
  assert.equal(validateBenchmarkRecord(valid), valid);
  assert.throws(() => validateBenchmarkRecord({ ...valid, status: 'UNKNOWN' }), /PASS or FAIL/);
  assert.throws(() => validateBenchmarkRecord({ ...valid, durations: { ...valid.durations, wallMs: -1 } }), /non-negative/);
});

test('manifest materialization creates unique run identities without changing inventory', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'forgeqa-benchmark-contract-'));
  const planPath = join(temporary, 'plan.json');
  const output = join(temporary, 'manifests');
  const manifest = {
    schemaVersion: 1,
    runId: 'original',
    configHash: 'config',
    selectionHash: 'selection',
    expected: [
      { executionId: 'one', logicalTestId: 'one', project: 'api', environment: 'local', shardIndex: 1, shardTotal: 2 },
      { executionId: 'two', logicalTestId: 'two', project: 'chromium', environment: 'local', shardIndex: 2, shardTotal: 2 }
    ]
  };
  await writeFile(planPath, JSON.stringify({ workers: 1, shardCount: 2, manifest }));
  const result = spawnSync(process.execPath, [
    resolve('benchmarks/materialize-manifests.mjs'),
    '--condition', 'distributed-2x1',
    '--repetitions', '3',
    '--plan', planPath,
    '--plan-duration-ms', '25',
    '--output', output
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const generated = await Promise.all([1, 2, 3].map(async repetition => JSON.parse(await readFile(join(output, `manifest-r${repetition}.json`), 'utf8'))));
  assert.equal(new Set(generated.map(entry => entry.runId)).size, 3);
  for (const entry of generated) assert.deepEqual(entry.expected, manifest.expected);
  const metadata = JSON.parse(await readFile(join(output, 'plan-metadata.json'), 'utf8'));
  assert.equal(metadata.inventoryCount, 2);
  assert.equal(metadata.planMs, 25);
});


test('summary materializes failure evidence when benchmark records are absent', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'forgeqa-benchmark-empty-'));
  const input = join(temporary, 'records');
  const output = join(temporary, 'summary');
  await mkdir(input, { recursive: true });
  const result = spawnSync(process.execPath, [
    resolve('benchmarks/summarize.mjs'),
    '--input', input,
    '--repetitions', '1',
    '--output', output
  ], { encoding: 'utf8' });
  assert.equal(result.status, 1, result.stderr);
  const summary = JSON.parse(await readFile(join(output, 'summary.json'), 'utf8'));
  assert.equal(summary.status, 'FAIL');
  assert.match(summary.failure, /No benchmark records found/);
  assert.equal(await readFile(join(output, 'raw.jsonl'), 'utf8'), '');
  assert.match(await readFile(join(output, 'summary.md'), 'utf8'), /## Failure/);
});

test('hosted workflow uses independent shard jobs and fail-closed evidence merging', async () => {
  const workflow = (await readFile('.github/workflows/benchmark.yml', 'utf8')).replaceAll('\r\n', '\n');
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /schedule:/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /matrix: \$\{\{ fromJSON\(needs\.setup\.outputs\.shards\) \}\}/);
  assert.match(workflow, /fail-fast: false/g);
  assert.match(workflow, /image: postgres:17/);
  assert.match(workflow, /playwright install chromium firefox webkit/);
  assert.match(workflow, /attempts\.ndjson\.final\.json/);
  assert.match(workflow, /record-run\.mjs/);
  assert.match(workflow, /summarize\.mjs/);
  assert.match(workflow, /Verify inventory equivalence and summarize measurements\n\s+if: always\(\)/);
  assert.doesNotMatch(workflow, /continue-on-error:\s*true/);
});
