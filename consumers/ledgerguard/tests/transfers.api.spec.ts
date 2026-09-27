import { forgeId, forgeOwner } from '@azerish25-ux/forgeqa-playwright';
import { commandKey, test, expect } from './fixtures.js';
import type { TransferReceipt } from '../src/types.js';

function receipt(body: TransferReceipt | { code: string }): TransferReceipt {
  if (!('journalId' in body)) throw new Error(`Expected a settled transfer, received ${body.code}.`);
  return body;
}

test('immediate transfer posts one exact financial effect', {
  tag: '@release',
  annotation: [forgeId('ledgerguard-transfer-settlement'), forgeOwner('platform-quality')]
}, async ({ fundedPair, lab }, testInfo) => {
  const beforeSource = await fundedPair.payer.client.account(fundedPair.source.id);
  const beforeDestination = await fundedPair.recipient.client.account(fundedPair.destination.id);
  expect(beforeSource.status).toBe(200);
  expect(beforeDestination.status).toBe(200);
  if (!('postedMinor' in beforeSource.body) || !('postedMinor' in beforeDestination.body)) {
    throw new Error('Expected account balances before transfer.');
  }

  const result = await fundedPair.payer.client.transfer({
    sourceId: fundedPair.source.id,
    recipientRef: fundedPair.destination.publicRef,
    amountMinor: '1250',
    currency: 'CAD'
  }, commandKey(testInfo, 'transfer-settle'));
  expect(result.status).toBe(201);
  const settled = receipt(result.body);
  expect(settled.state).toBe('SETTLED');
  expect(settled.amountMinor).toBe('1250');

  const afterSource = await fundedPair.payer.client.account(fundedPair.source.id);
  const afterDestination = await fundedPair.recipient.client.account(fundedPair.destination.id);
  if (!('postedMinor' in afterSource.body) || !('postedMinor' in afterDestination.body)) {
    throw new Error('Expected account balances after transfer.');
  }
  expect(BigInt(afterSource.body.postedMinor)).toBe(BigInt(beforeSource.body.postedMinor) - 1250n);
  expect(BigInt(afterDestination.body.postedMinor)).toBe(BigInt(beforeDestination.body.postedMinor) + 1250n);

  const stored = await fundedPair.payer.client.transferById(settled.id);
  expect(stored.status).toBe(200);
  expect('journalId' in stored.body && stored.body.journalId).toBe(settled.journalId);
  const counts = lab.transferEffectCounts(settled.id).split(':').map(Number);
  expect(counts[0]).toBe(1);
  expect(counts[1]).toBe(1);
  expect(counts[2]).toBeGreaterThanOrEqual(1);
});

test('transfer idempotency replays identical intent and rejects changed intent', {
  tag: '@release',
  annotation: [forgeId('ledgerguard-transfer-idempotency'), forgeOwner('platform-quality')]
}, async ({ fundedPair, lab }, testInfo) => {
  const key = commandKey(testInfo, 'transfer-replay');
  const intent = {
    sourceId: fundedPair.source.id,
    recipientRef: fundedPair.destination.publicRef,
    amountMinor: '700',
    currency: 'CAD' as const
  };
  const first = await fundedPair.payer.client.transfer(intent, key);
  const second = await fundedPair.payer.client.transfer(intent, key);
  expect(first.status).toBe(201);
  expect(second.status).toBe(201);
  expect(second.replayed).toBe(true);
  expect(second.body).toEqual(first.body);
  const settled = receipt(first.body);

  const changed = await fundedPair.payer.client.transfer({ ...intent, amountMinor: '701' }, key);
  expect(changed.status).toBe(409);
  expect('code' in changed.body && changed.body.code).toBe('IDEMPOTENCY_CONFLICT');

  const counts = lab.transferEffectCounts(settled.id).split(':').map(Number);
  expect(counts[0]).toBe(1);
  expect(counts[1]).toBe(1);
});

test('insufficient funds leaves balances and transfer inventory unchanged', {
  tag: '@release',
  annotation: [forgeId('ledgerguard-transfer-insufficient-funds'), forgeOwner('platform-quality')]
}, async ({ fundedPair }, testInfo) => {
  const beforeAccount = await fundedPair.payer.client.account(fundedPair.source.id);
  const beforeTransfers = await fundedPair.payer.client.transfers();
  if (!('postedMinor' in beforeAccount.body)) throw new Error('Expected payer account balance.');

  const key = commandKey(testInfo, 'transfer-insufficient');
  const intent = {
    sourceId: fundedPair.source.id,
    recipientRef: fundedPair.destination.publicRef,
    amountMinor: '1000000',
    currency: 'CAD' as const
  };
  const rejected = await fundedPair.payer.client.transfer(intent, key);
  const replay = await fundedPair.payer.client.transfer(intent, key);
  expect(rejected.status).toBe(422);
  expect(replay.status).toBe(422);
  expect(replay.replayed).toBe(true);
  expect(replay.body).toEqual(rejected.body);
  expect('code' in rejected.body && rejected.body.code).toBe('INSUFFICIENT_FUNDS');

  const afterAccount = await fundedPair.payer.client.account(fundedPair.source.id);
  const afterTransfers = await fundedPair.payer.client.transfers();
  if (!('postedMinor' in afterAccount.body)) throw new Error('Expected payer account balance.');
  expect(afterAccount.body.postedMinor).toBe(beforeAccount.body.postedMinor);
  expect(afterTransfers.body.items.map(item => item.id)).toEqual(beforeTransfers.body.items.map(item => item.id));
});
