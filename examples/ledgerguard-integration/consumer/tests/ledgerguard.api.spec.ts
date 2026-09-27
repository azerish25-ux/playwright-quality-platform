import { request as requests } from '@playwright/test';
import { pollUntil } from '@azerish25-ux/forgeqa-api';
import { forgeId, forgeOwner } from '@azerish25-ux/forgeqa-playwright';
import { LedgerSession } from '../src/client.js';
import type {
  Account,
  Adjustment,
  Identity,
  Occurrence,
  Page,
  Payment,
  Problem,
  Schedule,
  TransferReceipt,
} from '../src/contracts.js';
import {
  ACCOUNTS,
  PINNED_LEDGERGUARD_SHA,
  RECIPIENTS,
  account,
  expect,
  settledPayment,
  test,
} from './fixtures.js';

const transferBody = (amountMinor: string) => ({
  sourceId: ACCOUNTS.aliceCad,
  recipientRef: RECIPIENTS.bobCad,
  amountMinor,
  currency: 'CAD',
});
const paymentBody = (recipientRef: string, amountMinor: string) => ({
  sourceId: ACCOUNTS.aliceCad,
  recipientRef,
  amountMinor,
  currency: 'CAD',
});

test('pinned real service and scoped contracts are ready', {
  tag: '@smoke',
  annotation: [forgeId('lg-system-contract'), forgeOwner('platform-quality')],
}, async ({ publicApi }) => {
  expect(process.env.LEDGERGUARD_SOURCE_SHA).toBe(PINNED_LEDGERGUARD_SHA);
  const health = await publicApi.get<{ status: string }>('/actuator/health/readiness');
  expect(health.status).toBe(200);
  expect(health.data.status).toBe('UP');
  const system = await publicApi.get<{ databaseRole: string }>('/api/v1/system');
  expect(system.data.databaseRole).toBe('ledger_runtime');
  const p06 = await publicApi.get<{ paths: Record<string, unknown> }>('/api/v1/openapi/p06.json');
  const p07a = await publicApi.get<{ paths: Record<string, unknown> }>('/api/v1/openapi/p07a-schedules.json');
  expect(p06.data.paths).toHaveProperty('/api/v1/payments');
  expect(p07a.data.paths).toHaveProperty('/api/v1/schedules');
  expect(p07a.data.paths).toHaveProperty('/api/v1/schedules/{id}/occurrences');
});

test('authentication, logout, ownership and administrator separation use real sessions', {
  tag: '@smoke',
  annotation: [forgeId('lg-auth-boundaries'), forgeOwner('security')],
}, async ({ actors, baseURL }) => {
  const me = await actors.alice.request<Identity>('GET', '/api/v1/auth/me');
  expect(me.status).toBe(200);
  expect(me.body.email).toBe('alice@example.test');
  expect((await actors.alice.request('GET', `/api/v1/accounts/${ACCOUNTS.bobCad}`)).status).toBe(404);
  expect((await actors.alice.request('GET', '/api/v1/admin/security-events')).status).toBe(403);
  expect((await actors.admin.request('GET', '/api/v1/admin/security-events')).status).toBe(200);

  if (!baseURL) throw new Error('LedgerGuard baseURL is required.');
  const context = await requests.newContext({ baseURL });
  const anonymous = new LedgerSession(context);
  try {
    const denied = await anonymous.login('alice@example.test', 'incorrect-password');
    expect(denied.status).toBe(401);
    const password = process.env.LEDGER_DEMO_PASSWORD!;
    expect((await anonymous.login('alice@example.test', password)).status).toBe(200);
    expect((await anonymous.logout()).status).toBe(204);
    expect((await anonymous.request('GET', '/api/v1/auth/me')).status).toBe(401);
  } finally {
    await context.dispose();
  }
});

