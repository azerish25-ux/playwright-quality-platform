import { createHash } from 'node:crypto';

export const LOCAL_CONDITIONS = Object.freeze([
  Object.freeze({ id: 'serial-1x1', workers: 1 }),
  Object.freeze({ id: 'local-2x1', workers: 2 }),
  Object.freeze({ id: 'local-4x1', workers: 4 })
]);

export function controlledSchedule(repetitions) {
  if (!Number.isSafeInteger(repetitions) || repetitions < 1 || repetitions > 5) {
    throw new Error('Repetitions must be an integer between 1 and 5.');
  }
  return Array.from({ length: repetitions }, (_, index) => {
    const offset = index % LOCAL_CONDITIONS.length;
    return [...LOCAL_CONDITIONS.slice(offset), ...LOCAL_CONDITIONS.slice(0, offset)]
      .map(condition => ({ ...condition, repetition: index + 1 }));
  }).flat();
}

export function validateCleanInventory(expected, report, runId, journal) {
  if (!Array.isArray(expected) || expected.length === 0 || !expected.every(e => typeof e.executionId === 'string' && e.executionId)) {
    throw new Error('Expected execution inventory is missing or malformed.');
  }
  const ids = expected.map(e => e.executionId).sort();
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate expected execution.');
  if (report?.runId !== runId || report.completion !== 'complete' || !Array.isArray(report.attempts)) {
    throw new Error('Incomplete or wrong-run report.');
  }
  if (report.journalSha256 !== createHash('sha256').update(journal).digest('hex')) {
    throw new Error('Journal checksum mismatch.');
  }
  const actual = report.attempts.map(e => e.executionId).sort();
  if (JSON.stringify(actual) !== JSON.stringify(ids)) throw new Error('Execution inventory mismatch or duplicate attempt.');
  if (report.attempts.some(e => e.retry !== 0 || e.outcome !== 'passed')) throw new Error('Every measured execution must pass on its first attempt.');
  return ids;
}

export function distribution(values) {
  if (!Array.isArray(values) || values.length === 0 || values.some(v => !Number.isFinite(v) || v < 0)) {
    throw new Error('Measurements must be finite non-negative numbers.');
  }
  const sorted = [...values].sort((a, b) => a - b);
  const median = data => data.length % 2 ? data[(data.length - 1) / 2] : (data[data.length / 2 - 1] + data[data.length / 2]) / 2;
  const center = median(sorted);
  return { samples: sorted.length, median: center, min: sorted[0], max: sorted.at(-1), mad: median(sorted.map(v => Math.abs(v - center)).sort((a, b) => a - b)) };
}

export function summarizeControlled(records, repetitions) {
  const schedule = controlledSchedule(repetitions);
  if (!Array.isArray(records) || records.length !== schedule.length) throw new Error('Missing or extra controlled measurements.');
  const seen = new Set();
  let reference;
  for (const entry of records) {
    const condition = LOCAL_CONDITIONS.find(c => c.id === entry.condition);
    const key = `${entry.condition}/${entry.repetition}`;
    if (!condition || condition.workers !== entry.workers || !Number.isInteger(entry.repetition) || entry.repetition < 1 || entry.repetition > repetitions || seen.has(key)) {
      throw new Error('Unknown, duplicate or incompatible condition/repetition.');
    }
    seen.add(key);
    if (entry.status !== 'PASS' || entry.warmupStatus !== 'PASS' || entry.mergeStatus !== 0) throw new Error('Required execution, warm-up or merge did not pass.');
    if (!/^[a-f0-9]{40}$/.test(entry.sourceSha ?? '') || !/^[a-f0-9]{64}$/.test(entry.protocolDigest ?? '') || typeof entry.runnerSession !== 'string' || !entry.runnerSession) {
      throw new Error('Missing source, protocol or runner-session provenance.');
    }
    if (!entry.hardware || !entry.hardware.cpuModel || !Number.isInteger(entry.hardware.cpuCount) || entry.hardware.cpuCount < 1 || !Number.isSafeInteger(entry.hardware.totalMemoryBytes) || entry.hardware.totalMemoryBytes < 1) {
      throw new Error('Missing hardware fingerprint.');
    }
    if (!Array.isArray(entry.identities) || entry.identities.length === 0 || !entry.identities.every(id => typeof id === 'string' && id) || new Set(entry.identities).size !== entry.identities.length) throw new Error('Missing or duplicated inventory.');
    const comparable = JSON.stringify({ sourceSha: entry.sourceSha, protocolDigest: entry.protocolDigest, runnerSession: entry.runnerSession, hardware: { cpuModel: entry.hardware.cpuModel, cpuCount: entry.hardware.cpuCount, totalMemoryBytes: entry.hardware.totalMemoryBytes }, identities: [...entry.identities].sort() });
    reference ??= comparable;
    if (reference !== comparable) throw new Error('Source, protocol, runner, hardware or execution inventory differs.');
    for (const key of ['runMs', 'mergeMs', 'criticalPathMs']) if (!Number.isFinite(entry[key]) || entry[key] < 0) throw new Error(`Invalid ${key}.`);
    if (Math.abs(entry.criticalPathMs - entry.runMs - entry.mergeMs) > 0.001) throw new Error('Critical-path duration is inconsistent.');
  }
  const conditions = LOCAL_CONDITIONS.map(c => ({ ...c, ...distribution(records.filter(e => e.condition === c.id).map(e => e.criticalPathMs)) }));
  const baseline = conditions[0].median;
  return {
    schemaVersion: 1, kind: 'forgeqa-controlled-local-benchmark', status: 'PASS',
    sourceSha: records[0].sourceSha, runnerSession: records[0].runnerSession,
    protocolDigest: records[0].protocolDigest, hardware: records[0].hardware,
    scope: 'same-runner-local-worker-comparison', repetitions,
    inventoryCount: records[0].identities.length, measuredExecutions: records.length * records[0].identities.length,
    performanceStatus: 'COMPARABLE_LOCAL', localComparisonAccepted: repetitions >= 5,
    fullBenchmarkAcceptance: false,
    conditions: conditions.map(c => ({ ...c, speedup: repetitions >= 5 && baseline > 0 && c.median > 0 ? baseline / c.median : null })),
    limitations: [
      'Only serial versus local workers is compared; these measurements cannot establish distributed speedup.',
      'Shared hosted hardware may still have noisy neighbours. Five samples are not a statistical guarantee.',
      'Critical path includes the CLI run and explicit report merge, not installation, queueing or billed runner time.',
      'Readiness, in-process reporting and shutdown remain inside runMs; granular lifecycle acceptance remains incomplete.',
      'Source workspace packages are used, not a published npm release.'
    ]
  };
}
