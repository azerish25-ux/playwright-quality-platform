import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const BENCHMARK_SCHEMA_VERSION = 1;
export const BENCHMARK_KIND = 'forgeqa-teamboard-benchmark-record';
export const BENCHMARK_SEED = 'teamboard-phase11-v1';

const definitions = [
  {
    id: 'serial-1x1',
    label: 'Serial baseline',
    topology: 'single-runner',
    shardCount: 1,
    workersPerShard: 1,
    distributed: false,
  },
  {
    id: 'local-1x2',
    label: 'Local parallel — 2 workers',
    topology: 'single-runner',
    shardCount: 1,
    workersPerShard: 2,
    distributed: false,
  },
  {
    id: 'local-1x4',
    label: 'Local parallel — 4 workers',
    topology: 'single-runner',
    shardCount: 1,
    workersPerShard: 4,
    distributed: false,
  },
  {
    id: 'distributed-2x1',
    label: 'Distributed — 2 runners × 1 worker',
    topology: 'multi-runner',
    shardCount: 2,
    workersPerShard: 1,
    distributed: true,
  },
  {
    id: 'distributed-4x1',
    label: 'Distributed — 4 runners × 1 worker',
    topology: 'multi-runner',
    shardCount: 4,
    workersPerShard: 1,
    distributed: true,
  },
];

export const CONDITIONS = Object.freeze(
  Object.fromEntries(
    definitions.map((condition) => [
      condition.id,
      Object.freeze({
        ...condition,
        totalConcurrency: condition.shardCount * condition.workersPerShard,
        suite: 'release',
        browsers: Object.freeze(['chromium']),
        retries: 0,
        artifactPolicy: Object.freeze({ trace: 'retain-on-failure', screenshot: 'only-on-failure', video: 'retain-on-failure' }),
      }),
    ]),
  ),
);

export function conditionById(id) {
  const condition = CONDITIONS[id];
  if (!condition) {
    throw new Error(`Unknown benchmark condition: ${id}`);
  }
  return condition;
}

export function stableDigest(value) {
  const serialized = JSON.stringify(value);
  return createHash('sha256').update(serialized).digest('hex');
}

function nonEmptyString(value, label) {
  assert.equal(typeof value, 'string', `${label} must be a string.`);
  assert.ok(value.length > 0, `${label} must not be empty.`);
  return value;
}

export function inventoryFromEntries(entries) {
  assert.ok(Array.isArray(entries), 'Inventory entries must be an array.');
  assert.ok(entries.length > 0, 'Benchmark inventory must not be empty.');

  const normalized = entries.map((entry, index) => {
    assert.ok(entry && typeof entry === 'object', `Inventory entry ${index} must be an object.`);
    const executionId = nonEmptyString(entry.executionId, `Inventory entry ${index} executionId`);
    const logicalTestId = nonEmptyString(entry.logicalTestId, `Inventory entry ${index} logicalTestId`);
    const project = nonEmptyString(entry.project, `Inventory entry ${index} project`);
    const environment = nonEmptyString(entry.environment, `Inventory entry ${index} environment`);
    return { executionId, logicalTestId, project, environment };
  });

  const executionIds = [...new Set(normalized.map((entry) => entry.executionId))].sort();
  assert.equal(executionIds.length, normalized.length, 'Benchmark inventory contains duplicate execution identities.');

  const logicalIds = [...new Set(normalized.map((entry) => entry.logicalTestId))].sort();
  const coverageKeys = [
    ...new Set(normalized.map((entry) => `${entry.logicalTestId}\u0000${entry.project}\u0000${entry.environment}`)),
  ].sort();

  const projects = {};
  for (const entry of normalized) {
    projects[entry.project] = (projects[entry.project] ?? 0) + 1;
  }

  return {
    executionCount: executionIds.length,
    logicalCount: logicalIds.length,
    coverageCount: coverageKeys.length,
    executionDigest: stableDigest(executionIds),
    logicalDigest: stableDigest(logicalIds),
    coverageDigest: stableDigest(coverageKeys),
    projects: Object.fromEntries(Object.entries(projects).sort(([a], [b]) => a.localeCompare(b))),
  };
}


export function assertTeamBoardInventory(inventory, context = 'TeamBoard benchmark') {
  assert.equal(inventory.executionCount, 12, `${context}: expected exactly 12 executions (8 API and 4 Chromium UI).`);
  assert.equal(inventory.logicalCount, 12, `${context}: expected exactly 12 logical tests.`);
  assert.deepEqual(inventory.projects, { api: 8, chromium: 4 }, `${context}: fixed project inventory changed.`);
  return inventory;
}

