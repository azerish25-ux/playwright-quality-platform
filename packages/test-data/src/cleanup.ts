import { ConfigurationError, runBounded } from '@azerish25-ux/forgeqa-core';
export interface CleanupEntry {
  id: string;
  ownerNamespace: string;
  description: string;
  cleanup: (signal: AbortSignal) => Promise<void>;
  timeoutMs?: number;
}
export interface CleanupResult { attempted: number; succeeded: number; failures: Array<{ id: string; message: string }>; }
export class CleanupRegistry {
  readonly namespace: string;
  #entries: CleanupEntry[] = [];
  #closed = false;
  #running: Promise<CleanupResult> | undefined;
  #timeoutMs: number;
  constructor(namespace: string, timeoutMs = 5_000) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) throw new ConfigurationError('Invalid cleanup timeout.');
    this.namespace = namespace;
    this.#timeoutMs = timeoutMs;
  }
  register(entry: CleanupEntry): void {
    if (this.#closed) throw new ConfigurationError('Cleanup registry already closed.');
    if (entry.ownerNamespace !== this.namespace) throw new ConfigurationError('Cannot register cleanup owned by another namespace.');
    if (this.#entries.some(item => item.id === entry.id)) throw new ConfigurationError(`Duplicate cleanup id: ${entry.id}`);
    const timeout = entry.timeoutMs ?? this.#timeoutMs;
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 2_147_483_647) throw new ConfigurationError('Invalid cleanup timeout.');
    this.#entries.push({ ...entry });
  }
  async run(): Promise<CleanupResult> {
    if (this.#running) return this.#running;
    if (this.#closed) return { attempted: 0, succeeded: 0, failures: [] };
    this.#closed = true;
    this.#running = Promise.resolve().then(async () => {
      const failures: Array<{ id: string; message: string }> = [];
      let succeeded = 0;
      for (const entry of [...this.#entries].reverse()) {
        try {
          await runBounded(signal => entry.cleanup(signal), entry.timeoutMs ?? this.#timeoutMs, `Cleanup ${entry.id}`);
          succeeded++;
        } catch (error) { failures.push({ id: entry.id, message: error instanceof Error ? error.message : String(error) }); }
      }
      return { attempted: this.#entries.length, succeeded, failures };
    });
    try { return await this.#running; } finally { this.#running = undefined; }
  }
}
