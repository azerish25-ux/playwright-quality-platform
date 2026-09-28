import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import {
  BENCHMARK_SCHEMA_VERSION,
  assertEquivalentInventory,
  assertTeamBoardInventory,
  conditionById,
  inventoryFromAttempts,
  inventoryFromManifest,
  projectMetrics,
} from '../lib/contract.mjs';
import {
  benchmarkStartedAt,
  environmentSnapshot,
  sourceRevision,
  workflowStageDurations,
} from '../lib/environment.mjs';
import {
  copyDirectory,
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

export async function localBenchmark(options) {
  const condition = conditionById(required(options, 'condition'));
  assert.equal(condition.distributed, false, `${condition.id} requires the hosted distributed workflow.`);
  const repetition = positiveInteger(required(options, 'repetition'), 'repetition');
  const output = outputPath(options, condition, repetition);
  await resetDirectory(output);

  const processStartedMs = Date.now();
  const startedAt = benchmarkStartedAt(processStartedMs);
  const planStartedMs = Date.now();
  const plan = invokeForge(
    forgeArguments('plan', condition, ['--shard', '1/1']),
    `${condition.id} plan`,
  );
  const planCompletedMs = Date.now();
  const inventory = assertTeamBoardInventory(inventoryFromManifest(plan.manifest), condition.id);
  await writeJson(resolve(output, 'manifest.json'), plan.manifest);
  await writeJson(resolve(output, 'plan-output.json'), plan);

  const runStartedMs = Date.now();
  const run = invokeForge(
    forgeArguments('run', condition, [
      '--shard',
      '1/1',
      '--manifest',
      resolve(output, 'manifest.json'),
    ]),
    `${condition.id} run`,
  );
  const runCompletedMs = Date.now();
  assertSuccessfulRun(run, condition.id);

  const report = await readJson(resolve(run.runDir, 'report.json'));
  const observedInventory = inventoryFromAttempts(report.attempts);
  assertEquivalentInventory(inventory, observedInventory, condition.id);
  assertTeamBoardInventory(observedInventory, `${condition.id} observed`);
  assert.equal(report.completion, 'complete', `${condition.id}: report is incomplete.`);
  assert.equal(report.gate?.outcome, 'pass', `${condition.id}: report gate failed.`);

  await copyDirectory(run.runDir, resolve(output, 'run'));
  const completedMs = Date.now();
  const stages = workflowStageDurations(planStartedMs, completedMs);
  const record = {
    ...baseRecord(condition, repetition, startedAt),
    status: 'PASS',
    completedAt: new Date(completedMs).toISOString(),
    inventory,
    observedInventory,
    projectMetrics: projectMetrics(report.attempts),
    run: {
      runId: run.runId,
      completion: run.completion,
      tests: run.tests,
      attempts: run.attempts,
      gate: run.gate,
    },
    durations: {
      ...stages,
      planMs: planCompletedMs - planStartedMs,
      testMs: runCompletedMs - runStartedMs,
      mergeMs: 0,
      wholeWorkflowWallMs: completedMs - Date.parse(startedAt),
      aggregateRunnerMs: stages.jobElapsedMs ?? completedMs - processStartedMs,
      summedAttemptDurationMs: report.attempts.reduce((sum, attempt) => sum + Number(attempt.durationMs ?? 0), 0),
    },
    evidence: {
      manifest: 'manifest.json',
      runDirectory: 'run',
      report: 'run/report.json',
      finalShard: 'run/attempts.ndjson.final.json',
    },
    limitations: [],
  };
  await writeJson(resolve(output, 'benchmark-record.json'), record);
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

export async function distributedPlan(options) {
  const condition = conditionById(required(options, 'condition'));
  assert.equal(condition.distributed, true, `${condition.id} is not a distributed condition.`);
  const repetition = positiveInteger(required(options, 'repetition'), 'repetition');
  const output = outputPath(options, condition, repetition, 'plan');
  await resetDirectory(output);

  const executionStartedMs = Date.now();
  const startedAt = benchmarkStartedAt(executionStartedMs);
  const plan = invokeForge(
    forgeArguments('plan', condition, ['--shard', `1/${condition.shardCount}`]),
    `${condition.id} distributed plan`,
  );
  const completedMs = Date.now();
  const inventory = assertTeamBoardInventory(inventoryFromManifest(plan.manifest), condition.id);
  assert.equal(plan.shardCount, condition.shardCount, 'Planned shard count differs from the benchmark condition.');
  await writeJson(resolve(output, 'manifest.json'), plan.manifest);
  await writeJson(resolve(output, 'plan-output.json'), plan);
  const record = {
    schemaVersion: BENCHMARK_SCHEMA_VERSION,
    kind: 'forgeqa-teamboard-benchmark-plan',
    sourceSha: sourceRevision(),
    condition: condition.id,
    repetition,
    benchmarkStartedAt: startedAt,
    planStartedAt: new Date(executionStartedMs).toISOString(),
    completedAt: new Date(completedMs).toISOString(),
    shardCount: condition.shardCount,
    workersPerShard: condition.workersPerShard,
    inventory,
    planMs: completedMs - executionStartedMs,
    stageDurations: workflowStageDurations(executionStartedMs, completedMs),
    environment: environmentSnapshot(),
  };
  await writeJson(resolve(output, 'plan-record.json'), record);
  process.stdout.write(`${JSON.stringify(record)}\n`);
}
