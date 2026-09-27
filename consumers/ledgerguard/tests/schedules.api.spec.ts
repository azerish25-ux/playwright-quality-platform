import { pollUntil } from '@azerish25-ux/forgeqa-api';
import { forgeId, forgeOwner } from '@azerish25-ux/forgeqa-playwright';
import { commandKey, test, expect } from './fixtures.js';
import type { ScheduleOccurrence, ScheduleView } from '../src/types.js';

function schedule(body: ScheduleView | { code: string }): ScheduleView {
  if (!('recurrence' in body)) throw new Error(`Expected a schedule, received ${body.code}.`);
  return body;
}

test('two schedulers produce one immutable one-time occurrence', {
  tag: '@release',
  annotation: [forgeId('ledgerguard-schedule-one-time'), forgeOwner('platform-quality')]
}, async ({ fundedPair, otherCustomer, lab }, testInfo) => {
  const running = lab.runningServices();
  expect(running.has('api')).toBe(true);
  expect(running.has('scheduler-a')).toBe(true);
  expect(running.has('scheduler-b')).toBe(true);

  const due = new Date(Date.now() + 12_000).toISOString().slice(0, 19);
  const intent = {
    sourceId: fundedPair.source.id,
    recipientRef: fundedPair.destination.publicRef,
    amountMinor: '2500',
    currency: 'CAD' as const,
    intendedLocal: due,
    zoneId: 'UTC',
    recurrence: 'ONCE' as const
  };
  const key = commandKey(testInfo, 'schedule-once');
  const created = await fundedPair.payer.client.createSchedule(intent, key);
  const replay = await fundedPair.payer.client.createSchedule(intent, key);
  expect(created.status).toBe(201);
  expect(replay.status).toBe(201);
  expect(replay.replayed).toBe(true);
  expect(replay.body).toEqual(created.body);
  const oneTime = schedule(created.body);

  const hidden = await otherCustomer.client.schedule(oneTime.id);
  expect(hidden.status).toBe(404);

  const occurrence = await pollUntil<ScheduleOccurrence | undefined>({
    operation: async () => {
      const result = await fundedPair.payer.client.scheduleOccurrences(oneTime.id, 10, 0);
      if (result.status !== 200 || !('items' in result.body)) return undefined;
      return result.body.items[0];
    },
    until: value => value?.outcome === 'SUCCEEDED' && Boolean(value.journalId),
    timeoutMs: 70_000,
    intervalMs: 300,
    describe: `one-time schedule ${oneTime.id} occurrence`
  });
  if (!occurrence?.operationId || !occurrence.journalId) throw new Error('Expected a successful scheduled transfer occurrence.');

  const currentResult = await fundedPair.payer.client.schedule(oneTime.id);
  expect(currentResult.status).toBe(200);
  const current = schedule(currentResult.body);
  expect(current.status).toBe('FINISHED');
  expect(lab.scheduleEffectCounts(oneTime.id, occurrence.operationId)).toBe('1:1:1');

  const source = await fundedPair.payer.client.account(fundedPair.source.id);
  const destination = await fundedPair.recipient.client.account(fundedPair.destination.id);
  if (!('postedMinor' in source.body) || !('postedMinor' in destination.body)) {
    throw new Error('Expected post-occurrence account balances.');
  }
  expect(source.body.postedMinor).toBe('47500');
  expect(destination.body.postedMinor).toBe('2500');
  expect(lab.reconciliationDiscrepancies()).toBe(0);
});

test('scheduled transfer edit and lifecycle commands are versioned and idempotent', {
  tag: '@release',
  annotation: [forgeId('ledgerguard-schedule-lifecycle'), forgeOwner('platform-quality')]
}, async ({ fundedPair }, testInfo) => {
  const future = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19);
  const initial = {
    sourceId: fundedPair.source.id,
    recipientRef: fundedPair.destination.publicRef,
    amountMinor: '100',
    currency: 'CAD' as const,
    intendedLocal: future,
    zoneId: 'UTC',
    recurrence: 'DAILY' as const
  };
  const createKey = commandKey(testInfo, 'schedule-daily');
  const created = await fundedPair.payer.client.createSchedule(initial, createKey);
  expect(created.status).toBe(201);
  const daily = schedule(created.body);
  expect(daily.version).toBe(1);
  expect(daily.status).toBe('ACTIVE');

  const conflict = await fundedPair.payer.client.createSchedule({ ...initial, amountMinor: '101' }, createKey);
  expect(conflict.status).toBe(409);
  expect('code' in conflict.body && conflict.body.code).toBe('IDEMPOTENCY_CONFLICT');

  const editedResult = await fundedPair.payer.client.editSchedule(daily.id, {
    ...initial,
    amountMinor: '125',
    expectedVersion: 1
  }, commandKey(testInfo, 'schedule-edit'));
  expect(editedResult.status).toBe(200);
  const edited = schedule(editedResult.body);
  expect(edited.version).toBe(2);
  expect(edited.amountMinor).toBe('125');

  const pauseKey = commandKey(testInfo, 'schedule-pause');
  const pausedResult = await fundedPair.payer.client.scheduleState(daily.id, 'pause', 2, pauseKey);
  const pauseReplay = await fundedPair.payer.client.scheduleState(daily.id, 'pause', 2, pauseKey);
  expect(pausedResult.status).toBe(200);
  expect(pauseReplay.status).toBe(200);
  expect(pauseReplay.replayed).toBe(true);
  const paused = schedule(pausedResult.body);
  expect(paused.status).toBe('PAUSED');

  const resumedResult = await fundedPair.payer.client.scheduleState(
    daily.id,
    'resume',
    2,
    commandKey(testInfo, 'schedule-resume')
  );
  expect(resumedResult.status).toBe(200);
  expect(schedule(resumedResult.body).status).toBe('ACTIVE');

  const cancelledResult = await fundedPair.payer.client.scheduleState(
    daily.id,
    'cancel',
    2,
    commandKey(testInfo, 'schedule-cancel')
  );
  expect(cancelledResult.status).toBe(200);
  expect(schedule(cancelledResult.body).status).toBe('CANCELLED');

  const occurrences = await fundedPair.payer.client.scheduleOccurrences(daily.id);
  expect(occurrences.status).toBe(200);
  expect('items' in occurrences.body && occurrences.body.items).toEqual([]);
});
