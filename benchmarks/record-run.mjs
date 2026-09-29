import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { benchmarkCondition } from './lib/conditions.mjs';
import { assertEquivalentExecutionInventory, expectedInventoryDigest, observedInventoryDigest, projectInventory } from './lib/inventory.mjs';
import { MEASUREMENT_VERSION, measuredDurations } from './lib/measurement.mjs';
import { checkedProfile, summarizeProfiles } from './lib/profiling.mjs';

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
if (planMetadata.condition !== condition.id || planMetadata.workers !== condition.workers || planMetadata.shards !== condition.shards) throw new Error('Benchmark plan metadata does not match the requested condition.');
const shardMetadataPaths = (await findFiles(shardRoot, 'shard-metadata.json')).sort();
const shardMetadata = await Promise.all(shardMetadataPaths.map(async path => JSON.parse(await readFile(path, 'utf8'))));
const failures = [];
if (planMetadata.sourceSha !== process.env.FORGEQA_SOURCE_SHA) failures.push('Plan source does not match the requested source revision.');
if (shardMetadata.length !== condition.shards) failures.push(`Expected ${condition.shards} shard metadata files; found ${shardMetadata.length}.`);
const shardIndexes = shardMetadata.map(entry => entry.shard).sort((left, right) => left - right);
if (new Set(shardIndexes).size !== shardIndexes.length) failures.push('Duplicate shard metadata was downloaded.');
for (let shard = 1; shard <= condition.shards; shard += 1) if (!shardIndexes.includes(shard)) failures.push(`Missing shard metadata for shard ${shard}.`);
const profiles = [];
for (const metadata of shardMetadata) {
  if (metadata.condition !== condition.id || metadata.repetition !== repetition || metadata.shards !== condition.shards || metadata.workers !== condition.workers) failures.push(`Shard ${metadata.shard ?? '?'} metadata does not match the benchmark condition.`);
  if (metadata.sourceSha !== (process.env.FORGEQA_SOURCE_SHA ?? metadata.sourceSha)) failures.push(`Shard ${metadata.shard ?? '?'} used a different source SHA.`);
  if (metadata.measurementVersion !== MEASUREMENT_VERSION || metadata.warmups !== 1 || metadata.warmupStatus !== 0) failures.push('Shard lacks a verified unmeasured warm-up.');
  if (metadata.status !== 0) failures.push(`Shard ${metadata.shard ?? '?'} exited with status ${metadata.status}.`);
  try {
    if (metadata.timingVersion !== 1 || metadata.lifecycleStatus !== 'PASS') throw new Error('Missing required lifecycle evidence.');
    const profile = checkedProfile(metadata.lifecycle, { sourceSha: planMetadata.sourceSha, runId: manifest.runId, shardIndex: metadata.shard, shardTotal: condition.shards }, metadata.timings.runMs);
    const count = manifest.expected.filter(entry => entry.shardIndex === metadata.shard && entry.shardTotal === condition.shards).length;
    if (profile.attempts !== count) throw new Error('Timing attempt count differs from the exact shard inventory.');
    profiles.push(profile);
  } catch (error) { failures.push(`Shard ${metadata.shard} timing: ${error.message}`); }
}
if (new Set(shardMetadata.map(entry => entry.protocolDigest)).size !== 1) failures.push('Shard protocols disagree.');
if (mergeStatus !== 0) failures.push(`Merge exited with status ${mergeStatus}.`);
let report;
try { report = JSON.parse(await readFile(resolve(mergedRoot, 'report.json'), 'utf8')); }
catch (error) { failures.push(`Merged report is unavailable: ${error instanceof Error ? error.message : String(error)}`); }
let inventory = { count: manifest.expected.length, expectedDigest: expectedInventoryDigest(manifest.expected), observedDigest: report ? observedInventoryDigest(report.attempts ?? []) : '0'.repeat(64), projects: projectInventory(manifest.expected) };
if (report) {
  for (const key of ['runId', 'configHash', 'selectionHash']) if (report[key] !== manifest[key]) failures.push(`Merged report ${key} disagrees with manifest.`);
  if (report.attempts?.some(entry => entry.retry !== 0 || entry.outcome !== 'passed') || report.attempts?.length !== manifest.expected.length) failures.push('Benchmark requires one clean first attempt per expected execution.');
  try { inventory = { ...assertEquivalentExecutionInventory(manifest.expected, report.attempts ?? []), projects: projectInventory(manifest.expected) }; }
  catch (error) { failures.push(error instanceof Error ? error.message : String(error)); }
  if (report.completion !== 'complete') failures.push(`Merged report completion is ${String(report.completion)}.`);
  if ((report.missingExecutions?.length ?? 0) !== 0) failures.push('Merged report contains missing executions.');
  if ((report.unexpectedExecutions?.length ?? 0) !== 0) failures.push('Merged report contains unexpected executions.');
  if ((report.duplicateExecutions?.length ?? 0) !== 0) failures.push('Merged report contains duplicate executions.');
  if (report.gate?.outcome !== 'pass') failures.push(`Merged quality gate outcome is ${String(report.gate?.outcome)}.`);
}
const durations = measuredDurations(shardMetadata, planMetadata.planMs, mergeJobStartMs, mergeStartMs, mergeEndMs);
const record = {
  schemaVersion: 1, measurementVersion: MEASUREMENT_VERSION,
  protocolDigest: shardMetadata[0]?.protocolDigest,
  kind: 'forgeqa-benchmark-run', status: failures.length ? 'FAIL' : 'PASS',
  sourceSha: process.env.FORGEQA_SOURCE_SHA ?? planMetadata.sourceSha ?? 'local',
  application: { name: 'TeamBoard', sourceSha: process.env.FORGEQA_SOURCE_SHA ?? planMetadata.sourceSha ?? 'local' },
  provenance: { repository: process.env.GITHUB_REPOSITORY ?? 'local', workflow: process.env.GITHUB_WORKFLOW ?? 'local', runId: process.env.GITHUB_RUN_ID ?? 'local', runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? '1', ref: process.env.GITHUB_REF ?? 'local' },
  condition: condition.id, label: condition.label, topology: condition.topology, repetition, workers: condition.workers, shards: condition.shards,
  warmups: 1, cacheState: 'dependency-cache-disabled', artifactPolicy: { trace: 'off', screenshot: 'off', video: 'off' }, generatedAt: new Date().toISOString(),
  inventory, attempts: Array.isArray(report?.attempts) ? report.attempts.length : 0, durations,
  runners: shardMetadata.map(entry => ({ shard: entry.shard, ...entry.runner })),
  runId: manifest.runId, failures,
  timingVersion: 1,
  lifecycle: profiles.length === condition.shards ? { profiles, summary: summarizeProfiles(profiles) } : null
};
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(record, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ status: record.status, condition: record.condition, repetition: record.repetition, output, failures })}\n`);
if (record.status !== 'PASS') process.exitCode = 1;
async function findFiles(root, name) {
  const output = [];
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); } catch { return output; }
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
    const name = token.slice(2), value = tokens[index + 1];
    if (value === undefined || value.startsWith('--') || values.has(name)) throw new Error(`--${name} requires one value.`);
    values.set(name, value); index += 1;
  }
  return values;
}
function required(values, name) { const value = values.get(name); if (value === undefined || value === '') throw new Error(`Missing --${name}.`); return value; }
function positiveInteger(value, name) { const number = Number(value); if (!Number.isSafeInteger(number) || number < 1) throw new Error(`${name} must be a positive integer.`); return number; }
function timestamp(value, name) { const number = Number(value); if (!Number.isSafeInteger(number) || number < 0) throw new Error(`${name} must be a millisecond timestamp.`); return number; }
