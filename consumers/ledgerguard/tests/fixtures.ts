import {
  expect,
  test as base,
  type APIRequestContext,
  type TestInfo
} from '@playwright/test';
import { stableHash } from '@azerish25-ux/forgeqa-core';
import { createForgeTest, withAuthentication } from '@azerish25-ux/forgeqa-playwright';
import { defineDataFactory } from '@azerish25-ux/forgeqa-test-data';
import type { LedgerGuardClient } from '../src/client.js';
import { ledgerguardAuthentication, ledgerguardIdentity } from './authentication.js';
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
    displayName: `Deadpan ${context.sequence}-${discriminator}`
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
    const seed = identityFactory.build({ seed: forge.runId, logicalTestId: testInfo.testId, namespace: forge.namespace, sequence: 1 });
    await withAuthentication(ledgerguardAuthentication(requiredBaseURL(baseURL), seed), ledgerguardIdentity(forge, testInfo, 'CUSTOMER', 1), use);
  },

  otherCustomer: async ({ forge, baseURL }, use, testInfo) => {
    const seed = identityFactory.build({ seed: forge.runId, logicalTestId: testInfo.testId, namespace: forge.namespace, sequence: 2 });
    await withAuthentication(ledgerguardAuthentication(requiredBaseURL(baseURL), seed), ledgerguardIdentity(forge, testInfo, 'CUSTOMER', 2), use);
  },

  admin: async ({ forge, baseURL }, use, testInfo) => {
    const credentials = { email: process.env.LEDGERGUARD_ADMIN_EMAIL ?? 'admin@example.test', password: required('LEDGER_DEMO_PASSWORD') };
    await withAuthentication(ledgerguardAuthentication(requiredBaseURL(baseURL), credentials), ledgerguardIdentity(forge, testInfo, 'ADMIN', 0), use);
  },

  fundedPair: async ({ customer, otherCustomer, lab }, use) => {
    const sourceResult = await customer.client.createAccount('Deadpan payer wallet');
    const destinationResult = await otherCustomer.client.createAccount('Deadpan recipient wallet');
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

export function commandKey(testInfo: TestInfo, prefix: string, sequence = 0): string {
  const suffix = stableHash({
    runId: forgeRunId(testInfo),
    testId: testInfo.testId,
    retry: testInfo.retry,
    prefix,
    sequence
  }).slice(0, 32);
  return `${prefix}-${suffix}`;
}

function forgeRunId(testInfo: TestInfo): string {
  const metadata = testInfo.config.metadata['forgeqa'] as { runId?: unknown } | undefined;
  if (!metadata || typeof metadata.runId !== 'string' || metadata.runId.length === 0) {
    throw new Error('Deadpan run metadata is required for LedgerGuard durable command identity.');
  }
  return metadata.runId;
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