test('immediate transfer has one exact effect and strict idempotency semantics', {
  tag: '@regression',
  annotation: [forgeId('lg-transfer-idempotency'), forgeOwner('payments')],
}, async ({ actors, commandKey }) => {
  const sourceBefore = BigInt((await account(actors.alice, ACCOUNTS.aliceCad)).postedMinor);
  const destinationBefore = BigInt((await account(actors.bob, ACCOUNTS.bobCad)).postedMinor);
  const key = commandKey('transfer');
  const first = await actors.alice.request<TransferReceipt>('POST', '/api/v1/transfers', {
    body: transferBody('125'), idempotencyKey: key,
  });
  expect(first.status).toBe(201);
  expect(first.body.state).toBe('SETTLED');
  expect(first.body.journalId).toBeTruthy();
  const replay = await actors.alice.request<TransferReceipt>('POST', '/api/v1/transfers', {
    body: transferBody('125'), idempotencyKey: key,
  });
  expect(replay.status).toBe(201);
  expect(replay.body).toEqual(first.body);
  expect(replay.headers['idempotency-replayed']).toBe('true');
  const conflict = await actors.alice.request<Problem>('POST', '/api/v1/transfers', {
    body: transferBody('126'), idempotencyKey: key,
  });
  expect(conflict.status).toBe(409);
  expect(conflict.body.code).toBe('IDEMPOTENCY_CONFLICT');
  expect(BigInt((await account(actors.alice, ACCOUNTS.aliceCad)).postedMinor)).toBe(sourceBefore - 125n);
  expect(BigInt((await account(actors.bob, ACCOUNTS.bobCad)).postedMinor)).toBe(destinationBefore + 125n);
});

test('insufficient funds reject atomically without a partial balance mutation', {
  tag: '@regression',
  annotation: [forgeId('lg-transfer-rejection'), forgeOwner('payments')],
}, async ({ actors, commandKey }) => {
  const before = await account(actors.alice, ACCOUNTS.aliceCad);
  const key = commandKey('insufficient');
  const rejected = await actors.alice.request<Problem>('POST', '/api/v1/transfers', {
    body: transferBody('999999999999'), idempotencyKey: key,
  });
  expect(rejected.status).toBe(422);
  expect(rejected.body.code).toBeTruthy();
  const replay = await actors.alice.request<Problem>('POST', '/api/v1/transfers', {
    body: transferBody('999999999999'), idempotencyKey: key,
  });
  expect(replay.status).toBe(422);
  expect(replay.body).toEqual(rejected.body);
  expect(replay.headers['idempotency-replayed']).toBe('true');
  const after = await account(actors.alice, ACCOUNTS.aliceCad);
  expect(after.postedMinor).toBe(before.postedMinor);
  expect(after.reservedMinor).toBe(before.reservedMinor);
});

test('asynchronous payment reaches a bounded real terminal projection', {
  tag: '@regression',
  annotation: [forgeId('lg-async-payment'), forgeOwner('payments')],
}, async ({ actors, commandKey }) => {
  const accepted = await actors.alice.request<{ id: string; state: string }>('POST', '/api/v1/payments', {
    body: paymentBody(RECIPIENTS.merchantCad, '150'), idempotencyKey: commandKey('payment'),
  });
  expect(accepted.status).toBe(202);
  expect(accepted.body.state).toBe('PENDING');
  const settled = await settledPayment(actors.alice, accepted.body.id);
  expect(settled.state).toBe('SETTLED');
  expect(settled.journalId).toBeTruthy();
  expect(settled.projectionVersion).toBeTruthy();
});

