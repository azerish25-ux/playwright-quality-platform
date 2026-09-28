#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  CONDITIONS,
  assertEquivalentInventory,
  conditionById,
  expectedRecordKeys,
  validateBenchmarkRecord,
} from './lib/contract.mjs';
import { findFiles, readJson, resetDirectory, writeJson } from './lib/process.mjs';
import { roundMetrics, summarizeValues } from './lib/statistics.mjs';

function parseArguments(argv) {
  const options = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`Unexpected positional argument: ${token}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${token} requires a value.`);
    options.set(token.slice(2), value);
    index += 1;
  }
  return options;
}

function required(options, name) {
  const value = options.get(name);
  if (!value) throw new Error(`Missing --${name}.`);
  return value;
}

function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer.`);
  return parsed;
}

function metric(records, name) {
  const values = records
    .map((record) => Number(record.durations?.[name]))
    .filter(Number.isFinite);
  return values.length ? roundMetrics(summarizeValues(values)) : null;
}

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function toCsv(rows, columns) {
  return `${columns.map(csvCell).join(',')}\n${rows.map((row) => columns.map((column) => csvCell(row[column])).join(',')).join('\n')}\n`;
}

function markdownTable(rows) {
  const header = '| Condition | Samples | Median wall | Median test | Median aggregate runner | Speedup | Efficiency |';
  const divider = '|---|---:|---:|---:|---:|---:|---:|';
  const body = rows.map((row) => `| ${row.conditionLabel} | ${row.samples} | ${row.wallMedianMs ?? 'n/a'} ms | ${row.testMedianMs ?? 'n/a'} ms | ${row.aggregateRunnerMedianMs ?? 'n/a'} ms | ${row.speedup ?? 'n/a'}× | ${row.parallelEfficiency ?? 'n/a'} |`);
  return [header, divider, ...body].join('\n');
}

const options = parseArguments(process.argv.slice(2));
const input = resolve(required(options, 'input'));
const output = resolve(required(options, 'output'));
const expectedRepetitions = positiveInteger(options.get('expected-repetitions') ?? '5', 'expected repetitions');
await resetDirectory(output);

const paths = await findFiles(input, 'benchmark-record.json');
assert.ok(paths.length > 0, 'No benchmark records were found.');
const records = await Promise.all(paths.map(readJson));
records.forEach(validateBenchmarkRecord);

const duplicateGuard = new Set();
for (const record of records) {
  const key = `${record.condition}#${record.repetition}`;
  assert.ok(!duplicateGuard.has(key), `Duplicate benchmark record: ${key}`);
  duplicateGuard.add(key);
}
const expectedKeys = expectedRecordKeys(expectedRepetitions).sort();
assert.deepEqual([...duplicateGuard].sort(), expectedKeys, 'Benchmark result set is incomplete or contains unexpected condition/repetition records.');

const passing = records.filter((record) => record.status === 'PASS');
assert.equal(passing.length, records.length, 'At least one benchmark condition failed.');
const sourceShas = [...new Set(passing.map((record) => record.sourceSha))];
assert.equal(sourceShas.length, 1, 'Benchmark records were produced from different source revisions.');
const baseline = passing.find((record) => record.condition === 'serial-1x1');
assert.ok(baseline, 'Serial benchmark baseline is missing.');
for (const record of passing) {
  assertEquivalentInventory(baseline.inventory, record.inventory, `${record.condition} repetition ${record.repetition}`);
  assertEquivalentInventory(record.inventory, record.observedInventory, `${record.condition} observed inventory`);
  assert.equal(record.suite, baseline.suite, 'Benchmark suites differ.');
  assert.deepEqual(record.browsers, baseline.browsers, 'Benchmark browser selections differ.');
  assert.equal(record.retries, baseline.retries, 'Benchmark retry policies differ.');
  assert.deepEqual(record.artifactPolicy, baseline.artifactPolicy, 'Benchmark artifact policies differ.');
  assert.equal(record.benchmarkSeed, baseline.benchmarkSeed, 'Benchmark deterministic-data seeds differ.');
}

const conditionSummaries = [];
for (const condition of Object.values(CONDITIONS)) {
  const conditionRecords = passing
    .filter((record) => record.condition === condition.id)
    .sort((a, b) => a.repetition - b.repetition);
  assert.equal(conditionRecords.length, expectedRepetitions, `${condition.id} has the wrong sample count.`);
  conditionSummaries.push({
    condition: condition.id,
    conditionLabel: condition.label,
    topology: condition.topology,
    shardCount: condition.shardCount,
    workersPerShard: condition.workersPerShard,
    totalConcurrency: condition.totalConcurrency,
    samples: conditionRecords.length,
    wholeWorkflowWallMs: metric(conditionRecords, 'wholeWorkflowWallMs'),
    testMs: metric(conditionRecords, 'testMs'),
    mergeMs: metric(conditionRecords, 'mergeMs'),
    aggregateRunnerMs: metric(conditionRecords, 'aggregateRunnerMs'),
    summedAttemptDurationMs: metric(conditionRecords, 'summedAttemptDurationMs'),
    speedup: null,
    parallelEfficiency: null,
  });
}
const baselineMedian = conditionSummaries.find((entry) => entry.condition === 'serial-1x1')?.wholeWorkflowWallMs?.median;
assert.ok(Number.isFinite(baselineMedian), 'Serial wall-time median is missing.');
for (const entry of conditionSummaries) {
  const currentMedian = entry.wholeWorkflowWallMs?.median;
  entry.speedup = Number.isFinite(currentMedian) ? Math.round((baselineMedian / currentMedian) * 100) / 100 : null;
  entry.parallelEfficiency = entry.speedup === null ? null : Math.round((entry.speedup / entry.totalConcurrency) * 1000) / 1000;
}

