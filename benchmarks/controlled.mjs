import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { cpus, totalmem } from 'node:os';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import pg from 'pg';
import { readExecutionTiming } from '@azerish25-ux/forgeqa-core';
import { controlledSchedule, summarizeControlled, validateCleanInventory } from './lib/controlled.mjs';
import { protocolDigest } from './lib/measurement.mjs';

const root = resolve('.');
const app = resolve(root, 'examples/demo-saas');
const cli = resolve(root, 'packages/cli/dist/cli.js');
const output = resolve(root, 'evidence/benchmarks/controlled');
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--repetitions' || !/^[1-5]$/.test(args[1])) throw new Error('Usage: node benchmarks/controlled.mjs --repetitions 1..5');
if (process.platform !== 'linux') throw new Error('Live controlled benchmark requires the Linux/PostgreSQL runner. Contract tests are cross-platform.');
const repetitions = Number(args[1]);
const sourceSha = process.env.FORGEQA_SOURCE_SHA;
if (!/^[a-f0-9]{40}$/.test(sourceSha ?? '')) throw new Error('A verified source SHA is required.');
const runnerSession = randomUUID();
const hardware = { cpuModel: cpus()[0]?.model, cpuCount: cpus().length, totalMemoryBytes: totalmem() };
const playwright = JSON.parse(await readFile(resolve(root, 'node_modules/@playwright/test/package.json'), 'utf8')).version;
const protocol = await protocolDigest({ platform: process.platform, arch: process.arch, node: process.version, playwright, image: process.env.ImageOS, imageVersion: process.env.ImageVersion, containerImage: process.env.FORGEQA_BENCHMARK_IMAGE, cpuCount: hardware.cpuCount });
const records = [];
await mkdir(output, { recursive: true });

