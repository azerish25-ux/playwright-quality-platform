import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { benchmarkCondition } from './lib/conditions.mjs';
import { assertEquivalentExecutionInventory, expectedInventoryDigest, observedInventoryDigest, projectInventory } from './lib/inventory.mjs';

const args = parseArgs(process.argv.slice(2));
const condition = benchmarkCondition(required(args, 'condition'));
const repetition = positiveInteger(required(args, 'repetition'), 'repetition');
const manifestPath = resolve(required(args, 'manifest'));
const planMetadataPath = resolve(required(args, 'plan-metadata'));
const shardRoot = resolve(required(args, 'shard-root'));
const mergedRoot = resolve(required(args, 'merged-root'));
const output = resolve(required(args, 'output'));
const mergeStatus = Number(required(args, 'merge-status'));
const mergeJobStartMs = timestamp(args.get('merge-job-start-ms') ?? required(args, 'merge-start-ms'), 'merge-job-start-ms');
const mergeStartMs = timestamp(required(args, 'merge-start-ms'), 'merge-start-ms');
const mergeEndMs = timestamp(required(args, 'merge-end-ms'), 'merge-end-ms');
if (mergeStartMs < mergeJobStartMs || mergeEndMs < mergeStartMs) throw new Error('Merge timestamps are not monotonic.');

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const planMetadata = JSON.parse(await readFile(planMetadataPath, 'utf8'));
if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.expected) || !manifest.expected.length) throw new Error('Benchmark manifest is invalid.');
if (planMetadata.condition !== condition.id || planMetadata.workers !== condition.workers || planMetadata.shards !== condition.shards) {
  throw new Error('Benchmark plan metadata does not match the requested condition.');
}
const shardMetadataPaths = (await findFiles(shardRoot, 'shard-metadata.json')).sort();
const shardMetadata = await Promise.all(shardMetadataPaths.map(async path => JSON.parse(await readFile(path, 'utf8'))));
const failures = [];
if (shardMetadata.length !== condition.shards) failures.push(`Expected ${condition.shards} shard metadata files; found ${shardMetadata.length}.`);
const shardIndexes = shardMetadata.map(entry => entry.shard).sort((left, right) => left - right);
if (new Set(shardIndexes).size !== shardIndexes.length) failures.push('Duplicate shard metadata was downloaded.');
for (let shard = 1; shard <= condition.shards; shard += 1) if (!shardIndexes.includes(shard)) failures.push(`Missing shard metadata for shard ${shard}.`);
for (const metadata of shardMetadata) {
  if (metadata.condition !== condition.id || metadata.repetition !== repetition || metadata.shards !== condition.shards || metadata.workers !== condition.workers) failures.push(`Shard ${metadata.shard ?? '?'} metadata does not match the benchmark condition.`);
  if (metadata.sourceSha !== (process.env.FORGEQA_SOURCE_SHA ?? metadata.sourceSha)) failures.push(`Shard ${metadata.shard ?? '?'} used a different source SHA.`);
  if (metadata.status !== 0) failures.push(`Shard ${metadata.shard ?? '?'} exited with status ${metadata.status}.`);
}
if (mergeStatus !== 0) failures.push(`Merge exited with status ${mergeStatus}.`);

let report;
try {
  report = JSON.parse(await readFile(resolve(mergedRoot, 'report.json'), 'utf8'));
} catch (error) {
  failures.push(`Merged report is unavailable: ${error instanceof Error ? error.message : String(error)}`);
}
let inventory = {
  count: manifest.expected.length,
  expectedDigest: expectedInventoryDigest(manifest.expected),
  observedDigest: report ? observedInventoryDigest(report.attempts ?? []) : '0'.repeat(64),
  projects: projectInventory(manifest.expected)
};
if (report) {
  try {
    inventory = { ...assertEquivalentExecutionInventory(manifest.expected, report.attempts ?? []), projects: projectInventory(manifest.expected) };
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }
  if (report.completion !== 'complete') failures.push(`Merged report completion is ${String(report.completion)}.`);
  if ((report.missingExecutions?.length ?? 0) !== 0) failures.push('Merged report contains missing executions.');
  if ((report.unexpectedExecutions?.length ?? 0) !== 0) failures.push('Merged report contains unexpected executions.');
  if ((report.duplicateExecutions?.length ?? 0) !== 0) failures.push('Merged report contains duplicate executions.');
  if (report.gate?.outcome !== 'pass') failures.push(`Merged quality gate outcome is ${String(report.gate?.outcome)}.`);
}

