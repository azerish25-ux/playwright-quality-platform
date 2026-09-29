/** A deadline bounds waiting and requests cancellation; adapters must honor the signal. */
export async function runBounded<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  label = 'Fixture operation',
  parentSignal?: AbortSignal,
): Promise<T> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) {
    throw new RangeError('Fixture timeout must be a positive bounded integer.');
  }
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectAbort: (reason: unknown) => void = () => {};
  const canceled = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const abort = (reason: unknown) => {
    // Reject first: a cooperative adapter's subsequent rejection cannot mask the cause.
    rejectAbort(reason);
    controller.abort(reason);
  };
  const onAbort = () => abort(parentSignal?.reason ?? new Error(`${label} canceled.`));
  if (parentSignal?.aborted) onAbort();
  else parentSignal?.addEventListener('abort', onAbort, { once: true });
  if (!controller.signal.aborted) timer = setTimeout(() => abort(new Error(`${label} timed out after ${timeoutMs}ms.`)), timeoutMs);
  try {
    return await Promise.race([
      canceled,
      Promise.resolve().then(() => { controller.signal.throwIfAborted(); return operation(controller.signal); }),
    ]);
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', onAbort);
  }
}

export interface ResourceCleanup {
  id: string;
  cleanup: (signal: AbortSignal) => Promise<void>;
  timeoutMs?: number;
}

/** Owns only explicitly registered resources. Concurrent close calls share one result. */
export class ResourceScope {
  readonly namespace: string;
  readonly timeoutMs: number;
  #entries: ResourceCleanup[] = [];
  #ids = new Set<string>();
  #closing?: Promise<void>;

  constructor(namespace: string, timeoutMs = 5_000) {
    if (!namespace.trim()) throw new Error('A resource scope requires an ownership namespace.');
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) throw new RangeError('Invalid cleanup timeout.');
    this.namespace = namespace;
    this.timeoutMs = timeoutMs;
  }

  defer(entry: ResourceCleanup): void {
    if (this.#closing) throw new Error('Resource scope is already closing.');
    if (!entry.id.trim() || this.#ids.has(entry.id)) throw new Error('Cleanup IDs must be nonempty and unique within the scope.');
    const timeout = entry.timeoutMs ?? this.timeoutMs;
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 2_147_483_647) throw new RangeError('Invalid cleanup timeout.');
    this.#ids.add(entry.id);
    // Copy the registration so consumers cannot replace a disposer after registration.
    this.#entries.push({ ...entry });
  }

  close(): Promise<void> {
    if (!this.#closing) {
      // Defer execution until the closing promise is assigned; cleanup cannot register more work.
      this.#closing = Promise.resolve().then(async () => {
        const failures: unknown[] = [];
        for (const entry of [...this.#entries].reverse()) {
          try { await runBounded(entry.cleanup, entry.timeoutMs ?? this.timeoutMs, `Cleanup ${entry.id}`); }
          catch (error) { failures.push(error); }
        }
        if (failures.length) throw new AggregateError(failures, 'One or more owned-resource cleanups failed.');
      });
    }
    return this.#closing;
  }
}

/** Preserve a primary failure as well as every cleanup failure, including non-Error throws. */
export async function withResourceScope<T>(scope: ResourceScope, use: (scope: ResourceScope) => Promise<T>): Promise<T> {
  let failed = false;
  let failure: unknown;
  let result: T;
  try { result = await use(scope); }
  catch (error) { failed = true; failure = error; }
  try { await scope.close(); }
  catch (error) {
    if (failed) throw new AggregateError([failure, ...(error instanceof AggregateError ? error.errors : [error])], 'Fixture execution and cleanup failed.');
    throw error;
  }
  if (failed) throw failure;
  return result!;
}

/** Register a newly acquired resource, disposing it even if setup finished after scope closure. */
export async function ownResource<T>(scope: ResourceScope, id: string, resource: T,
  dispose: (resource: T, signal: AbortSignal) => Promise<void>): Promise<T> {
  try { scope.defer({ id, cleanup: signal => dispose(resource, signal) }); }
  catch (error) {
    try { await runBounded(signal => dispose(resource, signal), scope.timeoutMs, `Late acquisition cleanup ${id}`); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Resource registration and cleanup failed.'); }
    throw error;
  }
  return resource;
}
