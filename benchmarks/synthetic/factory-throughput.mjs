import { performance } from 'node:perf_hooks';
import { mkdir, writeFile } from 'node:fs/promises';
import { cpus, totalmem } from 'node:os';
import { resolve } from 'node:path';
import { defineDataFactory } from '@azerish25-ux/forgeqa-test-data';
import { summarizeValues, roundMetrics } from '../lib/statistics.mjs';

const factory = defineDataFactory('benchmark-user', (context) => ({ id: context.integer(1, 1_000_000) }));
const conditions = [1, 2, 4];
const raw = [];
for (const workers of conditions) {
  for (let repetition = 1; repetition <= 5; repetition += 1) {
    const started = performance.now();
    for (let index = 0; index < 100_000; index += 1) {
      factory.build({
        seed: 'forgeqa-synthetic-factory-v1',
        logicalTestId: `test-${index % 100}`,
        namespace: `worker-${index % workers}`,
        sequence: index,
      });
    }
    raw.push({ workers, repetition, durationMs: performance.now() - started, inventory: 100_000 });
  }
}

const summary = Object.fromEntries(
  conditions.map((workers) => [
    workers,
    roundMetrics(summarizeValues(raw.filter((entry) => entry.workers === workers).map((entry) => entry.durationMs))),
  ]),
);
const result = {
  schemaVersion: 1,
  kind: 'forgeqa-synthetic-factory-throughput',
  generatedAt: new Date().toISOString(),
  node: process.version,
  platform: process.platform,
  cpuCount: cpus().length,
  totalMemoryBytes: totalmem(),
  note: 'Synthetic deterministic-factory throughput benchmark. It is not customer test execution and is not used to claim distributed speedup.',
  raw,
  summary,
};
const output = resolve(process.env.BENCHMARK_OUTPUT ?? 'benchmarks/results/synthetic/factory-throughput');
await mkdir(output, { recursive: true });
await writeFile(resolve(output, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
await writeFile(
  resolve(output, 'raw.csv'),
  `workers,repetition,durationMs,inventory\n${raw.map((entry) => `${entry.workers},${entry.repetition},${entry.durationMs},${entry.inventory}`).join('\n')}\n`,
);
process.stdout.write(`${JSON.stringify(result)}\n`);