const starts = shardMetadata.map(entry => entry.timings?.jobStartMs).filter(Number.isFinite);
const setupEnds = shardMetadata.map(entry => entry.timings?.setupEndMs).filter(Number.isFinite);
const runStarts = shardMetadata.map(entry => entry.timings?.runStartMs).filter(Number.isFinite);
const runEnds = shardMetadata.map(entry => entry.timings?.runEndMs).filter(Number.isFinite);
const sum = values => values.reduce((total, value) => total + value, 0);
const planMs = Number(planMetadata.planMs ?? 0);
const mergeSetupMs = mergeStartMs - mergeJobStartMs;
const setupAggregateMs = sum(shardMetadata.map(entry => Number(entry.timings?.setupMs ?? 0))) + mergeSetupMs;
const testAggregateMs = sum(shardMetadata.map(entry => Number(entry.timings?.runMs ?? 0)));
const shardAggregateMs = sum(shardMetadata.map(entry => Number(entry.timings?.totalMs ?? 0)));
const setupWallMs = starts.length && setupEnds.length ? Math.max(...setupEnds) - Math.min(...starts) : 0;
const testWallMs = runStarts.length && runEnds.length ? Math.max(...runEnds) - Math.min(...runStarts) : 0;
const mergeMs = mergeEndMs - mergeStartMs;
const wallStart = starts.length ? Math.min(...starts) : mergeStartMs;
const wallMs = planMs + Math.max(0, mergeEndMs - wallStart);
const record = {
  schemaVersion: 1,
  kind: 'forgeqa-benchmark-run',
  status: failures.length ? 'FAIL' : 'PASS',
  sourceSha: process.env.FORGEQA_SOURCE_SHA ?? planMetadata.sourceSha ?? 'local',
  application: {
    name: 'TeamBoard',
    sourceSha: process.env.FORGEQA_SOURCE_SHA ?? planMetadata.sourceSha ?? 'local'
  },
  provenance: {
    repository: process.env.GITHUB_REPOSITORY ?? 'local',
    workflow: process.env.GITHUB_WORKFLOW ?? 'local',
    runId: process.env.GITHUB_RUN_ID ?? 'local',
    runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? '1',
    ref: process.env.GITHUB_REF ?? 'local'
  },
  condition: condition.id,
  label: condition.label,
  topology: condition.topology,
  repetition,
  workers: condition.workers,
  shards: condition.shards,
  warmups: 0,
  cacheState: 'dependency-cache-disabled',
  artifactPolicy: { trace: 'off', screenshot: 'off', video: 'off' },
  generatedAt: new Date().toISOString(),
  inventory,
  attempts: Array.isArray(report?.attempts) ? report.attempts.length : 0,
  durations: {
    planMs,
    setupWallMs,
    setupAggregateMs,
    testWallMs,
    testAggregateMs,
    mergeMs,
    wallMs,
    aggregateRunnerMs: planMs + shardAggregateMs + (mergeEndMs - mergeJobStartMs)
  },
  runners: shardMetadata.map(entry => ({ shard: entry.shard, ...entry.runner })),
  runId: manifest.runId,
  failures
};
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(record, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ status: record.status, condition: record.condition, repetition: record.repetition, output, failures })}\n`);
if (record.status !== 'PASS') process.exitCode = 1;

async function findFiles(root, name) {
  const output = [];
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); }
  catch { return output; }
  for (const entry of entries) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) output.push(...await findFiles(path, name));
    else if (entry.isFile() && entry.name === name) output.push(path);
  }
  return output;
}
function parseArgs(tokens) {
  const values = new Map();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith('--')) throw new Error(`Unknown positional argument: ${token}`);
    const name = token.slice(2);
    const value = tokens[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`--${name} requires a value.`);
    values.set(name, value);
    index += 1;
  }
  return values;
}
function required(values, name) {
  const value = values.get(name);
  if (value === undefined || value === '') throw new Error(`Missing --${name}.`);
  return value;
}
function positiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(`${name} must be a positive integer.`);
  return number;
}
function timestamp(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error(`${name} must be a millisecond timestamp.`);
  return number;
}
