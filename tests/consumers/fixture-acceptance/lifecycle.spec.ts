import { test as base, expect, request, type APIRequestContext } from '@playwright/test';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { stat, readFile } from 'node:fs/promises';
import { resolveForgeConfig, ownResource, ResourceScope, withResourceScope } from '@azerish25-ux/forgeqa-core';
import { createForgeTest, AuthenticationManager, withNetworkRoutes, withClockPage, withFeatureFlags,
  type AuthenticationAdapter, type AuthenticationIdentity } from '@azerish25-ux/forgeqa-playwright';

// This small service verifies fixture contracts; it is not either product consumer.
interface Service { url: string; sessions: Map<string, { role: string; namespace: string }>; }
const test = createForgeTest(base, { runId: randomUUID(), config: resolveForgeConfig({ project: 'fixture-contracts', environments: { local: { baseUrl: 'http://127.0.0.1' } } }) })
  .extend<{ answer: number }, { service: Service }>({
    answer: 42,
    service: [async ({}, use) => {
      const sessions: Service['sessions'] = new Map();
      const server = createServer(async (req, res) => {
        if (req.url === '/session' && req.method === 'POST') {
          const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
          const identity = JSON.parse(Buffer.concat(chunks).toString()) as { role: string; namespace: string };
          const token = randomUUID(); sessions.set(token, identity);
          res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': `session=${token}; Path=/; HttpOnly; SameSite=Strict` }); res.end('{}'); return;
        }
        if (req.url === '/session') {
          const token = req.headers.cookie?.split('session=')[1]?.split(';')[0] ?? '';
          const session = sessions.get(token);
          if (req.method === 'DELETE') sessions.delete(token);
          res.writeHead(session ? 200 : 401, { 'content-type': 'application/json' }); res.end(JSON.stringify(session ?? {})); return;
        }
        if (req.url === '/value') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"real":true}'); return; }
        res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>Fixture contract service</title><input aria-label="Upload" type="file"><a download="evidence.txt" href="data:text/plain,contract-bytes">Download</a>');
      });
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing service address.');
      try { await use({ url: `http://127.0.0.1:${address.port}`, sessions }); }
      finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
    }, { scope: 'worker' }],
  });

test('public fixtures compose with native test, locators, and typed overrides', async ({ page, forgeFiles, forgeScope, forge, answer, service }) => {
  expect(answer).toBe(42); expect(forgeScope.namespace).toContain(forge.namespace);
  const upload = await forgeFiles.write('upload Ω.txt', 'contract-bytes');
  await page.goto(service.url); await page.getByLabel('Upload').setInputFiles(upload);
  expect(await page.getByLabel('Upload').evaluate((element: HTMLInputElement) => element.files?.[0]?.name)).toBe('upload Ω.txt');
  const pending = page.waitForEvent('download'); await page.getByRole('link', { name: 'Download' }).click();
  await forgeFiles.saveDownload(await pending);
  expect((await forgeFiles.read('evidence.txt')).toString()).toBe('contract-bytes');
});

test('real role sessions are isolated, reusable, exported privately, and reclaimed', async ({ forge, service, browser }, info) => {
  const identity = (role: string): AuthenticationIdentity => ({ application: 'fixture-service', environment: 'local', role, project: info.project.name,
    configHash: forge.config.configHash, namespace: `${forge.namespace}-${role}`, runId: forge.runId,
    shard: 1, parallelIndex: info.parallelIndex, workerIndex: info.workerIndex });
  const adapter: AuthenticationAdapter<APIRequestContext> = {
    id: 'contract-service',
    async authenticate(id, scope, signal) {
      const context = await ownResource(scope, 'context', await request.newContext({ baseURL: service.url }), value => value.dispose());
      signal.throwIfAborted();
      expect((await context.post('/session', { data: { role: id.role, namespace: id.namespace } })).status()).toBe(200);
      scope.defer({ id: 'logout', cleanup: async () => { expect((await context.delete('/session')).status()).toBe(200); } });
      return context;
    },
    async validate(context, id) { const response = await context.get('/session'); if (response.status() !== 200) return false; const state = await response.json(); return state.role === id.role && state.namespace === id.namespace; },
    storageState: context => context.storageState(),
  };
  const manager = new AuthenticationManager(adapter, { reuse: 'worker' }); const paths: string[] = [];
  try {
    await Promise.all(['owner', 'viewer'].map(role => manager.withSession(identity(role), async (context, path) => {
      expect((await (await context.get('/session')).json()).role).toBe(role); expect(path).toBeTruthy(); paths.push(path!);
      const scoped = await browser.newContext({ storageState: path! });
      try { expect((await (await scoped.request.get(`${service.url}/session`)).json()).role).toBe(role); }
      finally { await scoped.close(); }
    })));
    await manager.withSession(identity('owner'), async (_context, path) => { expect(paths).toContain(path); expect(JSON.parse(await readFile(path!, 'utf8')).cookies).toHaveLength(1); });
  } finally { await manager.close(); }
  for (const path of paths) await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(service.sessions.size).toBe(0);
});

test('expected interception is counted and restoration exposes the real server response', async ({ page, service }) => {
  await page.goto(service.url);
  const endpoint = `${service.url}/value`;
  await withNetworkRoutes(page, [{ name: 'explicit-contract-override', url: endpoint, handler: route => route.fulfill({ json: { real: false } }) }], async observations => {
    expect(await page.evaluate(async url => (await fetch(url)).json(), endpoint)).toEqual({ real: false });
    expect(observations[0]?.expectedInterceptions).toBe(1);
  });
  expect(await page.evaluate(async url => (await fetch(url)).json(), endpoint)).toEqual({ real: true });
});

test('clock pages do not change existing contexts or backend time', async ({ browser, page, service }) => {
  await page.goto(service.url); const real = Date.now();
  await withClockPage(browser, '2000-01-01T00:00:00Z', async clockPage => {
    await clockPage.goto(service.url);
    expect(await clockPage.evaluate(() => new Date().getUTCFullYear())).toBe(2000);
    expect(Math.abs(await page.evaluate(() => Date.now()) - Date.now())).toBeLessThan(5000);
    expect(Date.now()).toBeGreaterThanOrEqual(real);
  });
  expect(browser.contexts()).toHaveLength(1);
});

test('a failing native fixture user does not bypass owned scope teardown', async () => {
  const scope = new ResourceScope('consumer-failure'); let disposed = false;
  await expect(withResourceScope(scope, async current => {
    await ownResource(current, 'acquired', {}, async () => { disposed = true; });
    throw new Error('expected setup failure');
  })).rejects.toThrow('expected setup failure');
  expect(disposed).toBe(true);
});

test('feature flag restoration survives body failure with no global mutation', async () => {
  let flags = { enabled: false };
  const adapter = { id: 'explicit-consumer-flags', isolation: 'tenant' as const, read: async () => flags,
    replace: async (_namespace: string, next: Readonly<Record<string, boolean>>) => { flags = { enabled: next.enabled === true }; } };
  await expect(withFeatureFlags(adapter, randomUUID(), { enabled: true }, async () => {
    expect(flags.enabled).toBe(true); throw new Error('expected body failure');
  })).rejects.toThrow('expected body failure');
  expect(flags.enabled).toBe(false);
});
