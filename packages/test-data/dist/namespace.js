import { createHash } from 'node:crypto';
import { ConfigurationError, stableStringify } from '@azerish25-ux/forgeqa-core';
export function allocateNamespace(input) {
    if (input.shardIndex < 1 || input.parallelIndex < 0 || input.repetition < 0 || (input.attempt ?? 0) < 0)
        throw new ConfigurationError('Namespace dimensions must be non-negative and shard index must start at one.');
    const prefix = input.consumer.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20) || 'consumer';
    const digest = createHash('sha256').update(stableStringify(input)).digest('hex').slice(0, 16);
    return `${prefix}-${digest}`;
}
export function assertOwnedIdentifier(identifier, namespace) {
    if (!identifier.startsWith(`${namespace}-`) && identifier !== namespace)
        throw new ConfigurationError(`Resource ${identifier} is not owned by namespace ${namespace}.`);
}
//# sourceMappingURL=namespace.js.map