const limitations = [
  'GitHub-hosted hardware is shared and can vary between jobs. Compare only records with compatible runner metadata, source revisions, Node/Playwright versions and inventory digests.',
  'Aggregate runner time is reported separately from elapsed wall time; lower latency is not represented as free compute.',
  'The fixed benchmark inventory is 8 API and 4 Chromium UI executions with zero retries and one immutable artifact policy.',
];
if (expectedRepetitions < 5) limitations.push(`Only ${expectedRepetitions} measured repetition(s) were requested; Phase 11 release evidence requires five.`);

const summary = {
  schemaVersion: 1,
  kind: 'forgeqa-teamboard-benchmark-summary',
  generatedAt: new Date().toISOString(),
  sourceSha: sourceShas[0],
  application: 'TeamBoard',
  expectedRepetitions,
  status: 'PASS',
  inventory: baseline.inventory,
  conditions: conditionSummaries,
  failures: [],
  limitations,
};
const rawRows = records
  .sort((a, b) => a.condition.localeCompare(b.condition) || a.repetition - b.repetition)
  .map((record) => ({
    sourceSha: record.sourceSha,
    condition: record.condition,
    repetition: record.repetition,
    topology: record.topology,
    shardCount: record.shardCount,
    workersPerShard: record.workersPerShard,
    totalConcurrency: record.totalConcurrency,
    status: record.status,
    executionDigest: record.inventory.executionDigest,
    logicalDigest: record.inventory.logicalDigest,
    coverageDigest: record.inventory.coverageDigest,
    wholeWorkflowWallMs: record.durations?.wholeWorkflowWallMs ?? null,
    testMs: record.durations?.testMs ?? null,
    mergeMs: record.durations?.mergeMs ?? null,
    aggregateRunnerMs: record.durations?.aggregateRunnerMs ?? null,
    summedAttemptDurationMs: record.durations?.summedAttemptDurationMs ?? null,
    runnerImage: record.environment?.runnerImage ?? null,
    cpuCount: record.environment?.cpuCount ?? null,
    totalMemoryBytes: record.environment?.totalMemoryBytes ?? null,
    nodeVersion: record.environment?.nodeVersion ?? null,
    playwrightVersion: record.environment?.playwrightVersion ?? null,
  }));
const summaryRows = conditionSummaries.map((entry) => ({
  condition: entry.condition,
  topology: entry.topology,
  samples: entry.samples,
  shardCount: entry.shardCount,
  workersPerShard: entry.workersPerShard,
  totalConcurrency: entry.totalConcurrency,
  wallMedianMs: entry.wholeWorkflowWallMs?.median ?? null,
  wallMinMs: entry.wholeWorkflowWallMs?.min ?? null,
  wallMaxMs: entry.wholeWorkflowWallMs?.max ?? null,
  wallIqrMs: entry.wholeWorkflowWallMs?.iqr ?? null,
  wallMadMs: entry.wholeWorkflowWallMs?.mad ?? null,
  testMedianMs: entry.testMs?.median ?? null,
  aggregateRunnerMedianMs: entry.aggregateRunnerMs?.median ?? null,
  speedup: entry.speedup,
  parallelEfficiency: entry.parallelEfficiency,
}));
const markdownRows = conditionSummaries.map((entry) => ({
  conditionLabel: entry.conditionLabel,
  samples: entry.samples,
  wallMedianMs: entry.wholeWorkflowWallMs?.median ?? null,
  testMedianMs: entry.testMs?.median ?? null,
  aggregateRunnerMedianMs: entry.aggregateRunnerMs?.median ?? null,
  speedup: entry.speedup,
  parallelEfficiency: entry.parallelEfficiency,
}));
const markdown = `# ForgeQA TeamBoard benchmark\n\n**Status:** ${summary.status}\n\n- Source revision: \`${summary.sourceSha}\`\n- Measured repetitions per condition: ${expectedRepetitions}\n- Inventory executions: ${summary.inventory.executionCount}\n- Inventory digest: \`${summary.inventory.executionDigest}\`\n\n${markdownTable(markdownRows)}\n\n## Interpretation boundaries\n\n${limitations.map((item) => `- ${item}`).join('\n')}\n`;

await writeJson(resolve(output, 'summary.json'), summary);
await writeFile(resolve(output, 'raw.ndjson'), `${records.map((record) => JSON.stringify(record)).join('\n')}\n`);
await writeFile(resolve(output, 'raw.csv'), toCsv(rawRows, Object.keys(rawRows[0])));
await writeFile(resolve(output, 'summary.csv'), toCsv(summaryRows, Object.keys(summaryRows[0])));
await writeFile(resolve(output, 'summary.md'), markdown);
process.stdout.write(`${JSON.stringify(summary)}\n`);
