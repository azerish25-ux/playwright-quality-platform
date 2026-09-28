import { performance } from 'node:perf_hooks';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  toHtmlReport,
  toJsonReport,
  toJUnit,
  toMarkdownSummary,
} from '@azerish25-ux/forgeqa-reporter';
import { roundMetrics, summarizeValues } from '../lib/statistics.mjs';

function attempt(index) {
  return {
    schemaVersion: 1,
    attemptId: `attempt-${index}`,
    executionId: `execution-${index}`,
    logicalTestId: `logical-${index}`,
    retry: 0,
    outcome: 'passed',
    startedAt: '2026-01-01T00:00:00.000Z',
    durationMs: (index % 50) + 1,
    project: index % 5 === 0 ? 'api' : 'chromium',
    environment: 'synthetic',
    title: `Synthetic result ${index}`,
    artifacts: [],
  };
}

function run(count) {
  const attempts = Array.from({ length: count }, (_, index) => attempt(index));
  return {
    schemaVersion: 1,
    runId: `synthetic-${count}`,
    completion: 'complete',
    selectionHash: `selection-${count}`,
    configHash: 'synthetic-config',
    revision: {
      repository: 'synthetic/reporter-scaling',
      sourceCommit: '0'.repeat(40),
      testedCommit: '0'.repeat(40),
    },
    attempts,
    missingExecutions: [],
    unexpectedExecutions: [],
    duplicateExecutions: [],
    shardIds: ['synthetic-shard'],
    gate: { outcome: 'pass', violations: [] },
  };
}

const sizes = (process.env.BENCHMARK_SCALING_SIZES ?? '1000,10000,100000')
  .split(',')
  .map(Number)
  .filter((value) => Number.isInteger(value) && value > 0);
const repetitions = Number(process.env.BENCHMARK_SCALING_REPETITIONS ?? '3');
if (!sizes.length || !Number.isInteger(repetitions) || repetitions < 1) {
  throw new Error('Invalid reporter scaling configuration.');
}

const raw = [];
for (const count of sizes) {
  const syntheticRun = run(count);
  for (let repetition = 1; repetition <= repetitions; repetition += 1) {
    const baselineStarted = performance.now();
    const baseline = JSON.stringify(syntheticRun.attempts);
    const baselineMs = performance.now() - baselineStarted;

    const rssBefore = process.memoryUsage().rss;
    const forgeStarted = performance.now();
    const json = toJsonReport(syntheticRun);
    const junit = toJUnit(syntheticRun);
    const markdown = toMarkdownSummary(syntheticRun);
    const html = toHtmlReport(syntheticRun);
    const forgeqaMs = performance.now() - forgeStarted;
    const rssAfter = process.memoryUsage().rss;

    raw.push({
      count,
      repetition,
      baselineJsonMs: baselineMs,
      forgeqaOutputMs: forgeqaMs,
      incrementalMs: forgeqaMs - baselineMs,
      rssBeforeBytes: rssBefore,
      rssAfterBytes: rssAfter,
      rssDeltaBytes: Math.max(0, rssAfter - rssBefore),
      outputBytes: {
        baseline: Buffer.byteLength(baseline),
        json: Buffer.byteLength(json),
        junit: Buffer.byteLength(junit),
        markdown: Buffer.byteLength(markdown),
        html: Buffer.byteLength(html),
      },
    });
  }
}

const summary = Object.fromEntries(
  sizes.map((count) => {
    const entries = raw.filter((entry) => entry.count === count);
    return [
      count,
      {
        baselineJsonMs: roundMetrics(summarizeValues(entries.map((entry) => entry.baselineJsonMs))),
        forgeqaOutputMs: roundMetrics(summarizeValues(entries.map((entry) => entry.forgeqaOutputMs))),
        incrementalMs: roundMetrics(summarizeValues(entries.map((entry) => entry.incrementalMs))),
        rssDeltaBytes: roundMetrics(summarizeValues(entries.map((entry) => entry.rssDeltaBytes))),
      },
    ];
  }),
);
const result = {
  schemaVersion: 1,
  kind: 'forgeqa-synthetic-reporter-scaling',
  generatedAt: new Date().toISOString(),
  sizes,
  repetitions,
  note: 'Synthetic large-result rendering benchmark. The baseline measures JSON serialization only; results are not represented as customer-suite latency or as a full native-versus-ForgeQA execution comparison.',
  raw,
  summary,
};
const output = resolve(process.env.BENCHMARK_OUTPUT ?? 'benchmarks/results/synthetic/reporter-scaling');
await mkdir(output, { recursive: true });
await writeFile(resolve(output, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
await writeFile(
  resolve(output, 'raw.csv'),
  `count,repetition,baselineJsonMs,forgeqaOutputMs,incrementalMs,rssDeltaBytes\n${raw.map((entry) => [entry.count, entry.repetition, entry.baselineJsonMs, entry.forgeqaOutputMs, entry.incrementalMs, entry.rssDeltaBytes].join(',')).join('\n')}\n`,
);
process.stdout.write(`${JSON.stringify(result)}\n`);
