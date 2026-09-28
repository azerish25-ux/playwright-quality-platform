import { appendFile } from 'node:fs/promises';
import { createWorkflowMatrices } from './lib/conditions.mjs';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const token = process.argv[index];
  if (!token.startsWith('--')) throw new Error(`Unknown positional argument: ${token}`);
  const name = token.slice(2);
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`--${name} requires a value.`);
  args.set(name, value);
  index += 1;
}
const matrices = createWorkflowMatrices(args.get('repetitions') ?? process.env.BENCHMARK_REPETITIONS ?? '1');
const output = process.env.GITHUB_OUTPUT;
if (output) {
  await appendFile(output, `repetitions=${matrices.repetitions}\n`);
  await appendFile(output, `conditions=${JSON.stringify(matrices.conditions)}\n`);
  await appendFile(output, `shards=${JSON.stringify(matrices.shards)}\n`);
  await appendFile(output, `merges=${JSON.stringify(matrices.merges)}\n`);
} else {
  process.stdout.write(`${JSON.stringify(matrices, null, 2)}\n`);
}