async function command(arguments_, cwd, logBase) {
  await mkdir(dirname(logBase), { recursive: true });
  const stdout = [], stderr = [];
  let bytes = 0, failure, forceTimer;
  const started = performance.now();
  const child = spawn(process.execPath, arguments_, { cwd, env: process.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const signalGroup = signal => {
    if (child.pid) try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  };
  const terminate = reason => {
    if (failure) return;
    failure = reason;
    signalGroup('SIGTERM');
    forceTimer = setTimeout(() => signalGroup('SIGKILL'), 2000);
  };
  const interrupt = () => terminate('Benchmark interrupted.');
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  const deadline = setTimeout(() => terminate('Benchmark child exceeded its deadline.'), 660000);
  for (const [stream, chunks] of [[child.stdout, stdout], [child.stderr, stderr]]) stream.on('data', data => {
    bytes += data.length;
    if (bytes > 8 * 1024 * 1024) terminate('Benchmark child exceeded the output limit.');
    else chunks.push(data);
  });
  let status;
  try {
    status = await new Promise((accept, reject) => { child.once('error', reject); child.once('close', accept); });
  } finally {
    clearTimeout(deadline); clearTimeout(forceTimer);
    process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
    signalGroup('SIGKILL');
    await writeFile(`${logBase}.stdout`, Buffer.concat(stdout));
    await writeFile(`${logBase}.stderr`, Buffer.concat(stderr));
  }
  const durationMs = performance.now() - started;
  if (failure || status !== 0) throw new Error(failure ?? `Benchmark child exited ${status}; see ${relative(root, logBase)}.stderr`);
  return { status, durationMs, stdout: Buffer.concat(stdout).toString('utf8') };
}
async function assertCleanup(directory) {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000, statement_timeout: 10000 });
  try {
    const result = await pool.query('SELECT (SELECT count(*) FROM teamboard_test_runs)::int AS namespaces,(SELECT count(*) FROM workspaces WHERE test_namespace IS NOT NULL)::int AS tenants,(SELECT count(*) FROM users WHERE test_namespace IS NOT NULL)::int AS accounts');
    await writeFile(resolve(directory, 'cleanup.json'), JSON.stringify(result.rows[0], null, 2));
    if (Object.values(result.rows[0]).some(value => value !== 0)) throw new Error('Controlled benchmark leaked owned database resources.');
  } finally { await pool.end(); }
}
async function execute(plan, condition, repetition, phase) {
  const directory = resolve(output, condition.id, `r${repetition}`, phase);
  await mkdir(directory, { recursive: true });
  const manifest = { ...plan.manifest, runId: randomUUID() };
  const manifestPath = resolve(directory, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  const measured = await command([cli, 'run', '--suite', 'release', '--config', 'forgeqa.benchmark.config.ts', '--playwright-config', 'playwright.benchmark.config.ts', '--workers', String(condition.workers), '--shard', '1/1', '--manifest', manifestPath, '--output', `forgeqa-benchmark-results/${condition.id}`, '--json'], app, resolve(directory, 'run'));
  const summary = JSON.parse(measured.stdout);
  const runDir = await realpath(resolve(summary.runDir));
  const ownedRoot = await realpath(resolve(app, 'forgeqa-benchmark-results', condition.id));
  const owned = relative(ownedRoot, runDir);
  if (!owned || owned === '..' || owned.startsWith('../') || isAbsolute(owned)) throw new Error('Benchmark report escaped its owned root.');
  const finalPath = resolve(runDir, 'attempts.ndjson.final.json');
  const report = JSON.parse(await readFile(finalPath, 'utf8'));
  const identities = validateCleanInventory(manifest.expected, report, manifest.runId, await readFile(resolve(runDir, 'attempts.ndjson')));
  const merged = await command([cli, 'report', 'merge', '--manifest', manifestPath, '--output', resolve(directory, 'merged'), finalPath, '--json'], root, resolve(directory, 'merge'));
  await assertCleanup(directory);
  const lifecycle = readExecutionTiming(resolve(runDir, 'timing'), { sourceSha, runId: manifest.runId, shardIndex: 1, shardTotal: 1 }, measured.durationMs);
  if (lifecycle.attempts !== identities.length) throw new Error('Profiler lost or duplicated actual attempts.');
  const receipt = { status: 'PASS', runId: manifest.runId, identities, runMs: measured.durationMs, mergeMs: merged.durationMs, criticalPathMs: measured.durationMs + merged.durationMs, mergeStatus: merged.status, lifecycle };
  await writeFile(resolve(directory, 'receipt.json'), JSON.stringify(receipt, null, 2));
  return receipt;
}
try {
  const plans = new Map();
  for (const condition of controlledSchedule(1)) {
    const planned = await command([cli, 'plan', '--suite', 'release', '--config', 'forgeqa.benchmark.config.ts', '--playwright-config', 'playwright.benchmark.config.ts', '--workers', String(condition.workers), '--shard', '1/1', '--output', `forgeqa-benchmark-results/${condition.id}`, '--json'], app, resolve(output, condition.id, 'plan'));
    const plan = JSON.parse(planned.stdout);
    if (plan.workers !== condition.workers || (plan.shardCount ?? plan.shardTotal) !== 1 || !plan.manifest?.expected?.length) throw new Error('Unexpected controlled plan.');
    plans.set(condition.id, plan);
  }
  for (const condition of controlledSchedule(repetitions)) {
    const plan = plans.get(condition.id);
    const warmup = await execute(plan, condition, condition.repetition, 'warmup');
    const measured = await execute(plan, condition, condition.repetition, 'measured');
    records.push({ ...measured, condition: condition.id, workers: condition.workers, repetition: condition.repetition, sourceSha, runnerSession, hardware, protocolDigest: protocol, warmupStatus: warmup.status });
    await writeFile(resolve(output, 'records.json'), JSON.stringify(records, null, 2));
  }
  const summary = summarizeControlled(records, repetitions, { requireTiming: true });
  await writeFile(resolve(output, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  const stages = Object.keys(records[0].lifecycle.stages);
  await writeFile(resolve(output, 'observations.csv'), ['condition,repetition,workers,runMs,mergeMs,criticalPathMs', ...stages, 'observedPhaseUnionMs,unattributedCliMs,attemptWorkMs'].join(',') + '\n' + records.map(r => [r.condition, r.repetition, r.workers, r.runMs, r.mergeMs, r.criticalPathMs, ...stages.map(s => r.lifecycle.stages[s]), r.lifecycle.observedPhaseUnionMs, r.lifecycle.unattributedCliMs, r.lifecycle.attemptWorkMs].join(',')).join('\n') + '\n');
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  await writeFile(resolve(output, 'failure.json'), JSON.stringify({ status: 'FAIL', sourceSha, completedMeasurements: records.length, message: error.message }, null, 2));
  throw error;
}
