import { ResourceScope, runBounded, withResourceScope } from '@azerish25-ux/forgeqa-core';
import type { Browser, BrowserContextOptions, Page } from '@playwright/test';

export interface FeatureFlagAdapter {
  id: string;
  isolation: 'tenant';
  read(namespace: string, signal: AbortSignal): Promise<Record<string, boolean>>;
  /** Replace the full owned namespace snapshot, including removing flags absent from it. */
  replace(namespace: string, flags: Readonly<Record<string, boolean>>, signal: AbortSignal): Promise<void>;
}
const activeFlags = new Set<string>();
function flagSnapshot(flags: Readonly<Record<string, boolean>>): Record<string, boolean> {
  const entries = Object.entries(flags);
  if (entries.some(([key, value]) => !/^[A-Za-z][A-Za-z0-9_-]{0,99}$/.test(key) || typeof value !== 'boolean')) throw new Error('Invalid feature-flag snapshot.');
  return Object.fromEntries(entries);
}

export async function withFeatureFlags<T>(adapter: FeatureFlagAdapter, namespace: string, overrides: Readonly<Record<string, boolean>>,
  use: () => Promise<T>, timeoutMs = 5_000): Promise<T> {
  if (adapter.isolation !== 'tenant' || !adapter.id.trim() || !namespace.trim()) throw new Error('Feature flags require an explicitly owned tenant namespace; global mutation is refused.');
  const changes = flagSnapshot(overrides);
  const key = JSON.stringify([adapter.id, namespace]);
  if (activeFlags.has(key)) throw new Error('Concurrent feature-flag mutation of the same tenant is unsafe.');
  activeFlags.add(key);
  try {
    return await withResourceScope(new ResourceScope(namespace, timeoutMs), async scope => {
      const previous = flagSnapshot(await runBounded(signal => adapter.read(namespace, signal), timeoutMs, 'Read feature flags'));
      // Register restoration before mutation: a partially failing replace still requires rollback.
      scope.defer({ id: 'restore-feature-flags', cleanup: signal => adapter.replace(namespace, previous, signal) });
      await runBounded(signal => adapter.replace(namespace, { ...previous, ...changes }, signal), timeoutMs, 'Override feature flags');
      return use();
    });
  } finally { activeFlags.delete(key); }
}

export interface NetworkOverride {
  name: string;
  url: Parameters<Page['route']>[0];
  handler: Parameters<Page['route']>[1];
}
export interface NetworkObservation { name: string; expectedInterceptions: number; }

/** Only owned handlers are removed. Counts are explicit expected interception, not network failures. */
export async function withNetworkRoutes<T>(page: Page, routes: ReadonlyArray<NetworkOverride>,
  use: (observations: ReadonlyArray<NetworkObservation>) => Promise<T>): Promise<T> {
  const names = routes.map(route => route.name);
  if (names.some(name => !name.trim()) || new Set(names).size !== names.length) throw new Error('Network override names must be nonempty and unique.');
  return withResourceScope(new ResourceScope('network-overrides'), async scope => {
    const observations = routes.map(route => ({ name: route.name, expectedInterceptions: 0 }));
    for (const [index, entry] of routes.entries()) {
      const handler: NetworkOverride['handler'] = async (route, request) => {
        observations[index]!.expectedInterceptions++;
        await entry.handler(route, request);
      };
      scope.defer({ id: `unroute-${index}`, cleanup: () => page.unroute(entry.url, handler) });
      await page.route(entry.url, handler);
    }
    return use(observations);
  });
}

/** Clock installation is confined to a fresh context that is closed on success or failure. */
export async function withClockPage<T>(browser: Browser, time: number | string | Date,
  use: (page: Page) => Promise<T>, contextOptions: BrowserContextOptions = {}): Promise<T> {
  const instant = time instanceof Date ? time.getTime() : typeof time === 'number' ? time : Date.parse(time);
  if (!Number.isFinite(instant)) throw new Error('Invalid browser-clock instant.');
  return withResourceScope(new ResourceScope('browser-clock'), async scope => {
    const context = await browser.newContext(contextOptions);
    scope.defer({ id: 'clock-context', cleanup: () => context.close() });
    const page = await context.newPage();
    await page.clock.install({ time: new Date(instant) });
    return use(page);
  });
}
