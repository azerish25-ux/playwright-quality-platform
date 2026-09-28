import assert from 'node:assert/strict';

function finiteValues(values) {
  assert.ok(Array.isArray(values), 'Values must be an array.');
  const output = values.map(Number);
  assert.ok(output.length > 0, 'At least one value is required.');
  assert.ok(output.every(Number.isFinite), 'Statistics require finite numbers.');
  return output.sort((a, b) => a - b);
}

export function quantile(values, probability) {
  const sorted = finiteValues(values);
  assert.ok(probability >= 0 && probability <= 1, 'Quantile probability must be between zero and one.');
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

export function median(values) {
  return quantile(values, 0.5);
}

export function medianAbsoluteDeviation(values) {
  const center = median(values);
  return median(values.map((value) => Math.abs(Number(value) - center)));
}

export function summarizeValues(values) {
  const sorted = finiteValues(values);
  const p25 = quantile(sorted, 0.25);
  const p75 = quantile(sorted, 0.75);
  return {
    samples: sorted.length,
    min: sorted[0],
    median: median(sorted),
    max: sorted[sorted.length - 1],
    p25,
    p75,
    iqr: p75 - p25,
    mad: medianAbsoluteDeviation(sorted),
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
  };
}

export function roundMetrics(value, digits = 2) {
  if (typeof value === 'number') {
    const scale = 10 ** digits;
    return Math.round(value * scale) / scale;
  }
  if (Array.isArray(value)) return value.map((entry) => roundMetrics(entry, digits));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, roundMetrics(entry, digits)]));
  }
  return value;
}
