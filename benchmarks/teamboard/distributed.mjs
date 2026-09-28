import assert from 'node:assert/strict';
import { basename, resolve } from 'node:path';
import {
  BENCHMARK_SCHEMA_VERSION,
  assertEquivalentInventory,
  assertTeamBoardInventory,
  conditionById,
  inventoryFromAttempts,
  inventoryFromEntries,
  inventoryFromManifest,
  projectMetrics,
} from '../lib/contract.mjs';
import {
  environmentSnapshot,
  sourceRevision,
  workflowStageDurations,
} from '../lib/environment.mjs';
import {
  copyDirectory,
  findFiles,
  readJson,
  resetDirectory,
  writeJson,
} from '../lib/process.mjs';
import {
  assertSuccessfulRun,
  baseRecord,
  forgeArguments,
  invokeForge,
  outputPath,
  positiveInteger,
  required,
} from './common.mjs';

export async function distributedShard(options) {
  const condition = conditionById(required(options, 'condition'));
  assert.equal(condition.distributed, true, `${condition.id} is not a distributed condition.`);
  const repetition = positiveInteger(required(options, 'repetition'), 'repetition');
  const shardIndex = positiveInteger(required(options, 'shard-index'), 'shard-index');
  assert.ok(shardIndex <= condition.shardCount, 'Shard index exceeds the condition shard count.');
  const manifestPath = resolve(required(options, 'manifest'));
  const output = outputPath(options, condition, repetition, `shard-${shardIndex}`);
  await resetDirectory(output);

  const manifest = await readJson(manifestPath);
  const fullInventory = inventoryFromManifest(manifest);
  const expectedEntries = manifest.expected.filter((entry) => entry.shardIndex === shardIndex);
  assert.ok(expectedEntries.length > 0, `Manifest does not assign executions to shard ${shardIndex}.`);
  const expectedInventory = inventoryFromEntries(expectedEntries);
  assert.ok(manifest.expected.every((entry) => entry.shardTotal === condition.shardCount), 'Manifest shard dimensions differ from the condition.');

  const executionStartedMs = Date.now();
  const run = invokeForge(
    forgeArguments('run', condition, [
      '--shard',
      `${shardIndex}/${condition.shardCount}`,
      '--manifest',
      manifestPath,
    ]),
    `${condition.id} shard ${shardIndex}`,
  );
  const completedMs = Date.now();
  assertSuccessfulRun(run, `${condition.id} shard ${shardIndex}`);

  const finalized = await readJson(resolve(run.runDir, 'attempts.ndjson.final.json'));
  assert.equal(finalized.completion, 'complete', 'Shard finalization is incomplete.');
  assert.equal(finalized.shardIndex, shardIndex, 'Finalized shard index differs from the requested shard.');
  assert.equal(finalized.shardTotal, condition.shardCount, 'Finalized shard total differs from the condition.');
  assert.equal(finalized.selectionHash, manifest.selectionHash, 'Shard selection hash differs from the immutable manifest.');
  const observedInventory = inventoryFromAttempts(finalized.attempts);
  assertEquivalentInventory(expectedInventory, observedInventory, `${condition.id} shard ${shardIndex}`);

  await copyDirectory(run.runDir, resolve(output, 'run'));
  const record = {
    schemaVersion: BENCHMARK_SCHEMA_VERSION,
    kind: 'forgeqa-teamboard-benchmark-shard',
    sourceSha: sourceRevision(),
    condition: condition.id,
    repetition,
    shardIndex,
    shardCount: condition.shardCount,
    workersPerShard: condition.workersPerShard,
    startedAt: new Date(executionStartedMs).toISOString(),
    completedAt: new Date(completedMs).toISOString(),
    fullInventory,
    expectedInventory,
    observedInventory,
    testMs: completedMs - executionStartedMs,
    stageDurations: workflowStageDurations(executionStartedMs, completedMs),
    environment: environmentSnapshot(),
    run: {
      runId: run.runId,
      tests: run.tests,
      attempts: run.attempts,
      completion: run.completion,
      gate: run.gate,
    },
    evidence: {
      runDirectory: 'run',
      finalShard: 'run/attempts.ndjson.final.json',
    },
  };
  await writeJson(resolve(output, 'shard-record.json'), record);
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

export async function distributedMerge(options) {
  const condition = conditionById(required(options, 'condition'));
  assert.equal(condition.distributed, true, `${condition.id} is not a distributed condition.`);
  const repetition = positiveInteger(required(options, 'repetition'), 'repetition');
  const manifestPath = resolve(required(options, 'manifest'));
  const planRecordPath = resolve(required(options, 'plan-record'));
  const input = resolve(required(options, 'input'));
  const output = outputPath(options, condition, repetition, 'merged');
  await resetDirectory(output);

  const manifest = await readJson(manifestPath);
  const planRecord = await readJson(planRecordPath);
  const inventory = assertTeamBoardInventory(inventoryFromManifest(manifest), condition.id);
  assert.equal(planRecord.condition, condition.id, 'Plan record condition differs from merge condition.');
  assert.equal(planRecord.repetition, repetition, 'Plan record repetition differs from merge repetition.');
  assertEquivalentInventory(inventory, planRecord.inventory, 'plan record');

  const shardRecordPaths = await findFiles(input, 'shard-record.json');
  const finalizedPaths = await findFiles(input, 'attempts.ndjson.final.json');
  assert.equal(shardRecordPaths.length, condition.shardCount, 'Distributed benchmark is missing shard records.');
  assert.equal(finalizedPaths.length, condition.shardCount, 'Distributed benchmark is missing finalized shard evidence.');
  const shardRecords = await Promise.all(shardRecordPaths.map(readJson));
  assert.deepEqual(
    shardRecords.map((record) => record.shardIndex).sort((a, b) => a - b),
    Array.from({ length: condition.shardCount }, (_, index) => index + 1),
    'Distributed benchmark shard identities are incomplete or duplicated.',
  );
  for (const record of shardRecords) {
    assert.equal(record.condition, condition.id, 'Shard record condition differs from merge condition.');
    assert.equal(record.repetition, repetition, 'Shard record repetition differs from merge repetition.');
  }

  const executionStartedMs = Date.now();
  const mergedDirectory = resolve(output, 'run');
  const merge = invokeForge(
    [
      'report',
      'merge',
      '--manifest',
      manifestPath,
      '--output',
      mergedDirectory,
      ...finalizedPaths,
      '--json',
    ],
    `${condition.id} merge`,
  );
  const completedMs = Date.now();
  assert.equal(merge.completion, 'complete', 'Merged benchmark evidence is incomplete.');
  assert.equal(merge.gate?.outcome, 'pass', 'Merged benchmark gate did not pass.');

  const report = await readJson(resolve(mergedDirectory, 'report.json'));
  const observedInventory = inventoryFromAttempts(report.attempts);
  assertEquivalentInventory(inventory, observedInventory, condition.id);
  assertTeamBoardInventory(observedInventory, `${condition.id} observed`);
  const wallStartMs = Date.parse(planRecord.benchmarkStartedAt);
  assert.ok(Number.isFinite(wallStartMs), 'Plan record has an invalid benchmark start time.');
  const mergeStages = workflowStageDurations(executionStartedMs, completedMs);
  const aggregateRunnerMs =
    Number(planRecord.stageDurations?.jobElapsedMs ?? planRecord.planMs ?? 0)
    + shardRecords.reduce((sum, record) => sum + Number(record.stageDurations?.jobElapsedMs ?? record.testMs ?? 0), 0)
    + Number(mergeStages.jobElapsedMs ?? completedMs - executionStartedMs);

  const record = {
    ...baseRecord(condition, repetition, planRecord.benchmarkStartedAt),
    status: 'PASS',
    completedAt: new Date(completedMs).toISOString(),
    inventory,
    observedInventory,
    projectMetrics: projectMetrics(report.attempts),
    run: {
      runId: merge.runId,
      completion: merge.completion,
      tests: merge.tests,
      attempts: merge.attempts,
      gate: merge.gate,
    },
    durations: {
      installMs: null,
      buildMs: null,
      browserInstallMs: null,
      databaseSetupMs: null,
      preExecutionSetupMs: null,
      jobElapsedMs: mergeStages.jobElapsedMs,
      planMs: Number(planRecord.planMs),
      testMs: Math.max(...shardRecords.map((record) => Number(record.testMs))),
      summedShardTestMs: shardRecords.reduce((sum, record) => sum + Number(record.testMs), 0),
      mergeMs: completedMs - executionStartedMs,
      wholeWorkflowWallMs: completedMs - wallStartMs,
      aggregateRunnerMs,
      summedAttemptDurationMs: report.attempts.reduce((sum, attempt) => sum + Number(attempt.durationMs ?? 0), 0),
    },
    distributedRunners: shardRecords.map((record) => ({
      shardIndex: record.shardIndex,
      testMs: record.testMs,
      stageDurations: record.stageDurations,
      environment: record.environment,
      expectedInventory: record.expectedInventory,
      observedInventory: record.observedInventory,
    })),
    evidence: {
      manifest: basename(manifestPath),
      shardCount: shardRecords.length,
      mergedDirectory: 'run',
      report: 'run/report.json',
      complete: 'run/complete.json',
    },
    limitations: [
      'GitHub-hosted runner hardware is shared infrastructure; results record the observed runner metadata and must not be generalized beyond comparable runs.',
    ],
  };
  await writeJson(resolve(output, 'benchmark-record.json'), record);
  process.stdout.write(`${JSON.stringify(record)}\n`);
}
