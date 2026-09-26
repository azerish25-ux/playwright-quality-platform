import { createHash } from 'node:crypto';
function normalize(value: unknown, seen: Set<object>): unknown {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) return String(value);
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'undefined') return undefined;
    return value;
  }
  if (seen.has(value)) throw new TypeError('Cannot stable-stringify a cyclic structure.');
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((entry) => normalize(entry, seen));
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const normalized = normalize((value as Record<string, unknown>)[key], seen);
      if (normalized !== undefined) output[key] = normalized;
    }
    return output;
  } finally { seen.delete(value); }
}
export function stableStringify(value: unknown): string { return JSON.stringify(normalize(value, new Set())); }
export function sha256(value: string | Uint8Array): string { return createHash('sha256').update(value).digest('hex'); }
export function stableHash(value: unknown): string { return sha256(stableStringify(value)); }
