import { ConfigurationError } from '@azerish25-ux/forgeqa-core';
export interface PollOptions<T> { operation: () => Promise<T>; until: (value: T) => boolean; timeoutMs: number; intervalMs?: number; signal?: AbortSignal; describe?: string; }
export async function pollUntil<T>(options: PollOptions<T>): Promise<T> {
  if (options.timeoutMs <= 0) throw new ConfigurationError('pollUntil timeout must be positive.');
  const started = Date.now(); let last: T | undefined;
  while (Date.now() - started < options.timeoutMs) {
    if (options.signal?.aborted) throw options.signal.reason ?? new Error('Polling aborted.');
    last = await options.operation();
    if (options.until(last)) return last;
    const remaining = options.timeoutMs - (Date.now() - started);
    if (remaining <= 0) break;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, Math.min(options.intervalMs ?? 250, remaining));
      options.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(options.signal?.reason ?? new Error('Polling aborted.')); }, { once:true });
    });
  }
  throw new Error(`Timed out waiting for ${options.describe ?? 'condition'} after ${options.timeoutMs}ms. Last value: ${JSON.stringify(last)}`);
}