export function inventoryFromManifest(manifest) {
  assert.ok(manifest && typeof manifest === 'object', 'Manifest must be an object.');
  assert.equal(manifest.schemaVersion, 1, 'Unsupported selection manifest schema.');
  return inventoryFromEntries(manifest.expected);
}

export function inventoryFromAttempts(attempts) {
  const originals = attempts.filter((attempt) => Number(attempt.retry ?? 0) === 0);
  return inventoryFromEntries(originals);
}

export function assertEquivalentInventory(reference, observed, context = 'benchmark') {
  assert.equal(observed.executionCount, reference.executionCount, `${context}: execution count differs.`);
  assert.equal(observed.logicalCount, reference.logicalCount, `${context}: logical test count differs.`);
  assert.equal(observed.coverageCount, reference.coverageCount, `${context}: project/environment coverage differs.`);
  assert.equal(observed.executionDigest, reference.executionDigest, `${context}: execution identities differ.`);
  assert.equal(observed.logicalDigest, reference.logicalDigest, `${context}: logical test identities differ.`);
  assert.equal(observed.coverageDigest, reference.coverageDigest, `${context}: coverage identities differ.`);
  assert.deepEqual(observed.projects, reference.projects, `${context}: project inventory differs.`);
}

export function projectMetrics(attempts) {
  const output = new Map();
  for (const attempt of attempts.filter((entry) => Number(entry.retry ?? 0) === 0)) {
    const project = nonEmptyString(attempt.project, 'Attempt project');
    const current = output.get(project) ?? { executions: 0, summedAttemptDurationMs: 0 };
    current.executions += 1;
    current.summedAttemptDurationMs += Number(attempt.durationMs ?? 0);
    output.set(project, current);
  }
  return Object.fromEntries([...output.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

export function validateBenchmarkRecord(record) {
  assert.ok(record && typeof record === 'object', 'Benchmark record must be an object.');
  assert.equal(record.schemaVersion, BENCHMARK_SCHEMA_VERSION, 'Unsupported benchmark record schema.');
  assert.equal(record.kind, BENCHMARK_KIND, 'Unexpected benchmark record kind.');
  const condition = conditionById(record.condition);
  assert.equal(record.topology, condition.topology, 'Benchmark topology contradicts its condition.');
  assert.equal(record.shardCount, condition.shardCount, 'Benchmark shard count contradicts its condition.');
  assert.equal(record.workersPerShard, condition.workersPerShard, 'Benchmark worker count contradicts its condition.');
  assert.equal(record.totalConcurrency, condition.totalConcurrency, 'Benchmark concurrency contradicts its condition.');
  assert.equal(record.suite, condition.suite, 'Benchmark suite contradicts its condition.');
  assert.deepEqual(record.browsers, [...condition.browsers], 'Benchmark browsers contradict their condition.');
  assert.equal(record.retries, condition.retries, 'Benchmark retries contradict their condition.');
  assert.deepEqual(record.artifactPolicy, condition.artifactPolicy, 'Benchmark artifact policy contradicts its condition.');
  assert.equal(record.benchmarkSeed, BENCHMARK_SEED, 'Benchmark seed contradicts the fixed contract.');
  assert.equal(record.warmupRuns, 0, 'Benchmark warm-up count contradicts the cold-cache contract.');
  assert.ok(Number.isInteger(record.repetition) && record.repetition >= 1, 'Benchmark repetition must be a positive integer.');
  assert.ok(['PASS', 'FAIL'].includes(record.status), 'Benchmark status must be PASS or FAIL.');
  nonEmptyString(record.sourceSha, 'Benchmark sourceSha');
  nonEmptyString(record.startedAt, 'Benchmark startedAt');
  nonEmptyString(record.completedAt, 'Benchmark completedAt');
  assert.ok(record.inventory && typeof record.inventory === 'object', 'Benchmark inventory is required.');
  assert.ok(record.durations && typeof record.durations === 'object', 'Benchmark durations are required.');
  return record;
}

export function expectedRecordKeys(repetitions) {
  assert.ok(Number.isInteger(repetitions) && repetitions >= 1, 'Expected repetitions must be a positive integer.');
  const keys = [];
  for (const condition of definitions) {
    for (let repetition = 1; repetition <= repetitions; repetition += 1) {
      keys.push(`${condition.id}#${repetition}`);
    }
  }
  return keys;
}
