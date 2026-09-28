import { createHash } from 'node:crypto';

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function canonicalExpectedInventory(expected) {
  if (!Array.isArray(expected) || expected.length === 0) throw new Error('Benchmark manifest expected inventory must be non-empty.');
  const canonical = expected.map(entry => {
    if (!entry || typeof entry !== 'object' || typeof entry.executionId !== 'string' || !entry.executionId) {
      throw new Error('Benchmark inventory contains an invalid execution identity.');
    }
    return {
      executionId: entry.executionId,
      logicalTestId: String(entry.logicalTestId ?? ''),
      project: String(entry.project ?? ''),
      environment: String(entry.environment ?? ''),
      relativePath: String(entry.relativePath ?? ''),
      line: Number.isSafeInteger(entry.line) ? entry.line : null,
      shardIndex: Number.isSafeInteger(entry.shardIndex) ? entry.shardIndex : null,
      shardTotal: Number.isSafeInteger(entry.shardTotal) ? entry.shardTotal : null
    };
  }).sort((left, right) => left.executionId.localeCompare(right.executionId));
  const identities = canonical.map(entry => entry.executionId);
  if (new Set(identities).size !== identities.length) throw new Error('Benchmark inventory contains duplicate execution identities.');
  return canonical;
}

export function canonicalObservedInventory(attempts) {
  if (!Array.isArray(attempts)) throw new Error('Benchmark report attempts must be an array.');
  const identities = [...new Set(attempts.map(attempt => String(attempt?.executionId ?? '')).filter(Boolean))].sort();
  return identities;
}

export function digestValue(value) {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

export function expectedInventoryDigest(expected) {
  return digestValue(canonicalExpectedInventory(expected).map(entry => entry.executionId));
}

export function observedInventoryDigest(attempts) {
  return digestValue(canonicalObservedInventory(attempts));
}

export function assertEquivalentExecutionInventory(expected, attempts) {
  const expectedIds = canonicalExpectedInventory(expected).map(entry => entry.executionId);
  const observedIds = canonicalObservedInventory(attempts);
  const missing = expectedIds.filter(identity => !observedIds.includes(identity));
  const unexpected = observedIds.filter(identity => !expectedIds.includes(identity));
  if (missing.length || unexpected.length) {
    throw new Error(`Benchmark inventory mismatch: ${missing.length} missing, ${unexpected.length} unexpected execution identities.`);
  }
  return {
    count: expectedIds.length,
    expectedDigest: digestValue(expectedIds),
    observedDigest: digestValue(observedIds),
    identities: expectedIds
  };
}

export function projectInventory(expected) {
  const counts = {};
  for (const entry of canonicalExpectedInventory(expected)) counts[entry.project || 'unknown'] = (counts[entry.project || 'unknown'] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}