test('recipient-authorized partial and full refunds preserve the original settlement', {
  tag: '@release',
  annotation: [forgeId('lg-refunds'), forgeOwner('payments')],
}, async ({ actors, commandKey }) => {
  const sourceBefore = BigInt((await account(actors.alice, ACCOUNTS.aliceCad)).postedMinor);
  const destinationBefore = BigInt((await account(actors.merchant, ACCOUNTS.merchantCad)).postedMinor);
  const accepted = await actors.alice.request<{ id: string }>('POST', '/api/v1/payments', {
    body: paymentBody(RECIPIENTS.merchantCad, '240'), idempotencyKey: commandKey('refund-parent'),
  });
  expect(accepted.status).toBe(202);
  const settled = await settledPayment(actors.alice, accepted.body.id);
  const originalJournal = settled.journalId;
  expect((await actors.alice.request('POST', `/api/v1/payments/${accepted.body.id}/refunds`, {
    body: { amountMinor: '1', reason: 'payer denied' }, idempotencyKey: commandKey('payer-refund'),
  })).status).toBe(403);

  const partialKey = commandKey('partial-refund');
  const partial = await actors.merchant.request<Adjustment>('POST', `/api/v1/payments/${accepted.body.id}/refunds`, {
    body: { amountMinor: '90', reason: 'partial return' }, idempotencyKey: partialKey,
  });
  expect(partial.status).toBe(201);
  const replay = await actors.merchant.request<Adjustment>('POST', `/api/v1/payments/${accepted.body.id}/refunds`, {
    body: { reason: 'partial return', amountMinor: '90' }, idempotencyKey: partialKey,
  });
  expect(replay.body).toEqual(partial.body);
  expect(replay.headers['idempotency-replayed']).toBe('true');
  expect((await actors.merchant.request<Problem>('POST', `/api/v1/payments/${accepted.body.id}/refunds`, {
    body: { amountMinor: '91', reason: 'partial return' }, idempotencyKey: partialKey,
  })).status).toBe(409);
  const final = await actors.merchant.request<Adjustment>('POST', `/api/v1/payments/${accepted.body.id}/refunds`, {
    body: { amountMinor: '150', reason: 'final return' }, idempotencyKey: commandKey('final-refund'),
  });
  expect(final.status).toBe(201);
  const current = (await actors.alice.request<Payment>('GET', `/api/v1/payments/${accepted.body.id}`)).body;
  expect(current.state).toBe('SETTLED');
  expect(current.adjustmentState).toBe('FULLY_REFUNDED');
  expect(current.journalId).toBe(originalJournal);
  const history = await actors.alice.request<Page<Adjustment>>('GET', `/api/v1/payments/${accepted.body.id}/adjustments`);
  expect(history.body.items).toHaveLength(2);
  expect(BigInt((await account(actors.alice, ACCOUNTS.aliceCad)).postedMinor)).toBe(sourceBefore);
  expect(BigInt((await account(actors.merchant, ACCOUNTS.merchantCad)).postedMinor)).toBe(destinationBefore);
});

test('administrator reversal is a single compensating effect with replay protection', {
  tag: '@release',
  annotation: [forgeId('lg-reversal'), forgeOwner('payments')],
}, async ({ actors, commandKey }) => {
  const sourceBefore = BigInt((await account(actors.alice, ACCOUNTS.aliceCad)).postedMinor);
  const destinationBefore = BigInt((await account(actors.bob, ACCOUNTS.bobCad)).postedMinor);
  const accepted = await actors.alice.request<{ id: string }>('POST', '/api/v1/payments', {
    body: paymentBody(RECIPIENTS.bobCad, '175'), idempotencyKey: commandKey('reversal-parent'),
  });
  expect(accepted.status).toBe(202);
  const settled = await settledPayment(actors.alice, accepted.body.id);
  expect((await actors.bob.request('POST', `/api/v1/payments/${accepted.body.id}/reversal`, {
    body: { reason: 'not authorized' }, idempotencyKey: commandKey('recipient-reversal'),
  })).status).toBe(403);
  const key = commandKey('admin-reversal');
  const reversed = await actors.admin.request<Adjustment>('POST', `/api/v1/payments/${accepted.body.id}/reversal`, {
    body: { reason: 'duplicate settlement correction' }, idempotencyKey: key,
  });
  expect(reversed.status).toBe(201);
  const replay = await actors.admin.request<Adjustment>('POST', `/api/v1/payments/${accepted.body.id}/reversal`, {
    body: { reason: 'duplicate settlement correction' }, idempotencyKey: key,
  });
  expect(replay.body).toEqual(reversed.body);
  expect(replay.headers['idempotency-replayed']).toBe('true');
  expect((await actors.admin.request('POST', `/api/v1/payments/${accepted.body.id}/reversal`, {
    body: { reason: 'second attempt' }, idempotencyKey: commandKey('second-reversal'),
  })).status).toBe(409);
  const current = (await actors.alice.request<Payment>('GET', `/api/v1/payments/${accepted.body.id}`)).body;
  expect(current.state).toBe('SETTLED');
  expect(current.adjustmentState).toBe('REVERSED');
  expect(current.journalId).toBe(settled.journalId);
  expect(BigInt((await account(actors.alice, ACCOUNTS.aliceCad)).postedMinor)).toBe(sourceBefore);
  expect(BigInt((await account(actors.bob, ACCOUNTS.bobCad)).postedMinor)).toBe(destinationBefore);
});

