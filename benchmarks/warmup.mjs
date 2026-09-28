import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { benchmarkCondition, parseRepetitions } from './lib/conditions.mjs';
import { assertEquivalentExecutionInventory } from './lib/inventory.mjs';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i];
  const value = process.argv[i + 1];
  if (!['--condition', '--repetition', '--shard', '--manifest'].includes(key) || !value || args.has(key)) throw new Error('Invalid warm-up arguments.');
  args.set(key, value);
}
const condition = benchmarkCondition(args.get('--condition'));
const repetition = parseRepetitions(args.get('--repetition'));
const shard = Number(args.get('--shard'));
if (!Number.isInteger(shard) || shard < 1 || shard > condition.shards) throw new Error('Invalid warm-up shard.');
const manifest = JSON.parse(await readFile(resolve(args.get('--manifest')), 'utf8'));
manifest.runId = `${manifest.runId}-warmup`;
const output = resolve('evidence/benchmarks/warmups', condition.id, `r${repetition}`, `s${shard}`);
await mkdir(output, { recursive: true });
const warmupManifest = resolve(output, 'manifest.json');
await writeFile(warmupManifest, JSON.stringify(manifest));
const app = resolve('examples/demo-saas');
const command = [resolve('packages/cli/dist/cli.js'), 'run', '--suite', 'release', '--config', 'forgeqa.benchmark.config.ts', '--playwright-config', 'playwright.benchmark.config.ts', '--workers', String(condition.workers), '--shard', `${shard}/${condition.shards}`, '--manifest', warmupManifest, '--output', `forgeqa-benchmark-results/${condition.id}`, '--json'];
const started = Date.now();
const child = spawnSync(process.execPath, command, { cwd: app, env: process.env, encoding: 'utf8', timeout: 660_000, maxBuffer: 4 * 1024 * 1024 });
await writeFile(resolve(output, 'stdout.json'), child.stdout ?? '');
await writeFile(resolve(output, 'stderr.log'), child.stderr ?? '');
const receipt = { schemaVersion: 1, status: 'FAIL', runId: manifest.runId, condition: condition.id, repetition, shard, durationMs: Date.now() - started };
try {
  if (child.status !== 0 || child.error) throw new Error(`Warm-up failed: exit=${child.status}; ${child.error?.message ?? ''}`);
  const summary = JSON.parse(child.stdout);
  const runDir = resolve(summary.runDir);
  const owned = relative(resolve(app, 'forgeqa-benchmark-results', condition.id), runDir);
  if (!owned || owned.startsWith('..') || isAbsolute(owned)) throw new Error('Warm-up evidence escaped its owned root.');
  const report = JSON.parse(await readFile(resolve(runDir, 'attempts.ndjson.final.json'), 'utf8'));
  const journal = await readFile(resolve(runDir, 'attempts.ndjson'));
  if (report.runId !== manifest.runId || report.completion !== 'complete' || report.journalSha256 !== createHash('sha256').update(journal).digest('hex')) throw new Error('Warm-up journal integrity failure.');
  const expected = manifest.expected.filter(entry => entry.shardIndex === shard);
  receipt.inventory = assertEquivalentExecutionInventory(expected, report.attempts);
  if (report.attempts.length !== expected.length || report.attempts.some(entry => entry.retry !== 0 || entry.outcome !== 'passed')) throw new Error('Warm-up did not pass cleanly.');
  // Move only the validated run, never mix its journal with measured-shard merge input.
  await rename(runDir, resolve(output, 'run'));
  receipt.status = 'PASS';
} catch (error) {
  receipt.failure = error.message;
  process.exitCode = 1;
} finally {
  await writeFile(resolve(output, 'warmup.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify(receipt));
}
