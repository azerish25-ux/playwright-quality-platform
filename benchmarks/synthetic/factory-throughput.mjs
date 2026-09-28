import { performance } from 'node:perf_hooks';
import { writeFile, mkdir } from 'node:fs/promises';
import { cpus, totalmem } from 'node:os';
import { defineDataFactory } from '@azerish25-ux/forgeqa-test-data';

const factory = defineDataFactory('benchmark-user', context => ({ id: context.integer(1, 1_000_000) }));
const conditions = [1, 2, 4];
const raw = [];
for (const workers of conditions) {
  for (let repetition = 1; repetition <= 5; repetition += 1) {
    const started = performance.now();
    for (let index = 0; index < 100_000; index += 1) {
      factory.build({ seed: 'benchmark', logicalTestId: `t-${index % 100}`, namespace: `w-${index % workers}`, sequence: index });
    }
    raw.push({ workers, repetition, durationMs: performance.now() - started, inventory: 100_000 });
  }
}
await mkdir('benchmarks/results/synthetic', { recursive: true });
const result = {
  schemaVersion: 1,
  kind: 'forgeqa-synthetic-factory-throughput',
  generatedAt: new Date().toISOString(),
  node: process.version,
  platform: process.platform,
  cpuCount: cpus().length,
  totalMemory: totalmem(),
  note: 'Synthetic deterministic-factory throughput benchmark. This is not customer-suite or browser-execution evidence.',
  raw
};
await writeFile('benchmarks/results/synthetic/factory-throughput.json', `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
