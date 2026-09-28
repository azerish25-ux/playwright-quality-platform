import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { benchmarkCsvHeader, benchmarkCsvRow, summarizeBenchmarkRecords } from './lib/records.mjs';

const args = parseArgs(process.argv.slice(2));
const input = resolve(required(args, 'input'));
const output = resolve(required(args, 'output'));
const repetitions = required(args, 'repetitions');
await mkdir(output, { recursive: true });

const recordPaths = (await findRecordFiles(input)).sort();
const records = [];
const ingestionFailures = [];
for (const path of recordPaths) {
  try {
    records.push(JSON.parse(await readFile(path, 'utf8')));
  } catch (error) {
    ingestionFailures.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
if (!recordPaths.length) ingestionFailures.push(`No benchmark records found under ${input}.`);

let summary;
let summaryFailure;
try {
  if (ingestionFailures.length) throw new Error(ingestionFailures.join('\n'));
  summary = summarizeBenchmarkRecords(records, repetitions);
} catch (error) {
  summaryFailure = error instanceof Error ? error.message : String(error);
  summary = failureSummary(records, repetitions, summaryFailure);
}
summary.generatedAt = new Date().toISOString();

await writeFile(resolve(output, 'raw.jsonl'), records.length ? `${records.map(record => JSON.stringify(record)).join('\n')}\n` : '');
const csvRows = [benchmarkCsvHeader()];
for (const record of records) {
  try { csvRows.push(benchmarkCsvRow(record)); }
  catch (error) {
    const failure = error instanceof Error ? error.message : String(error);
    if (!summaryFailure) {
      summaryFailure = failure;
      summary = failureSummary(records, repetitions, failure);
      summary.generatedAt = new Date().toISOString();
    }
  }
}
await writeFile(resolve(output, 'raw.csv'), `${csvRows.map(row => row.map(csvCell).join(',')).join('\n')}\n`);
await writeFile(resolve(output, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
await writeFile(resolve(output, 'summary.md'), renderMarkdown(summary));
const sums = await Promise.all(['raw.jsonl', 'raw.csv', 'summary.json', 'summary.md'].map(async name => `${createHash('sha256').update(await readFile(resolve(output, name))).digest('hex')}  ${name}`));
await writeFile(resolve(output, 'SHA256SUMS'), `${sums.join('\n')}\n`);
process.stdout.write(`${JSON.stringify({ status: summary.status, output, records: records.length, failure: summaryFailure })}\n`);
if (summary.status !== 'PASS') process.exitCode = 1;

function failureSummary(values, repetitionsValue, failure) {
  const sourceShas = [...new Set(values.map(record => record?.sourceSha).filter(value => typeof value === 'string' && value))];
  const parsedRepetitions = Number(repetitionsValue);
  return {
    schemaVersion: 1,
    kind: 'forgeqa-benchmark-summary',
    status: 'FAIL',
    sourceSha: sourceShas.length === 1 ? sourceShas[0] : sourceShas.length ? sourceShas.join(',') : 'unknown',
    repetitions: Number.isSafeInteger(parsedRepetitions) && parsedRepetitions > 0 ? parsedRepetitions : 0,
    warmups: 0,
    generatedAt: new Date().toISOString(),
    recordCount: values.length,
    failure
  };
}
function renderMarkdown(value) {
  const lines = [
    '# ForgeQA benchmark summary',
    '',
    `- Status: **${value.status}**`,
    `- Source SHA: \`${value.sourceSha}\``,
    `- Measured repetitions per condition: ${value.repetitions}`,
    `- Unmeasured warm-up executions per shard per repetition: ${value.warmups ?? 0}`,
    `- Generated: ${value.generatedAt}`
  ];
  if (value.failure) return `${lines.join('\n')}\n\n## Failure\n\n${value.failure}\n`;
  lines.push(`- Equivalent execution inventory: ${value.inventoryCount} executions, \`${value.inventoryDigest}\``);
  if (value.limitations?.length) {
    lines.push('', '## Limitations', '', ...value.limitations.map(item => `- ${item}`));
  }
  lines.push('', '## Comparable conditions', '', '| Condition | Median execution + merge | Range | IQR | MAD | Instrumented runner time | Execution speedup | Efficiency |', '|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const [id, condition] of Object.entries(value.conditions)) {
    lines.push(`| ${condition.label} (\`${id}\`) | ${formatMs(condition.criticalPathMs.median)} | ${formatMs(condition.criticalPathMs.min)}–${formatMs(condition.criticalPathMs.max)} | ${formatMs(condition.criticalPathMs.iqr)} | ${formatMs(condition.criticalPathMs.mad)} | ${formatMs(condition.aggregateRunnerMs.median)} | ${formatRatio(condition.speedup)} | ${formatRatio(condition.parallelEfficiency)} |`);
  }
  lines.push('', 'Queue-inclusive elapsed wall time is retained separately in raw data. Ratios use the measured critical-path execution duration, not shared matrix-barrier waiting. Failed or hardware-incomparable cohorts never receive speedup ratios.', '');
  return `${lines.join('\n')}\n`;
}
function formatMs(value) { return `${Math.round(value)} ms`; }
function formatRatio(value) { return value === null ? 'n/a' : `${value.toFixed(2)}×`; }
function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
async function findRecordFiles(root) {
  const output = [];
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); }
  catch { return output; }
  for (const entry of entries) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) output.push(...await findRecordFiles(path));
    else if (entry.isFile() && /^record(?:-[^/]*)?\.json$/.test(entry.name)) output.push(path);
  }
  return output;
}
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
