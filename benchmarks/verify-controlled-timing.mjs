import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { summarizeControlled } from './lib/controlled.mjs';
import { checkedProfile } from './lib/profiling.mjs';
const root = resolve('evidence/benchmarks/controlled');
const read = async path => JSON.parse(await readFile(resolve(root, path), 'utf8'));
const records = await read('records.json');
const summary = await read('summary.json');
assert.equal(summary.sourceSha, process.env.FORGEQA_SOURCE_SHA);
assert.deepEqual(summarizeControlled(records, summary.repetitions, { requireTiming: true }), summary);
let cleanups = 0;
for (const record of records) {
  for (const phase of ['warmup', 'measured']) {
    const prefix = `${record.condition}/r${record.repetition}/${phase}`;
    const receipt = await read(`${prefix}/receipt.json`);
    assert.equal(receipt.status, 'PASS');
    checkedProfile(receipt.lifecycle, { sourceSha: record.sourceSha, runId: receipt.runId, shardIndex: 1, shardTotal: 1 }, receipt.runMs);
    assert.deepEqual(receipt.identities, record.identities);
    if (phase === 'measured') {
      for (const key of Object.keys(receipt)) assert.deepEqual(receipt[key], record[key]);
    }
    const cleanup = await read(`${prefix}/cleanup.json`);
    assert.deepEqual(Object.keys(cleanup).sort(), ['accounts','namespaces','tenants']);
    assert(Object.values(cleanup).every(value => value === 0));
    cleanups++;
  }
}
const receipt = { schemaVersion: 1, status: 'PASS', sourceSha: summary.sourceSha, records: records.length, measuredExecutions: summary.measuredExecutions, cleanups, summaryRecomputed: true, fullBenchmarkAcceptance: false };
await writeFile(resolve(root, 'timing-verification.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt));