test('two schedulers commit one immutable occurrence for one due intent', {
  tag: '@release',
  annotation: [forgeId('lg-schedule-occurrence'), forgeOwner('scheduling')],
}, async ({ actors, commandKey }) => {
  const sourceBefore = BigInt((await account(actors.alice, ACCOUNTS.aliceCad)).postedMinor);
  const destinationBefore = BigInt((await account(actors.bob, ACCOUNTS.bobCad)).postedMinor);
  const intended = new Date(Date.now() + 15_000).toISOString().replace(/\.\d{3}Z$/, '');
  const body = {
    sourceId: ACCOUNTS.aliceCad,
    recipientRef: RECIPIENTS.bobCad,
    amountMinor: '75',
    currency: 'CAD',
    intendedLocal: intended,
    zoneId: 'UTC',
    recurrence: 'ONCE',
  };
  const key = commandKey('schedule-once');
  const created = await actors.alice.request<Schedule>('POST', '/api/v1/schedules', { body, idempotencyKey: key });
  expect(created.status).toBe(201);
  const replay = await actors.alice.request<Schedule>('POST', '/api/v1/schedules', { body, idempotencyKey: key });
  expect(replay.body).toEqual(created.body);
  expect(replay.headers['idempotency-replayed']).toBe('true');
  expect((await actors.bob.request('GET', `/api/v1/schedules/${created.body.id}`)).status).toBe(404);
  const occurrence = await pollUntil({
    operation: async () => (await actors.alice.request<Page<Occurrence>>(
      'GET', `/api/v1/schedules/${created.body.id}/occurrences?limit=10&offset=0`,
    )).body.items,
    until: (items) => items.length === 1 && items[0]!.outcome === 'SUCCEEDED',
    timeoutMs: 90_000,
    intervalMs: 300,
    describe: `single occurrence for schedule ${created.body.id}`,
  });
  expect(occurrence).toHaveLength(1);
  expect(occurrence[0]!.journalId).toBeTruthy();
  const current = (await actors.alice.request<Schedule>('GET', `/api/v1/schedules/${created.body.id}`)).body;
  expect(current.status).toBe('FINISHED');
  expect(BigInt((await account(actors.alice, ACCOUNTS.aliceCad)).postedMinor)).toBe(sourceBefore - 75n);
  expect(BigInt((await account(actors.bob, ACCOUNTS.bobCad)).postedMinor)).toBe(destinationBefore + 75n);
});

test('future schedule lifecycle is versioned and changed intent is rejected', {
  tag: '@release',
  annotation: [forgeId('lg-schedule-lifecycle'), forgeOwner('scheduling')],
}, async ({ actors, commandKey }) => {
  const future = new Date(Date.now() + 2 * 24 * 60 * 60 * 1_000).toISOString().replace(/\.\d{3}Z$/, '');
  const body = {
    sourceId: ACCOUNTS.aliceCad,
    recipientRef: RECIPIENTS.merchantCad,
    amountMinor: '30',
    currency: 'CAD',
    intendedLocal: future,
    zoneId: 'UTC',
    recurrence: 'DAILY',
  };
  const key = commandKey('schedule-future');
  const created = await actors.alice.request<Schedule>('POST', '/api/v1/schedules', { body, idempotencyKey: key });
  expect(created.status).toBe(201);
  const conflict = await actors.alice.request<Problem>('POST', '/api/v1/schedules', {
    body: { ...body, amountMinor: '31' }, idempotencyKey: key,
  });
  expect(conflict.status).toBe(409);
  expect(conflict.body.code).toBe('IDEMPOTENCY_CONFLICT');
  const paused = await actors.alice.request<Schedule>('POST', `/api/v1/schedules/${created.body.id}/pause`, {
    body: { expectedVersion: 1 }, idempotencyKey: commandKey('schedule-pause'),
  });
  expect(paused.status).toBe(200);
  expect(paused.body.status).toBe('PAUSED');
  const resumed = await actors.alice.request<Schedule>('POST', `/api/v1/schedules/${created.body.id}/resume`, {
    body: { expectedVersion: 1 }, idempotencyKey: commandKey('schedule-resume'),
  });
  expect(resumed.status).toBe(200);
  expect(resumed.body.status).toBe('ACTIVE');
  const cancelled = await actors.alice.request<Schedule>('POST', `/api/v1/schedules/${created.body.id}/cancel`, {
    body: { expectedVersion: 1 }, idempotencyKey: commandKey('schedule-cancel'),
  });
  expect(cancelled.status).toBe(200);
  expect(cancelled.body.status).toBe('CANCELLED');
});
