import {
  expect,
  request as requests,
  test as base,
  type APIRequestContext,
  type TestInfo
} from '@playwright/test';
import { stableHash } from '@azerish25-ux/forgeqa-core';
import { createForgeTest } from '@azerish25-ux/forgeqa-playwright';
import { defineDataFactory } from '@azerish25-ux/forgeqa-test-data';
import { LedgerGuardClient } from '../src/client.js';
import { LedgerGuardLab } from '../src/lab.js';
import type { Account, RegisteredIdentity, Session } from '../src/types.js';

export interface Actor {
  context: APIRequestContext;
  client: LedgerGuardClient;
  identity: RegisteredIdentity | Session;
}

export interface FundedPair {
  payer: Actor;
  recipient: Actor;
  source: Account;
  destination: Account;
}

interface IdentitySeed {
  email: string;
  password: string;
  displayName: string;
}

const identityFactory = defineDataFactory<IdentitySeed>('ledgerguard-identity', context => {
  const discriminator = `${context.integer(100000, 999999)}${context.integer(100000, 999999)}`;
  return {
    email: `forgeqa-${context.sequence}-${discriminator}@example.test`,
    password: `Fq!${discriminator}Aa9-${context.integer(100000, 999999)}`,
    displayName: `ForgeQA ${context.sequence}-${discriminator}`
  };
});

interface TestFixtures {
  customer: Actor;
  otherCustomer: Actor;
  admin: Actor;
  fundedPair: FundedPair;
}

interface WorkerFixtures {
  lab: LedgerGuardLab;
}

export const test = createForgeTest(base).extend<TestFixtures, WorkerFixtures>({
  lab: [async ({}, use) => {
    await use(new LedgerGuardLab());
  }, { scope: 'worker' }],

  customer: async ({ forge, baseURL }, use, testInfo) => {
    const actor = await registeredActor(requiredBaseURL(baseURL), forge.runId, forge.namespace, testInfo, 1);
    try {
      await use(actor);
    } finally {
      await actor.context.dispose();
    }
  },

  otherCustomer: async ({ forge, baseURL }, use, testInfo) => {
    const actor = await registeredActor(requiredBaseURL(baseURL), forge.runId, forge.namespace, testInfo, 2);
    try {
      await use(actor);
    } finally {
      await actor.context.dispose();
    }
  },

  admin: async ({ baseURL }, use) => {
    const context = await requests.newContext({ baseURL: requiredBaseURL(baseURL) });
    const client = new LedgerGuardClient(context);
    await client.refreshCsrf();
    const result = await client.login(
      process.env.LEDGERGUARD_ADMIN_EMAIL ?? 'admin@example.test',
      required('LEDGER_DEMO_PASSWORD')
    );
    expect(result.status, 'seeded LedgerGuard administrator login').toBe(200);
    expect(result.body.role).toBe('ADMIN');
    const actor: Actor = { context, client, identity: result.body };
    try {
      await use(actor);
    } finally {
      await context.dispose();
    }
  },

  fundedPair: async ({ customer, otherCustomer, lab }, use) => {
    const sourceResult = await customer.client.createAccount('ForgeQA payer wallet');
    const destinationResult = await otherCustomer.client.createAccount('ForgeQA recipient wallet');
    expect(sourceResult.status).toBe(201);
    expect(destinationResult.status).toBe(201);
    lab.fundAccount(sourceResult.body.id, 50_000n);
    const funded = await customer.client.account(sourceResult.body.id);
    expect(funded.status).toBe(200);
    if ('availableMinor' in funded.body) expect(funded.body.availableMinor).toBe('50000');
    await use({
      payer: customer,
      recipient: otherCustomer,
      source: sourceResult.body,
      destination: destinationResult.body
    });
  }
});

async function registeredActor(
  baseURL: string,
  runId: string,
  namespace: string,
  testInfo: TestInfo,
  sequence: number
): Promise<Actor> {
  const context = await requests.newContext({ baseURL });
  const client = new LedgerGuardClient(context);
  const seed = identityFactory.build({
    seed: runId,
    logicalTestId: testInfo.testId,
    namespace,
    sequence
  });
  const identity = await client.registerAndLogin(seed);
  return { context, client, identity };
}

export function commandKey(testInfo: TestInfo, prefix: string, sequence = 0): string {
  const suffix = stableHash({ testId: testInfo.testId, retry: testInfo.retry, prefix, sequence }).slice(0, 32);
  return `${prefix}-${suffix}`;
}

function requiredBaseURL(value: string | undefined): string {
  if (!value) {
    throw new Error('LedgerGuard Playwright baseURL is required for external-consumer acceptance.');
  }
  return value;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required LedgerGuard test variable ${name}.`);
  return value;
}

export { expect };
