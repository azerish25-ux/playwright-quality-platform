import { cpus, totalmem, platform, release, arch } from 'node:os';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { readExecutionTiming } from '@azerish25-ux/forgeqa-core';
import { benchmarkCondition } from './lib/conditions.mjs';
import { MEASUREMENT_VERSION, protocolDigest } from './lib/measurement.mjs';

const args = parseArgs(process.argv.slice(2));
const condition = benchmarkCondition(required(args, 'condition'));
const repetition = positiveInteger(required(args, 'repetition'), 'repetition');
const shard = positiveInteger(required(args, 'shard'), 'shard');
const status = Number(required(args, 'status'));
if (!Number.isInteger(status) || status < 0 || status > 255) throw new Error('Invalid shard exit status.');
const jobStartMs = timestamp(required(args, 'job-start-ms'), 'job-start-ms');
const setupEndMs = timestamp(required(args, 'setup-end-ms'), 'setup-end-ms');
const runStartMs = timestamp(required(args, 'run-start-ms'), 'run-start-ms');
const runEndMs = timestamp(required(args, 'run-end-ms'), 'run-end-ms');
if (shard > condition.shards) throw new Error('Shard index exceeds benchmark condition shard count.');
if (setupEndMs < jobStartMs || runStartMs < setupEndMs || runEndMs < runStartMs) throw new Error('Shard benchmark timestamps are not monotonic.');
const output = resolve(required(args, 'output'));
const rootPackage = JSON.parse(await readFile(resolve('package.json'), 'utf8'));
const playwrightPackage = JSON.parse(await readFile(resolve('node_modules/@playwright/test/package.json'), 'utf8'));
const metadata = {
  schemaVersion: 1,
  measurementVersion: MEASUREMENT_VERSION,
  warmups: 1,
  warmupStatus: Number(required(args, 'warmup-status')),
  kind: 'forgeqa-benchmark-shard',
  sourceSha: process.env.FORGEQA_SOURCE_SHA ?? 'local',
  condition: condition.id,
  repetition, shard, shards: condition.shards, workers: condition.workers, status,
  startedAt: new Date(jobStartMs).toISOString(),
  completedAt: new Date(runEndMs).toISOString(),
  timings: { jobStartMs, setupEndMs, runStartMs, runEndMs, setupMs: setupEndMs - jobStartMs, runMs: runEndMs - runStartMs, totalMs: runEndMs - jobStartMs },
  runner: {
    platform: platform(), release: release(), arch: arch(), node: process.version,
    ...(process.env.FORGEQA_BENCHMARK_IMAGE ? { containerImage: process.env.FORGEQA_BENCHMARK_IMAGE } : {}),
    playwright: playwrightPackage.version, packageManager: rootPackage.packageManager ?? 'unknown',
    cpuCount: cpus().length, cpuModel: cpus()[0]?.model ?? 'unknown', totalMemoryBytes: totalmem(),
    imageVersion: process.env.ImageVersion ?? 'local', image: process.env.ImageOS ?? process.env.RUNNER_OS ?? 'local'
  }
};
const warmup = JSON.parse(await readFile(resolve('evidence/benchmarks/warmups', condition.id, `r${repetition}`, `s${shard}`, 'warmup.json'), 'utf8'));
if (warmup.status !== 'PASS' || warmup.condition !== condition.id || warmup.repetition !== repetition || warmup.shard !== shard) throw new Error('Missing or incompatible verified warm-up receipt.');
metadata.warmup = warmup;
metadata.protocolDigest = await protocolDigest(metadata.runner);
metadata.timingVersion = 1;
try {
  const summary = JSON.parse(await readFile(resolve(dirname(output), 'run-summary.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(resolve('evidence/benchmarks/plans', condition.id, `manifest-r${repetition}.json`), 'utf8'));
  if (summary.runId !== manifest.runId || typeof summary.runDir !== 'string') throw new Error('Wrong-run profiling summary.');
  const runDir = await realpath(resolve(summary.runDir));
  const ownedRoot = await realpath(resolve('examples/demo-saas/forgeqa-benchmark-results', condition.id));
  const owned = relative(ownedRoot, runDir);
  if (!owned || owned === '..' || owned.startsWith('../') || isAbsolute(owned)) throw new Error('Profiling output escaped its owned benchmark root.');
  metadata.lifecycle = readExecutionTiming(resolve(runDir, 'timing'), { sourceSha: metadata.sourceSha, runId: manifest.runId, shardIndex: shard, shardTotal: condition.shards }, metadata.timings.runMs);
  const count = manifest.expected.filter(entry => entry.shardIndex === shard && entry.shardTotal === condition.shards).length;
  if (metadata.lifecycle.attempts !== count) throw new Error('Timing attempts disagree with the shard inventory.');
  metadata.lifecycleStatus = 'PASS';
} catch (error) {
  metadata.lifecycle = null;
  metadata.lifecycleStatus = 'FAIL';
  metadata.lifecycleFailure = String(error.message).slice(0, 500);
  process.exitCode = status === 0 ? 3 : status;
}
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(metadata, null, 2)}\n`);
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
