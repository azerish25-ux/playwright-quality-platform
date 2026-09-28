import { cpus, totalmem, platform, release, arch } from 'node:os';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { benchmarkCondition } from './lib/conditions.mjs';

const args = parseArgs(process.argv.slice(2));
const condition = benchmarkCondition(required(args, 'condition'));
const repetition = positiveInteger(required(args, 'repetition'), 'repetition');
const shard = positiveInteger(required(args, 'shard'), 'shard');
const status = Number(required(args, 'status'));
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
  kind: 'forgeqa-benchmark-shard',
  sourceSha: process.env.FORGEQA_SOURCE_SHA ?? 'local',
  condition: condition.id,
  repetition,
  shard,
  shards: condition.shards,
  workers: condition.workers,
  status,
  startedAt: new Date(jobStartMs).toISOString(),
  completedAt: new Date(runEndMs).toISOString(),
  timings: {
    jobStartMs,
    setupEndMs,
    runStartMs,
    runEndMs,
    setupMs: setupEndMs - jobStartMs,
    runMs: runEndMs - runStartMs,
    totalMs: runEndMs - jobStartMs
  },
  runner: {
    platform: platform(),
    release: release(),
    arch: arch(),
    node: process.version,
    playwright: playwrightPackage.version,
    packageManager: rootPackage.packageManager ?? 'unknown',
    cpuCount: cpus().length,
    cpuModel: cpus()[0]?.model ?? 'unknown',
    totalMemoryBytes: totalmem(),
    image: process.env.ImageOS ?? process.env.RUNNER_OS ?? 'local'
  }
};
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(metadata, null, 2)}\n`);

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
