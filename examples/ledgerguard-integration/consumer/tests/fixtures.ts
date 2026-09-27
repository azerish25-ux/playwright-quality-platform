import {
  expect,
  request as requests,
  test as base,
  type APIRequestContext,
  type TestInfo,
} from '@playwright/test';
import { ForgeHttpClient, pollUntil } from '@azerish25-ux/forgeqa-api';
import { createForgeTest } from '@azerish25-ux/forgeqa-playwright';
import { defineDataFactory } from '@azerish25-ux/forgeqa-test-data';
import { LedgerSession } from '../src/client.js';
import type { Account, Identity, Payment } from '../src/contracts.js';

export const PINNED_LEDGERGUARD_SHA = '9478663f97f9dc65d0c85117f244e1b8b80c37cb';
export const ACCOUNTS = Object.freeze({
  aliceCad: '10000000-0000-0000-0000-000000000001',
  bobCad: '20000000-0000-0000-0000-000000000001',
  merchantCad: '30000000-0000-0000-0000-000000000001',
});
export const RECIPIENTS = Object.freeze({
  bobCad: 'LG-20000000000000000000000000000001',
  merchantCad: 'LG-30000000000000000000000000000001',
});

export interface Actors {
  alice: LedgerSession;
  bob: LedgerSession;
  merchant: LedgerSession;
  admin: LedgerSession;
}

type CommandKey = (prefix: string) => string;

const keyFactory = defineDataFactory('ledgerguard-command-key', (context) => ({
  suffix: `${context.integer(0x10000000, 0x7fffffff).toString(16)}-${context.sequence.toString(36)}`,
}));

async function authenticatedContext(baseURL: string, email: string, password: string): Promise<{
  context: APIRequestContext;
  session: LedgerSession;
  identity: Identity;
}> {
  const context = await requests.newContext({ baseURL });
  const session = new LedgerSession(context);
  const login = await session.login(email, password);
  expect(login.status, `${email} logs into the real LedgerGuard API`).toBe(200);
  return { context, session, identity: login.body as Identity };
}

export const test = createForgeTest(base).extend<{
  actors: Actors;
  commandKey: CommandKey;
  publicApi: ForgeHttpClient;
}>({
  actors: async ({ baseURL }, use) => {
    const password = process.env.LEDGER_DEMO_PASSWORD;
    if (!password) throw new Error('LEDGER_DEMO_PASSWORD is required for the real LedgerGuard consumer.');
    const sessions = await Promise.all([
      authenticatedContext(baseURL!, 'alice@example.test', password),
      authenticatedContext(baseURL!, 'bob@example.test', password),
      authenticatedContext(baseURL!, 'merchant@example.test', password),
      authenticatedContext(baseURL!, 'admin@example.test', password),
    ]);
    const [alice, bob, merchant, admin] = sessions;
    expect(alice!.identity.role).toBe('CUSTOMER');
    expect(bob!.identity.role).toBe('CUSTOMER');
    expect(merchant!.identity.role).toBe('CUSTOMER');
    expect(admin!.identity.role).toBe('ADMIN');
    try {
      await use({
        alice: alice!.session,
        bob: bob!.session,
        merchant: merchant!.session,
        admin: admin!.session,
      });
    } finally {
      for (const item of sessions) {
        try { await item.session.logout(); } catch { /* context disposal is the final boundary */ }
        await item.context.dispose();
      }
    }
  },
  commandKey: async ({ forge }, use, testInfo: TestInfo) => {
    let sequence = 0;
    const logicalTestId = testInfo.titlePath.join('/');
    await use((prefix: string) => {
      const safePrefix = prefix.replace(/[^A-Za-z0-9._:-]/g, '-').replace(/^[^A-Za-z0-9]/, 'k');
      const { suffix } = keyFactory.build({
        seed: forge.runId,
        logicalTestId,
        namespace: forge.namespace,
        sequence: sequence++,
      });
      return `${safePrefix}:${forge.namespace}:${suffix}`.slice(0, 127);
    });
  },
  publicApi: async ({ forge }, use) => {
    await use(new ForgeHttpClient(forge.config.baseUrl));
  },
});

export async function account(session: LedgerSession, id: string): Promise<Account> {
  const response = await session.request<Account>('GET', `/api/v1/accounts/${id}`);
  expect(response.status).toBe(200);
  return response.body;
}

export async function settledPayment(session: LedgerSession, id: string): Promise<Payment> {
  return pollUntil({
    operation: async () => {
      const response = await session.request<Payment>('GET', `/api/v1/payments/${id}`);
      expect(response.status).toBe(200);
      return response.body;
    },
    until: (value) => value.state === 'SETTLED' && value.projectionState === 'SETTLED',
    timeoutMs: 90_000,
    intervalMs: 300,
    describe: `LedgerGuard payment ${id} settlement and projection`,
  });
}

export { expect };
