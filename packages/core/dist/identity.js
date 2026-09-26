import { ConfigurationError } from './errors.js';
import { sha256, stableStringify } from './stable.js';
function segment(value) { return value.trim().replace(/\\/g, '/').replace(/\s+/g, ' '); }
export function logicalTestIdentity(input) {
    if (input.explicitId) {
        const id = segment(input.explicitId);
        if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{2,159}$/.test(id))
            throw new ConfigurationError(`Invalid explicit test id: ${id}`);
        return id;
    }
    const path = segment(input.relativePath).replace(/^\.\//, '');
    const titles = input.titlePath.map(segment).filter(Boolean);
    if (!path || !titles.length)
        throw new ConfigurationError('A logical test identity requires a relative path and title hierarchy.');
    return `auto:${sha256(stableStringify({ path, titles })).slice(0, 24)}`;
}
export function executionIdentity(input) {
    return `exec:${sha256(stableStringify(input)).slice(0, 32)}`;
}
export function attemptIdentity(executionId, retry) { return `attempt:${sha256(`${executionId}:${retry}`).slice(0, 32)}`; }
export function runIdentity(input) {
    return `run:${sha256(stableStringify(input)).slice(0, 32)}`;
}
export function shardIdentity(input) {
    if (!Number.isInteger(input.index) || !Number.isInteger(input.total) || input.index < 1 || input.index > input.total) {
        throw new ConfigurationError(`Invalid shard ${input.index}/${input.total}.`);
    }
    return `shard:${sha256(stableStringify(input)).slice(0, 32)}`;
}
//# sourceMappingURL=identity.js.map