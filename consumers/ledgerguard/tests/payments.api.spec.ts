import { pollUntil } from '@azerish25-ux/forgeqa-api';
import { forgeId, forgeOwner } from '@azerish25-ux/forgeqa-playwright';
import { commandKey, test, expect, type Actor } from './fixtures.js';
import type { PaymentReceipt, PaymentRecord, Problem } from '../src/types.js';

function pendingReceipt(body: PaymentReceipt | Problem): PaymentReceipt {
  if (!('kind' in body)) throw new Error(`Expected an accepted payment, received ${body.code}.`);
  return body;
}

async function waitForPayment(actor: Actor, id: string, state: PaymentRecord['state']): Promise<PaymentRecord> {
  const result = await pollUntil({
    operation: () => actor.client.paymentById(id),
    until: value => value.status === 200 && 'state' in value.body && value.body.state === state,
    timeoutMs: 70_000,
    intervalMs: 300,
    describe: `LedgerGuard payment ${id} to reach ${state}`
  });
  if (!('state' in result.body)) throw new Error(`Payment ${id} did not produce a payment record.`);
  return result.body;
}

test('asynchronous payment reaches one settled terminal projection', {
  tag: '@release',
  annotation: [forgeId('ledgerguard-payment-terminal-status'), forgeOwner('platform-quality')]
}, async ({ fundedPair, lab }, testInfo) => {
  const accepted = await fundedPair.payer.client.payment({
    sourceId: fundedPair.source.id,
    recipientRef: fundedPair.destination.publicRef,
    amountMinor: '1500',
    currency: 'CAD'
  }, commandKey(testInfo, 'payment-settle'));
  expect(accepted.status).toBe(202);
  const pending = pendingReceipt(accepted.body);
  expect(pending.state).toBe('PENDING');

  const settled = await waitForPayment(fundedPair.payer, pending.id, 'SETTLED');
  expect(settled.projectionState).toBe('SETTLED');
  expect(settled.projectionVersion).toBe(settled.version);
  expect(settled.journalId).toBeTruthy();

  const counts = lab.paymentEffectCounts(pending.id).split(':').map(Number);
  expect(counts[0]).toBe(1);
  expect(counts[1]).toBe(1);
  expect(counts[2]).toBe(1);
});

test('payer cancellation releases a pending hold exactly once', {
  tag: '@release',
  annotation: [forgeId('ledgerguard-payment-cancellation'), forgeOwner('platform-quality')]
}, async ({ fundedPair, lab }, testInfo) => {
  lab.stop('outbox-publisher', 'payment-worker-a', 'payment-worker-b');
  try {
    const accepted = await fundedPair.payer.client.payment({
      sourceId: fundedPair.source.id,
      recipientRef: fundedPair.destination.publicRef,
      amountMinor: '2400',
      currency: 'CAD'
    }, commandKey(testInfo, 'payment-cancel-parent'));
    expect(accepted.status).toBe(202);
    const pending = pendingReceipt(accepted.body);

    const outsider = await fundedPair.recipient.client.cancelPayment(
      pending.id,
      commandKey(testInfo, 'payment-cancel-outsider')
    );
    expect(outsider.status).toBe(404);

    const cancelKey = commandKey(testInfo, 'payment-cancel-owner');
    const first = await fundedPair.payer.client.cancelPayment(pending.id, cancelKey);
    const replay = await fundedPair.payer.client.cancelPayment(pending.id, cancelKey);
    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(replay.replayed).toBe(true);
    expect(replay.body).toEqual(first.body);
    expect(lab.paymentCancellationState(pending.id)).toBe('CANCELLED:RELEASED:0');

    const payer = await fundedPair.payer.client.account(fundedPair.source.id);
    if (!('reservedMinor' in payer.body)) throw new Error('Expected the payer account after cancellation.');
    expect(payer.body.reservedMinor).toBe('0');
  } finally {
    lab.up('outbox-publisher', 'payment-worker-a', 'payment-worker-b');
  }
});

