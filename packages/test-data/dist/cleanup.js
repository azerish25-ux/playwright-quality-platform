import { ConfigurationError } from '@azerish25-ux/forgeqa-core';
export class CleanupRegistry {
    namespace;
    #entries = [];
    #closed = false;
    constructor(namespace) { this.namespace = namespace; }
    register(entry) { if (this.#closed)
        throw new ConfigurationError('Cleanup registry already closed.'); if (entry.ownerNamespace !== this.namespace)
        throw new ConfigurationError('Cannot register cleanup owned by another namespace.'); if (this.#entries.some((item) => item.id === entry.id))
        throw new ConfigurationError(`Duplicate cleanup id: ${entry.id}`); this.#entries.push(entry); }
    async run() { if (this.#closed)
        return { attempted: 0, succeeded: 0, failures: [] }; this.#closed = true; const failures = []; let succeeded = 0; for (const entry of [...this.#entries].reverse()) {
        try {
            await entry.cleanup();
            succeeded += 1;
        }
        catch (error) {
            failures.push({ id: entry.id, message: error instanceof Error ? error.message : String(error) });
        }
    } return { attempted: this.#entries.length, succeeded, failures }; }
}
//# sourceMappingURL=cleanup.js.map