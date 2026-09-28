import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export const MEASUREMENT_VERSION = 2;
export const SPEEDUP_BASIS = 'criticalPathMs';
export const TIMING_LIMITATIONS = [
  'Speedup compares max measured shard execution duration plus merge/report duration; it is not workflow wall-time speedup.',
  'Observed wallMs includes GitHub scheduling and the shared matrix barrier. It must not be used to rank conditions.',
  'Runner time covers instrumented intervals, not billed runner time; checkout, service startup, final uploads and service shutdown are excluded.',
  'Application startup/readiness, test execution, in-process reporting and application shutdown are combined inside each shard run; finer lifecycle timings are not separately measured.',
  'Benchmarks use a locked source checkout, not installed registry packages. Packed-package adoption is verified by the separate consumer lanes.'
];

function integer(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer.`);
  return value;
}

export function validateShardTimings(timings) {
  if (!timings || typeof timings !== 'object') throw new Error('Shard timings are required.');
  for (const key of ['jobStartMs', 'setupEndMs', 'runStartMs', 'runEndMs', 'setupMs', 'runMs', 'totalMs']) integer(timings[key], key);
  const { jobStartMs, setupEndMs, runStartMs, runEndMs } = timings;
  if (jobStartMs > setupEndMs || setupEndMs > runStartMs || runStartMs > runEndMs) throw new Error('Shard timestamps are not monotonic.');
  if (timings.setupMs !== setupEndMs - jobStartMs || timings.runMs !== runEndMs - runStartMs || timings.totalMs !== runEndMs - jobStartMs) throw new Error('Shard duration disagrees with timestamps.');
  return timings;
}

// Never subtract timestamps from different VMs to derive execution speedup.
export function measuredDurations(shards, planMs, mergeJobStartMs, mergeStartMs, mergeEndMs) {
  if (!shards.length) throw new Error('No shard timings available.');
  [planMs, mergeJobStartMs, mergeStartMs, mergeEndMs].forEach((value, index) => integer(value, `merge timing ${index}`));
  if (mergeJobStartMs > mergeStartMs || mergeStartMs > mergeEndMs) throw new Error('Merge timestamps are not monotonic.');
  const times = shards.map(entry => validateShardTimings(entry.timings));
  const sum = (key) => times.reduce((total, entry) => total + entry[key], 0);
  const max = (key) => Math.max(...times.map(entry => entry[key]));
  const min = (key) => Math.min(...times.map(entry => entry[key]));
  const mergeMs = mergeEndMs - mergeStartMs;
  return {
    planMs,
    setupWallMs: max('setupMs'),
    setupAggregateMs: sum('setupMs') + mergeStartMs - mergeJobStartMs,
    testWallMs: max('runMs'),
    testAggregateMs: sum('runMs'),
    mergeMs,
    criticalPathMs: max('runMs') + mergeMs,
    schedulingSkewMs: max('runStartMs') - min('runStartMs'),
    coordinationWaitMs: Math.max(0, mergeStartMs - max('runEndMs')),
    wallMs: planMs + Math.max(0, mergeEndMs - min('jobStartMs')),
    aggregateRunnerMs: planMs + sum('totalMs') + mergeEndMs - mergeJobStartMs
  };
}

export async function protocolDigest(runner) {
  const paths = ['package-lock.json', 'examples/demo-saas/forgeqa.benchmark.config.ts', 'examples/demo-saas/playwright.benchmark.config.ts'];
  const contents = await Promise.all(paths.map(async path => [path, (await readFile(path, 'utf8')).replaceAll('\r\n', '\n')]));
  // CPU allocation, binary versions and policy inputs must match; VM IDs must not.
  const environment = Object.fromEntries(['platform', 'arch', 'node', 'playwright', 'image', 'imageVersion', 'cpuCount'].map(key => [key, runner[key]]));
  // Linux reserves a few pages differently across otherwise equal VM allocations.
  // Keep exact bytes in raw data; compare capacity at 1 MiB granularity.
  environment.memoryMiB = Math.round(runner.totalMemoryBytes / (1024 * 1024));
  return createHash('sha256').update(JSON.stringify({ measurementVersion: MEASUREMENT_VERSION, contents, environment, cache: 'disabled', retries: 0, warmups: 1 })).digest('hex');
}