test('recipient partial and full refunds preserve the settlement journal', {
  tag: '@release',
  annotation: [forgeId('ledgerguard-payment-refund'), forgeOwner('platform-quality')]
}, async ({ fundedPair, lab }, testInfo) => {
  const beforeSource = await fundedPair.payer.client.account(fundedPair.source.id);
  const beforeDestination = await fundedPair.recipient.client.account(fundedPair.destination.id);
  if (!('postedMinor' in beforeSource.body) || !('postedMinor' in beforeDestination.body)) {
    throw new Error('Expected balances before refund scenario.');
  }

  const accepted = await fundedPair.payer.client.payment({
    sourceId: fundedPair.source.id,
    recipientRef: fundedPair.destination.publicRef,
    amountMinor: '5000',
    currency: 'CAD'
  }, commandKey(testInfo, 'payment-refund-parent'));
  expect(accepted.status).toBe(202);
  const pending = pendingReceipt(accepted.body);
  const settled = await waitForPayment(fundedPair.payer, pending.id, 'SETTLED');
  if (!settled.journalId) throw new Error('Expected the immutable settlement journal.');

  const unauthorized = await fundedPair.payer.client.refundPayment(
    pending.id,
    '100',
    commandKey(testInfo, 'payment-refund-payer')
  );
  expect(unauthorized.status).toBe(403);

  const refundKey = commandKey(testInfo, 'payment-refund-partial');
  const partial = await fundedPair.recipient.client.refundPayment(pending.id, '2000', refundKey, 'partial return');
  const partialReplay = await fundedPair.recipient.client.refundPayment(pending.id, '2000', refundKey, 'partial return');
  expect(partial.status).toBe(201);
  expect(partialReplay.status).toBe(201);
  expect(partialReplay.replayed).toBe(true);
  expect(partialReplay.body).toEqual(partial.body);

  const conflict = await fundedPair.recipient.client.refundPayment(pending.id, '2001', refundKey, 'partial return');
  expect(conflict.status).toBe(409);
  expect('code' in conflict.body && conflict.body.code).toBe('IDEMPOTENCY_CONFLICT');

  const full = await fundedPair.recipient.client.refundPayment(
    pending.id,
    '3000',
    commandKey(testInfo, 'payment-refund-final'),
    'final return'
  );
  expect(full.status).toBe(201);

  const current = await fundedPair.payer.client.paymentById(pending.id);
  expect(current.status).toBe(200);
  expect('adjustmentState' in current.body && current.body.adjustmentState).toBe('FULLY_REFUNDED');
  const history = await fundedPair.payer.client.paymentAdjustments(pending.id);
  expect(history.status).toBe(200);
  expect('items' in history.body && history.body.items).toHaveLength(2);
  expect(lab.adjustmentCount(pending.id, 'REFUND')).toBe(2);
  expect(lab.journalEntryCount(settled.journalId)).toBe(2);

  const afterSource = await fundedPair.payer.client.account(fundedPair.source.id);
  const afterDestination = await fundedPair.recipient.client.account(fundedPair.destination.id);
  if (!('postedMinor' in afterSource.body) || !('postedMinor' in afterDestination.body)) {
    throw new Error('Expected balances after refund scenario.');
  }
  expect(afterSource.body.postedMinor).toBe(beforeSource.body.postedMinor);
  expect(afterDestination.body.postedMinor).toBe(beforeDestination.body.postedMinor);
});

test('administrator reversal is one compensating effect and leaves base settlement immutable', {
  tag: '@release',
  annotation: [forgeId('ledgerguard-payment-reversal'), forgeOwner('platform-quality')]
}, async ({ fundedPair, admin, lab }, testInfo) => {
  const accepted = await fundedPair.payer.client.payment({
    sourceId: fundedPair.source.id,
    recipientRef: fundedPair.destination.publicRef,
    amountMinor: '3000',
    currency: 'CAD'
  }, commandKey(testInfo, 'payment-reversal-parent'));
  expect(accepted.status).toBe(202);
  const pending = pendingReceipt(accepted.body);
  const settled = await waitForPayment(fundedPair.payer, pending.id, 'SETTLED');
  if (!settled.journalId) throw new Error('Expected settlement journal before reversal.');

  const customerDenied = await fundedPair.recipient.client.reversePayment(
    pending.id,
    'not authorized',
    commandKey(testInfo, 'payment-reversal-customer')
  );
  expect(customerDenied.status).toBe(403);

  const blank = await admin.client.reversePayment(
    pending.id,
    '   ',
    commandKey(testInfo, 'payment-reversal-blank')
  );
  expect(blank.status).toBe(400);

  const key = commandKey(testInfo, 'payment-reversal-admin');
  const reversed = await admin.client.reversePayment(pending.id, 'duplicate settlement correction', key);
  const replay = await admin.client.reversePayment(pending.id, 'duplicate settlement correction', key);
  expect(reversed.status).toBe(201);
  expect(replay.status).toBe(201);
  expect(replay.replayed).toBe(true);
  expect(replay.body).toEqual(reversed.body);

  const current = await fundedPair.payer.client.paymentById(pending.id);
  expect(current.status).toBe(200);
  expect('state' in current.body && current.body.state).toBe('SETTLED');
  expect('adjustmentState' in current.body && current.body.adjustmentState).toBe('REVERSED');
  expect(lab.adjustmentCount(pending.id, 'REVERSAL')).toBe(1);
  expect(lab.journalEntryCount(settled.journalId)).toBe(2);
});
