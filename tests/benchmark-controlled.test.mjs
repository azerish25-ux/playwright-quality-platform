import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { controlledSchedule, distribution, summarizeControlled, validateCleanInventory } from '../benchmarks/lib/controlled.mjs';

function records(repetitions = 5) {
  return controlledSchedule(repetitions).map(c => ({
    condition: c.id, workers: c.workers, repetition: c.repetition, status: 'PASS', warmupStatus: 'PASS', mergeStatus: 0,
    sourceSha: 'a'.repeat(40), protocolDigest: 'b'.repeat(64), runnerSession: 'one-runner-one-process',
    hardware: { cpuModel: 'test-cpu', cpuCount: 4, totalMemoryBytes: 1000 }, identities: ['api-a', 'ui-b'],
    runMs: 10 / c.workers, mergeMs: 2, criticalPathMs: 10 / c.workers + 2
  }));
}

test('rotates conditions inside each repetition without omitting worker counts', () => {
  const schedule = controlledSchedule(5);
  assert.equal(schedule.length, 15);
  assert.deepEqual(schedule.slice(0, 3).map(e => e.workers), [1, 2, 4]);
  assert.deepEqual(schedule.slice(3, 6).map(e => e.workers), [2, 4, 1]);
  for (const value of [0, 6, 1.5, NaN, '5']) assert.throws(() => controlledSchedule(value));
});

test('measures median, range and median absolute deviation without mutating input', () => {
  const input = [7, 1, 3, 5];
  assert.deepEqual(distribution(input), { samples: 4, median: 4, min: 1, max: 7, mad: 2 });
  assert.deepEqual(input, [7, 1, 3, 5]);
  for (const value of [[], [NaN], [Infinity], [-1]]) assert.throws(() => distribution(value));
});

test('five repetitions support only the explicitly scoped local comparison', () => {
  const result = summarizeControlled(records(), 5);
  assert.equal(result.localComparisonAccepted, true);
  assert.equal(result.fullBenchmarkAcceptance, false);
  assert.equal(result.measuredExecutions, 30);
  assert.equal(result.conditions[0].speedup, 1);
  assert.equal(result.conditions[2].speedup, 12 / 4.5);
});

test('smoke and zero-duration observations cannot produce speedup claims', () => {
  assert.ok(summarizeControlled(records(1), 1).conditions.every(c => c.speedup === null));
  const zero = records().map(r => ({ ...r, runMs: 0, mergeMs: 0, criticalPathMs: 0 }));
  assert.ok(summarizeControlled(zero, 5).conditions.every(c => c.speedup === null));
});

test('missing, duplicate, failed, changed-machine and changed-software evidence fails closed', () => {
  const mutations = [
    r => r.pop(), r => { r[1] = { ...r[0] }; },
    r => { r[0].status = 'FAIL'; }, r => { r[0].warmupStatus = 'FAIL'; }, r => { r[0].mergeStatus = 3; },
    r => { r[0].runnerSession = 'another-machine'; }, r => { r[0].hardware.cpuModel = 'different'; },
    r => { r[0].sourceSha = 'c'.repeat(40); }, r => { r[0].protocolDigest = 'd'.repeat(64); },
    r => { r[0].identities = ['different', 'ui-b']; }, r => { r[0].identities.push('api-a'); },
    r => { r[0].runMs = -1; }, r => { r[0].criticalPathMs += 1; }, r => { r[0].workers = 99; },
    r => { r[0].sourceSha = 'local'; }, r => { r[0].hardware = {}; }
  ];
  for (const mutate of mutations) {
    const input = records(); mutate(input);
    assert.throws(() => summarizeControlled(input, 5));
  }
});

test('inventory validation rejects retries, wrong run, corruption, missing and duplicate execution', () => {
  const journal = Buffer.from('real-test-fixture-journal');
  const expected = [{ executionId: 'api-a' }, { executionId: 'ui-b' }];
  const report = () => ({ runId: 'owned-run', completion: 'complete', journalSha256: createHash('sha256').update(journal).digest('hex'), attempts: expected.map(e => ({ ...e, retry: 0, outcome: 'passed' })) });
  assert.deepEqual(validateCleanInventory(expected, report(), 'owned-run', journal), ['api-a', 'ui-b']);
  for (const mutate of [r => { r.runId = 'other'; }, r => { r.completion = 'incomplete'; }, r => { r.journalSha256 = '0'.repeat(64); }, r => { r.attempts[0].retry = 1; }, r => { r.attempts[0].outcome = 'failed'; }, r => r.attempts.pop(), r => r.attempts.push(r.attempts[0])]) {
    const candidate = report(); mutate(candidate);
    assert.throws(() => validateCleanInventory(expected, candidate, 'owned-run', journal));
  }
  assert.throws(() => validateCleanInventory([], report(), 'owned-run', journal));
  assert.throws(() => validateCleanInventory([expected[0], expected[0]], report(), 'owned-run', journal));
});
