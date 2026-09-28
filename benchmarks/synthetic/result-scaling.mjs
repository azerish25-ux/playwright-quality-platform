import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import { parseRepetitions } from '../lib/conditions.mjs';
import { summarizeSeries } from '../lib/statistics.mjs';

const { values } = parseArgs({ options: { repetitions: { type: 'string', default: '1' }, size: { type: 'string' } } });
if (values.size) {
  const size = Number(values.size);
  if (![1000, 10000, 100000].includes(size)) throw new Error('Scaling size must be 1000, 10000 or 100000.');
  const { mergeShardResults, toJsonReport, toJUnit, toHtmlReport } = await import('@azerish25-ux/forgeqa-reporter');
  const started = performance.now();
  const base = { schemaVersion: 1, runId: 'synthetic-scaling', selectionHash: 'synthetic-inventory', configHash: 'synthetic-policy', revision: { repository: 'synthetic', testedCommit: process.env.FORGEQA_SOURCE_SHA ?? 'local' } };
  const expected = Array.from({ length: size }, (_, i) => ({ executionId: `synthetic-${i}`, logicalTestId: `logical-${i}`, project: 'synthetic', environment: 'synthetic', shardIndex: i % 4 + 1, shardTotal: 4 }));
  const shards = Array.from({ length: 4 }, (_, i) => ({ ...base, completion: 'complete', shardIndex: i + 1, shardTotal: 4, shardId: `synthetic-shard-${i}`, finalizedAt: '2026-01-01T00:00:00Z', journalSha256: 'synthetic-in-memory-not-file-evidence', attempts: [] }));
  for (const [i, entry] of expected.entries()) shards[i % 4].attempts.push({ ...entry, schemaVersion: 1, attemptId: `synthetic-attempt-${i}`, retry: 0, outcome: 'passed', startedAt: '2026-01-01T00:00:00Z', durationMs: 1, title: `Synthetic case ${i}` });
  const preparationMs = performance.now() - started;
  const mergeStart = performance.now();
  const run = mergeShardResults(shards, { ...base, expected });
  const mergeMs = performance.now() - mergeStart;
  if (run.completion !== 'complete' || run.attempts.length !== size) throw new Error('Scaling merge lost inventory.');
  const formats = {};
  for (const [name, render] of Object.entries({ json: toJsonReport, junit: toJUnit, html: toHtmlReport })) {
    const start = performance.now();
    const text = render(run);
    formats[name] = { durationMs: performance.now() - start, bytes: Buffer.byteLength(text), sha256: createHash('sha256').update(text).digest('hex') };
  }
  console.log(JSON.stringify({ size, preparationMs, mergeMs, formats, peakRssBytes: process.resourceUsage().maxRSS * 1024, synthetic: true }));
} else {
  const repetitions = parseRepetitions(values.repetitions);
  const output = resolve('evidence/benchmarks/supplementary/result-scaling');
  await mkdir(output, { recursive: true });
  const raw = [];
  const summary = { schemaVersion: 1, kind: 'forgeqa-synthetic-result-scaling', synthetic: true, status: 'FAIL', repetitions, sourceSha: process.env.FORGEQA_SOURCE_SHA, node: process.version, limitations: ['Synthetic in-memory canonical results; not application or journal filesystem throughput.', 'Peak RSS is the high-water mark of a fresh Linux child process, including input construction and all renderers.'] };
  try {
    for (let repetition = 1; repetition <= repetitions; repetition += 1) {
      for (const size of repetition % 2 ? [1000, 10000, 100000] : [100000, 10000, 1000]) {
        const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--size', String(size)], { encoding: 'utf8', timeout: 120_000, maxBuffer: 1024 * 1024 });
        if (child.error || child.status !== 0) throw new Error(`Scaling child failed: ${child.stderr}`);
        raw.push({ repetition, ...JSON.parse(child.stdout) });
        await writeFile(resolve(output, 'raw.jsonl'), `${raw.map(value => JSON.stringify(value)).join('\n')}\n`);
      }
    }
    summary.sizes = Object.fromEntries([1000, 10000, 100000].map(size => {
      const samples = raw.filter(value => value.size === size);
      return [size, { mergeMs: summarizeSeries(samples.map(value => value.mergeMs)), peakRssBytes: summarizeSeries(samples.map(value => value.peakRssBytes)), formats: Object.fromEntries(['json', 'junit', 'html'].map(name => [name, summarizeSeries(samples.map(value => value.formats[name].durationMs))])) }];
    }));
    summary.status = 'PASS';
  } catch (error) {
    summary.failure = error.message;
    process.exitCode = 1;
  } finally {
    await writeFile(resolve(output, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
    console.log(JSON.stringify(summary));
  }
}
