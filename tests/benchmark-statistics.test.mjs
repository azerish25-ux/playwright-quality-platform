import assert from 'node:assert/strict';
import test from 'node:test';
import { median, medianAbsoluteDeviation, quantile, ratio, summarizeSeries } from '../benchmarks/lib/statistics.mjs';

test('benchmark statistics use deterministic interpolated quantiles', () => {
  assert.equal(median([9, 1, 5, 3]), 4);
  assert.equal(quantile([1, 2, 3, 4, 5], 0.25), 2);
  assert.equal(quantile([1, 2, 3, 4], 0.75), 3.25);
  assert.equal(medianAbsoluteDeviation([1, 1, 2, 2, 4, 6, 9]), 1);
  assert.deepEqual(summarizeSeries([4, 1, 3, 2]), {
    samples: 4,
    min: 1,
    max: 4,
    median: 2.5,
    q1: 1.75,
    q3: 3.25,
    iqr: 1.5,
    mad: 1
  });
});

test('benchmark ratios remain explicit when a denominator is unusable', () => {
  assert.equal(ratio(10, 2), 5);
  assert.equal(ratio(10, 0), null);
  assert.equal(ratio(Number.NaN, 2), null);
});

test('benchmark statistics reject empty or invalid observations', () => {
  assert.throws(() => median([]), /at least one observation/);
  assert.throws(() => summarizeSeries([1, -1]), /invalid observation/);
  assert.throws(() => quantile([1], 2), /between 0 and 1/);
});
