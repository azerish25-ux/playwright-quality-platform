import { BENCHMARK_CONDITIONS, parseRepetitions } from './conditions.mjs';
import { summarizeSeries, ratio } from './statistics.mjs';

const durationFields = ['planMs', 'setupWallMs', 'setupAggregateMs', 'testWallMs', 'testAggregateMs', 'mergeMs', 'wallMs', 'aggregateRunnerMs'];

function requiredString(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Benchmark record ${name} must be a non-empty string.`);
  return value;
}

function nonNegative(value, name) {
  if (!Number.isFinite(value) || value < 0) throw new Error(`Benchmark record ${name} must be a non-negative number.`);
  return value;
}

export function validateBenchmarkRecord(record) {
  if (!record || typeof record !== 'object') throw new Error('Benchmark record must be an object.');
  if (record.schemaVersion !== 1 || record.kind !== 'forgeqa-benchmark-run') throw new Error('Unsupported benchmark record schema.');
  requiredString(record.sourceSha, 'sourceSha');
  requiredString(record.condition, 'condition');
  if (!BENCHMARK_CONDITIONS.some(condition => condition.id === record.condition)) throw new Error(`Unknown benchmark condition: ${record.condition}`);
  if (!Number.isSafeInteger(record.repetition) || record.repetition < 1 || record.repetition > 5) throw new Error('Benchmark repetition must be between 1 and 5.');
  if (!['PASS', 'FAIL'].includes(record.status)) throw new Error('Benchmark status must be PASS or FAIL.');
  if (!Number.isSafeInteger(record.warmups) || record.warmups < 0) throw new Error('Benchmark warmups must be a non-negative integer.');
  if (!record.inventory || typeof record.inventory !== 'object') throw new Error('Benchmark record inventory is required.');
  requiredString(record.inventory.expectedDigest, 'inventory.expectedDigest');
  requiredString(record.inventory.observedDigest, 'inventory.observedDigest');
  if (!Number.isSafeInteger(record.inventory.count) || record.inventory.count < 1) throw new Error('Benchmark inventory count must be positive.');
  if (!record.durations || typeof record.durations !== 'object') throw new Error('Benchmark durations are required.');
  for (const field of durationFields) nonNegative(record.durations[field], `durations.${field}`);
  if (!Number.isSafeInteger(record.workers) || record.workers < 1) throw new Error('Benchmark workers must be positive.');
  if (!Number.isSafeInteger(record.shards) || record.shards < 1) throw new Error('Benchmark shards must be positive.');
  return record;
}

export function summarizeBenchmarkRecords(records, repetitionsValue) {
  const repetitions = parseRepetitions(repetitionsValue);
  const validated = records.map(validateBenchmarkRecord);
  const duplicateKeys = new Set();
  for (const record of validated) {
    const key = `${record.condition}:${record.repetition}`;
    if (duplicateKeys.has(key)) throw new Error(`Duplicate benchmark record: ${key}`);
    duplicateKeys.add(key);
  }
  const expectedKeys = BENCHMARK_CONDITIONS.flatMap(condition => Array.from({ length: repetitions }, (_, index) => `${condition.id}:${index + 1}`));
  const missing = expectedKeys.filter(key => !duplicateKeys.has(key));
  if (missing.length) throw new Error(`Missing benchmark records: ${missing.join(', ')}`);
  const extra = validated.filter(record => record.repetition > repetitions).map(record => `${record.condition}:${record.repetition}`);
  if (extra.length) throw new Error(`Unexpected benchmark records: ${extra.join(', ')}`);
  const sourceShas = [...new Set(validated.map(record => record.sourceSha))];
  if (sourceShas.length !== 1) throw new Error('Benchmark records do not share one exact source SHA.');
  const expectedDigests = [...new Set(validated.map(record => record.inventory.expectedDigest))];
  const observedDigests = [...new Set(validated.map(record => record.inventory.observedDigest))];
  if (expectedDigests.length !== 1 || observedDigests.length !== 1 || expectedDigests[0] !== observedDigests[0]) {
    throw new Error('Benchmark conditions did not execute an identical inventory.');
  }
  const warmupCounts = [...new Set(validated.map(record => record.warmups))];
  if (warmupCounts.length !== 1) throw new Error('Benchmark records do not share one warm-up policy.');
  const failed = validated.filter(record => record.status !== 'PASS');
  const byCondition = {};
  for (const condition of BENCHMARK_CONDITIONS) {
    const conditionRecords = validated.filter(record => record.condition === condition.id).sort((left, right) => left.repetition - right.repetition);
    byCondition[condition.id] = {
      label: condition.label,
      workers: condition.workers,
      shards: condition.shards,
      topology: condition.topology,
      samples: conditionRecords.length,
      wallMs: summarizeSeries(conditionRecords.map(record => record.durations.wallMs)),
      testWallMs: summarizeSeries(conditionRecords.map(record => record.durations.testWallMs)),
      aggregateRunnerMs: summarizeSeries(conditionRecords.map(record => record.durations.aggregateRunnerMs)),
      mergeMs: summarizeSeries(conditionRecords.map(record => record.durations.mergeMs))
    };
  }
  const baseline = byCondition['serial-1x1'].wallMs.median;
  for (const condition of BENCHMARK_CONDITIONS) {
    const summary = byCondition[condition.id];
    summary.speedup = ratio(baseline, summary.wallMs.median);
    summary.parallelEfficiency = ratio(summary.speedup, condition.workers * condition.shards);
  }
  return {
    schemaVersion: 1,
    kind: 'forgeqa-benchmark-summary',
    status: failed.length ? 'FAIL' : 'PASS',
    sourceSha: sourceShas[0],
    repetitions,
    inventoryDigest: expectedDigests[0],
    inventoryCount: validated[0].inventory.count,
    warmups: warmupCounts[0],
    limitations: [
      ...(repetitions < 5 ? [`Only ${repetitions} measured repetition${repetitions === 1 ? '' : 's'} per condition; run five repetitions for release evidence.`] : []),
      ...(warmupCounts[0] === 0 ? ['No unmeasured warm-up execution is currently performed; cache state remains disabled and this limitation must accompany any result.'] : [])
    ],
    failed: failed.map(record => ({ condition: record.condition, repetition: record.repetition, failures: record.failures ?? [] })),
    conditions: byCondition
  };
}

export function benchmarkCsvHeader() {
  return ['sourceSha', 'condition', 'repetition', 'status', 'warmups', 'workers', 'shards', 'inventoryDigest', ...durationFields];
}

export function benchmarkCsvRow(record) {
  validateBenchmarkRecord(record);
  return [record.sourceSha, record.condition, record.repetition, record.status, record.warmups, record.workers, record.shards, record.inventory.expectedDigest, ...durationFields.map(field => record.durations[field])];
}
