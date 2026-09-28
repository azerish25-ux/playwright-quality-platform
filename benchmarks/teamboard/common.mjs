import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {
  BENCHMARK_KIND,
  BENCHMARK_SCHEMA_VERSION,
  BENCHMARK_SEED,
} from '../lib/contract.mjs';
import {
  benchmarkStartedAt,
  environmentSnapshot,
  sourceRevision,
} from '../lib/environment.mjs';
import {
  parseJsonOutput,
  runNode,
  writeJson,
} from '../lib/process.mjs';

export const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
export const teamboardRoot = resolve(repositoryRoot, 'examples/demo-saas');
export const forgeCli = resolve(repositoryRoot, 'packages/cli/dist/cli.js');
const DEFAULT_TIMEOUT_MS = 12 * 60 * 1000;

export function parseArguments(argv) {
  const command = argv[0] ?? '';
  const options = new Map();
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new Error(`Unexpected positional argument: ${token}`);
    const name = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`--${name} requires a value.`);
    if (options.has(name)) throw new Error(`Duplicate option: --${name}`);
    options.set(name, value);
    index += 1;
  }
  return { command, options };
}

export function required(options, name) {
  const value = options.get(name);
  if (!value) throw new Error(`Missing --${name}.`);
  return value;
}

export function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer.`);
  return parsed;
}

export function outputPath(options, condition, repetition, suffix = '') {
  const configured = options.get('output');
  if (configured) return resolve(configured);
  return resolve(repositoryRoot, 'benchmarks/results/raw', condition.id, `repetition-${repetition}`, suffix);
}

export function forgeArguments(command, condition, additional = []) {
  return [
    command,
    '--suite',
    condition.suite,
    '--browsers',
    condition.browsers.join(','),
    '--workers',
    String(condition.workersPerShard),
    '--retries',
    String(condition.retries),
    ...additional,
    '--json',
  ];
}

export function invokeForge(args, label) {
  return parseJsonOutput(
    runNode(forgeCli, args, {
      cwd: teamboardRoot,
      env: {
        ...process.env,
        CI: 'true',
        FORGEQA_BENCHMARK_SEED: BENCHMARK_SEED,
      },
      timeoutMs: DEFAULT_TIMEOUT_MS,
    }),
    label,
  );
}

export function assertSuccessfulRun(summary, label) {
  assert.equal(summary.exitCode, 0, `${label}: ForgeQA exit code was not zero.`);
  assert.equal(summary.runnerExitCode, 0, `${label}: Playwright exit code was not zero.`);
  assert.equal(summary.completion, 'complete', `${label}: execution did not finalize completely.`);
  assert.equal(summary.gate?.outcome, 'pass', `${label}: quality gates did not pass.`);
}

export function baseRecord(condition, repetition, startedAt) {
  return {
    schemaVersion: BENCHMARK_SCHEMA_VERSION,
    kind: BENCHMARK_KIND,
    sourceSha: sourceRevision(),
    application: 'TeamBoard',
    applicationSha: sourceRevision(),
    condition: condition.id,
    conditionLabel: condition.label,
    topology: condition.topology,
    repetition,
    suite: condition.suite,
    browsers: [...condition.browsers],
    shardCount: condition.shardCount,
    workersPerShard: condition.workersPerShard,
    totalConcurrency: condition.totalConcurrency,
    benchmarkSeed: BENCHMARK_SEED,
    warmupRuns: 0,
    retries: condition.retries,
    artifactPolicy: condition.artifactPolicy,
    startedAt,
    environment: environmentSnapshot(),
  };
}

export async function writeFailureRecord(parsed, error, conditionById) {
  const conditionId = parsed.options.get('condition');
  const repetitionValue = parsed.options.get('repetition');
  if (!conditionId || !conditionSafe(conditionId, conditionById) || !repetitionValue) return;
  const condition = conditionById(conditionId);
  const repetition = positiveInteger(repetitionValue, 'repetition');
  const suffix = parsed.command === 'merge'
    ? 'merged'
    : parsed.command === 'plan'
      ? 'plan'
      : parsed.command === 'shard'
        ? `shard-${positiveInteger(parsed.options.get('shard-index') ?? '0', 'shard-index')}`
        : '';
  const output = outputPath(parsed.options, condition, repetition, suffix);
  const now = Date.now();
  await import('node:fs/promises').then(({ mkdir }) => mkdir(output, { recursive: true }));
  await writeJson(resolve(output, 'benchmark-record.json'), {
    ...baseRecord(condition, repetition, benchmarkStartedAt(now)),
    status: 'FAIL',
    completedAt: new Date(now).toISOString(),
    inventory: {},
    observedInventory: null,
    projectMetrics: {},
    durations: {
      planMs: null,
      testMs: null,
      mergeMs: null,
      wholeWorkflowWallMs: null,
      aggregateRunnerMs: null,
    },
    error: {
      name: error instanceof Error ? error.name : 'Error',
      message: error instanceof Error ? error.message : String(error),
    },
    limitations: ['The condition failed before complete comparable evidence was produced.'],
  });
}

function conditionSafe(id, conditionById) {
  try {
    conditionById(id);
    return true;
  } catch {
    return false;
  }
}
