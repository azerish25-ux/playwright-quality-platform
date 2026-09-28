import { createWorkflowMatrices } from './lib/conditions.mjs';

const repetitions = process.argv.includes('--release') ? 5 : 1;
const matrices = createWorkflowMatrices(repetitions);
process.stdout.write(`${JSON.stringify({
  schemaVersion: 1,
  kind: 'forgeqa-benchmark-plan-preview',
  repetitions,
  conditions: matrices.conditions.include,
  authoritativeExecution: '.github/workflows/benchmark.yml',
  note: 'The hosted workflow is authoritative because distributed conditions require independent GitHub runners. Use workflow_dispatch with 5 repetitions for release evidence.'
}, null, 2)}\n`);
