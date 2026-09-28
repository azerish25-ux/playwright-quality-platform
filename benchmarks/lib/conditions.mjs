export const BENCHMARK_CONDITIONS = Object.freeze([
  Object.freeze({ id: 'serial-1x1', label: 'Serial baseline', workers: 1, shards: 1, topology: 'single-runner' }),
  Object.freeze({ id: 'local-2x1', label: 'Local parallel — 2 workers', workers: 2, shards: 1, topology: 'single-runner' }),
  Object.freeze({ id: 'local-4x1', label: 'Local parallel — 4 workers', workers: 4, shards: 1, topology: 'single-runner' }),
  Object.freeze({ id: 'distributed-2x1', label: 'Distributed — 2 shards × 1 worker', workers: 1, shards: 2, topology: 'github-multi-runner' }),
  Object.freeze({ id: 'distributed-4x1', label: 'Distributed — 4 shards × 1 worker', workers: 1, shards: 4, topology: 'github-multi-runner' })
]);

export function parseRepetitions(value) {
  const repetitions = Number(value);
  if (!Number.isSafeInteger(repetitions) || repetitions < 1 || repetitions > 5) {
    throw new Error('Benchmark repetitions must be an integer between 1 and 5.');
  }
  return repetitions;
}

export function benchmarkCondition(id) {
  const condition = BENCHMARK_CONDITIONS.find(entry => entry.id === id);
  if (!condition) throw new Error(`Unknown benchmark condition: ${id}`);
  return condition;
}

export function createWorkflowMatrices(repetitionsValue) {
  const repetitions = parseRepetitions(repetitionsValue);
  const conditions = BENCHMARK_CONDITIONS.map(({ id, label, workers, shards, topology }) => ({
    condition: id,
    label,
    workers,
    shards,
    topology
  }));
  const shards = [];
  const merges = [];
  // Interleave repetitions and rotate condition order deterministically.
  for (let repetition = 1; repetition <= repetitions; repetition += 1) {
    const offset = (repetition - 1) % conditions.length;
    for (const condition of [...conditions.slice(offset), ...conditions.slice(0, offset)]) {
      merges.push({ ...condition, repetition });
      for (let shard = 1; shard <= condition.shards; shard += 1) {
        shards.push({ ...condition, repetition, shard });
      }
    }
  }
  return {
    repetitions,
    conditions: { include: conditions },
    shards: { include: shards },
    merges: { include: merges }
  };
}
