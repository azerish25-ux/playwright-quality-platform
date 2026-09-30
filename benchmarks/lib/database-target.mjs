/** Read-only benchmark reconciliation is confined to the explicitly enabled
 * disposable database, via loopback or the declared container's postgres service.
 */
export function benchmarkDatabaseTarget(env) {
  if (!env.DATABASE_URL || env.TEAMBOARD_TEST_MODE !== '1') throw new Error('Disposable TeamBoard runtime database is required.');
  const parsed = new URL(env.DATABASE_URL);
  const container = /^mcr\.microsoft\.com\/playwright:v\d+\.\d+\.\d+-noble@sha256:[a-f0-9]{64}$/.test(env.FORGEQA_BENCHMARK_IMAGE ?? '');
  const ownedHost = ['127.0.0.1', 'localhost'].includes(parsed.hostname) || (container && parsed.hostname === 'postgres');
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !ownedHost || !/^\/forgeqa_test(?:_[-a-z0-9]+)?$/.test(parsed.pathname)) {
    throw new Error('Cleanup verification is limited to the owned local test database.');
  }
  return parsed.href;
}
