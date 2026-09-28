function finiteSeries(values, name = 'series') {
  if (!Array.isArray(values) || values.length === 0) throw new Error(`${name} must contain at least one observation.`);
  const normalized = values.map(Number);
  if (normalized.some(value => !Number.isFinite(value) || value < 0)) throw new Error(`${name} contains an invalid observation.`);
  return normalized.sort((left, right) => left - right);
}

export function quantile(values, probability) {
  const sorted = finiteSeries(values);
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) throw new Error('Quantile probability must be between 0 and 1.');
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
  const sorted = finiteSeries(values);
  const center = median(sorted);
  return median(sorted.map(value => Math.abs(value - center)));
}

export function summarizeSeries(values) {
  const sorted = finiteSeries(values);
  return {
    samples: sorted.length,
    min: sorted[0],
    max: sorted.at(-1),
    median: median(sorted),
    q1: quantile(sorted, 0.25),
    q3: quantile(sorted, 0.75),
    iqr: quantile(sorted, 0.75) - quantile(sorted, 0.25),
    mad: medianAbsoluteDeviation(sorted)
  };
}

export function ratio(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return numerator / denominator;
}
