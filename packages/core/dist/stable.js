import { createHash } from 'node:crypto';
function normalize(value, seen) {
    if (value === null || typeof value !== 'object') {
        if (typeof value === 'number' && !Number.isFinite(value))
            return String(value);
        if (typeof value === 'bigint')
            return value.toString();
        if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'undefined')
            return undefined;
        return value;
    }
    if (seen.has(value))
        throw new TypeError('Cannot stable-stringify a cyclic structure.');
    seen.add(value);
    try {
        if (Array.isArray(value))
            return value.map((entry) => normalize(entry, seen));
        const output = {};
        for (const key of Object.keys(value).sort()) {
            const normalized = normalize(value[key], seen);
            if (normalized !== undefined)
                output[key] = normalized;
        }
        return output;
    }
    finally {
        seen.delete(value);
    }
}
export function stableStringify(value) { return JSON.stringify(normalize(value, new Set())); }
export function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
export function stableHash(value) { return sha256(stableStringify(value)); }
//# sourceMappingURL=stable.js.map