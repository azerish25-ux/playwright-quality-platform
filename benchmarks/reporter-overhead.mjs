import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import { parseRepetitions } from './lib/conditions.mjs';
import { nativeInventory } from './lib/native-inventory.mjs';
import { summarizeSeries } from './lib/statistics.mjs';

const { values } = parseArgs({ options: { repetitions: { type: 'string', default: '1' } } });
const repetitions = parseRepetitions(values.repetitions);
const output = resolve('evidence/benchmarks/supplementary/reporter-overhead');
await mkdir(output, { recursive: true });
const raw = [];
const summary = {
  schemaVersion: 1, kind: 'forgeqa-reporter-overhead', status: 'FAIL', sourceSha: process.env.FORGEQA_SOURCE_SHA,
  repetitions, warmups: 1, node: process.version,
  limitations: ['Same TeamBoard fixtures, browser matrix and JSON/blob reporters in both modes; only Deadpan reporter inclusion differs.', 'This measures whole native process latency, not a pure isolated callback CPU cost.', ...(repetitions < 5 ? ['Smoke sample only; five repetitions required for release evidence.'] : [])]
};
try {
  let expectedDigest;
  for (let repetition = 0; repetition <= repetitions; repetition += 1) {
    const modes = repetition % 2 === 0 ? ['native', 'forgeqa'] : ['forgeqa', 'native'];
    for (const mode of modes) {
      const directory = resolve(output, repetition === 0 ? 'warmup' : `r${repetition}`, mode);
      await mkdir(directory, { recursive: true });
      const runId = `overhead-${randomUUID()}`;
      const env = { ...process.env };
      for (const key of Object.keys(env)) if (/^(GITHUB_TOKEN|GH_TOKEN|NODE_AUTH_TOKEN|NPM_TOKEN|ACTIONS_|FORGEQA_RUN_|FORGEQA_CONFIG)/.test(key)) delete env[key];
      Object.assign(env, { FORGEQA_RUN_ID: runId, FORGEQA_HISTORY_PROVENANCE: 'diagnostic', PLAYWRIGHT_JSON_OUTPUT_FILE: resolve(directory, 'native.json'), PLAYWRIGHT_BLOB_OUTPUT_DIR: resolve(directory, 'blob') });
      const reporter = mode === 'native' ? 'json,blob' : 'json,blob,@azerish25-ux/forgeqa-playwright/reporter';
      const started = performance.now();
      const child = spawnSync(process.execPath, [resolve('node_modules/@playwright/test/cli.js'), 'test', '--config', 'playwright.benchmark.config.ts', '--workers', '1', '--retries', '0', '--reporter', reporter], { cwd: resolve('examples/demo-saas'), env, encoding: 'utf8', timeout: 240_000, maxBuffer: 4 * 1024 * 1024 });
      const wallMs = performance.now() - started;
      await writeFile(resolve(directory, 'stdout.log'), child.stdout ?? '');
      await writeFile(resolve(directory, 'stderr.log'), child.stderr ?? '');
      if (child.error || child.status !== 0) throw new Error(`${mode} r${repetition} failed with exit ${child.status}. See retained diagnostics.`);
      const native = JSON.parse(await readFile(resolve(directory, 'native.json'), 'utf8'));
      const inventory = nativeInventory(native);
      if (inventory.count !== 20) throw new Error('Reporter benchmark must execute all 20 TeamBoard cases.');
      if (expectedDigest && inventory.digest !== expectedDigest) throw new Error('Native reporter benchmark identities diverged.');
      expectedDigest = inventory.digest;
      if (!Number.isFinite(native.stats?.duration) || native.stats.duration < 0) throw new Error('Native duration is absent.');
      if (mode === 'forgeqa') {
        const run = resolve('examples/demo-saas/forgeqa-benchmark-results', runId);
        const report = JSON.parse(await readFile(resolve(run, 'report.json'), 'utf8'));
        if (report.completion !== 'complete' || report.gate?.outcome !== 'pass' || report.attempts?.length !== 20) throw new Error('Deadpan reporter acceptance failed.');
        await rename(run, resolve(directory, 'forgeqa'));
      }
      raw.push({ repetition, warmup: repetition === 0, mode, wallMs, nativeDurationMs: native.stats.duration, inventoryDigest: inventory.digest, count: inventory.count });
      await writeFile(resolve(output, 'raw.jsonl'), `${raw.map(value => JSON.stringify(value)).join('\n')}\n`);
    }
  }
  summary.inventoryDigest = expectedDigest;
  summary.native = summarizeSeries(raw.filter(value => !value.warmup && value.mode === 'native').map(value => value.wallMs));
  summary.forgeqa = summarizeSeries(raw.filter(value => !value.warmup && value.mode === 'forgeqa').map(value => value.wallMs));
  summary.medianOverheadMs = summary.forgeqa.median - summary.native.median;
  summary.medianOverheadPercent = summary.native.median > 0 ? 100 * summary.medianOverheadMs / summary.native.median : null;
  summary.status = 'PASS';
} catch (error) {
  summary.failure = error.message;
  process.exitCode = 1;
} finally {
  await writeFile(resolve(output, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary));
}
