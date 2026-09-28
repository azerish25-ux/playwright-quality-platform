import test from 'node:test';
import assert from 'node:assert/strict';
import { GuardedPostgresAdapter } from '@azerish25-ux/forgeqa-test-data';

function executor(database = 'forgeqa_test_adapter') {
  const calls = [];
  return { calls, async query(text, values) {
    calls.push({ text, values });
    return text.includes('current_database') ? { rows: [{ database_name: database }] } : { rows: [], rowCount: 0 };
  } };
}

test('the actual connected database is verified before mutations, not merely a supplied label', async () => {
  const connection = executor('production');
  const adapter = new GuardedPostgresAdapter(connection, 'forgeqa_test_adapter');
  await assert.rejects(adapter.health(), /connected PostgreSQL database/);
  await assert.rejects(adapter.provision('owned'), /connected PostgreSQL database/);
  await assert.rejects(adapter.cleanup({ namespace: 'owned', tenantId: 'owned-tenant' }), /connected PostgreSQL database/);
  await assert.rejects(adapter.reclaimStale('2001-01-01T00:00:00Z', 'forgeqa-owned-'), /connected PostgreSQL database/);
  assert.ok(connection.calls.every(call => call.text.includes('current_database')));
  assert.throws(() => new GuardedPostgresAdapter(connection, 'production', ''), /authorized test target/);
});

test('invalid namespaces, forged ownership, broad prefixes and malformed/future cutoffs fail before querying', async () => {
  const connection = executor(), adapter = new GuardedPostgresAdapter(connection, 'forgeqa_test_adapter');
  for (const value of ['', '../escape', 'x'.repeat(121), "x'; DELETE", undefined]) await assert.rejects(adapter.provision(value));
  await assert.rejects(adapter.cleanup({ namespace: 'owner-a', tenantId: 'owner-b-tenant' }), /declared namespace/);
  for (const prefix of ['forgeqa-', 'forgeqa-%', 'forgeqa-owned%_', 'other-owned', 'forgeqa-\\']) await assert.rejects(adapter.reclaimStale('2001-01-01T00:00:00Z', prefix));
  for (const cutoff of ['bad', '2001-02-30T00:00:00Z', '9999-01-01T00:00:00Z', '2001-01-01']) await assert.rejects(adapter.reclaimStale(cutoff, 'forgeqa-owned-'));
  assert.equal(connection.calls.length, 0);
});

test('reclamation uses literal bound prefixes and retains valid precise UTC timestamps', async () => {
  const connection = executor(), adapter = new GuardedPostgresAdapter(connection, 'forgeqa_test_adapter');
  for (const date of ['2001-01-01T00:00:00Z', '2001-01-01T00:00:00.123Z']) {
    assert.equal(await adapter.reclaimStale(date, 'forgeqa-owner_one-'), 0);
    const call = connection.calls.at(-1);
    assert.doesNotMatch(call.text, /\bLIKE\b/i);
    assert.deepEqual(call.values, ['forgeqa-owner_one-', date]);
    assert.match(call.text, /left\(owner_namespace/);
  }
});

test('provision conflicts cannot masquerade as owned tenants and invalid delete counts cannot pass', async () => {
  const connection = executor();
  const original = connection.query.bind(connection);
  connection.query = async (text, values) => text.includes('current_database') ? original(text, values) : { rows: [{ id: 'owned-tenant', owner_namespace: 'somebody-else' }] };
  const adapter = new GuardedPostgresAdapter(connection, 'forgeqa_test_adapter');
  await assert.rejects(adapter.provision('owned'), /not owned/);
  for (const count of [undefined, -1, 2]) {
    connection.query = async (text, values) => text.includes('current_database') ? original(text, values) : { rows: [], rowCount: count };
    await assert.rejects(adapter.cleanup({ namespace: 'owned', tenantId: 'owned-tenant' }));
  }
});
