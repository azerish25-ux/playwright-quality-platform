import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { benchmarkCondition, parseRepetitions } from './lib/conditions.mjs';
import { expectedInventoryDigest, projectInventory } from './lib/inventory.mjs';

const args = parseArgs(process.argv.slice(2));
const condition = benchmarkCondition(required(args, 'condition'));
const repetitions = parseRepetitions(required(args, 'repetitions'));
const planPath = resolve(required(args, 'plan'));
const output = resolve(required(args, 'output'));
const plan = JSON.parse(await readFile(planPath, 'utf8'));
if (!plan.manifest || plan.manifest.schemaVersion !== 1 || !Array.isArray(plan.manifest.expected) || !plan.manifest.expected.length) {
  throw new Error('ForgeQA plan output does not contain a valid non-empty manifest.');
}
if ((plan.shardCount ?? plan.shardTotal) !== condition.shards) throw new Error('Plan shard count does not match the benchmark condition.');
if (plan.workers !== condition.workers) throw new Error('Plan worker count does not match the benchmark condition.');
await mkdir(output, { recursive: true });
const manifests = [];
for (let repetition = 1; repetition <= repetitions; repetition += 1) {
  const manifest = { ...plan.manifest, runId: randomUUID() };
  const path = resolve(output, `manifest-r${repetition}.json`);
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
  manifests.push({ repetition, runId: manifest.runId, file: `manifest-r${repetition}.json` });
}
const metadata = {
  schemaVersion: 1,
  kind: 'forgeqa-benchmark-plan',
  condition: condition.id,
  label: condition.label,
  workers: condition.workers,
  shards: condition.shards,
  topology: condition.topology,
  sourceSha: process.env.FORGEQA_SOURCE_SHA ?? 'local',
  createdAt: new Date().toISOString(),
  planMs: Number(args.get('plan-duration-ms') ?? 0),
  inventoryCount: plan.manifest.expected.length,
  inventoryDigest: expectedInventoryDigest(plan.manifest.expected),
  projects: projectInventory(plan.manifest.expected),
  manifests
};
await writeFile(resolve(output, 'plan-metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`);

function parseArgs(tokens) {
  const values = new Map();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith('--')) throw new Error(`Unknown positional argument: ${token}`);
    const name = token.slice(2);
    const value = tokens[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`--${name} requires a value.`);
    values.set(name, value);
    index += 1;
  }
  return values;
}
function required(values, name) {
  const value = values.get(name);
  if (!value) throw new Error(`Missing --${name}.`);
  return value;
}
