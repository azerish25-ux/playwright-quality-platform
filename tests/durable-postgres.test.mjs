import test from 'node:test';
import assert from 'node:assert/strict';
import { DurablePostgresAdapter, DURABLE_POSTGRES_SCHEMA } from '../packages/test-data/dist/index.js';

const id = '12345678-1234-4123-8123-123456789abc';
const owner = { id, consumer: 'consumer', namespace: 'exact-namespace', runId: 'run' };
function fixture(response = { rows: [] }) {
  const calls = [];
  const executor = { async query(sql, values) {
    calls.push({ sql, values });
    if (sql.startsWith('SELECT current_database')) return { rows: [{ database_name: 'forgeqa_test_unit' }] };
    if (typeof response === 'function') return response(sql, values);
    return response;
  } };
  return { calls, adapter: new DurablePostgresAdapter(executor, 'forgeqa_test_unit') };
}
test('durable schema has unique ownership, referential integrity and irreversible tombstones', () => {
  assert.match(DURABLE_POSTGRES_SCHEMA, /owner_id uuid NOT NULL UNIQUE REFERENCES/);
  assert.match(DURABLE_POSTGRES_SCHEMA, /CHECK \(state IN \('active', 'sealed'\)\)/);
  assert.doesNotMatch(DURABLE_POSTGRES_SCHEMA, /DROP|TRUNCATE|IF NOT EXISTS/);
});
test('target and ownership arguments fail before any mutation', async () => {
  for (const name of ['production', 'forgeqa_test_evil;DROP', '', null, 'forgeqa_test_' + 'x'.repeat(64)]) assert.throws(() => new DurablePostgresAdapter({}, name));
  const badTarget = new DurablePostgresAdapter({ query: async () => ({ rows: [] }) }, 'forgeqa_test_unit');
  await assert.rejects(badTarget.createOwner(owner), /database identity/);
  const { adapter, calls } = fixture();
  for (const value of [null, {}, { ...owner, consumer: '../escape' }, { ...owner, namespace: '' }, { ...owner, runId: ' ' }]) await assert.rejects(adapter.createOwner(value));
  for (const ttl of [0, 999, 86400001, NaN, 1000.5, '1000']) await assert.rejects(adapter.createOwner(owner, ttl));
  for (const value of [{ ...owner, id: '' }, { ...owner, id: 4 }]) for (const method of ['renew', 'provision', 'close']) await assert.rejects(adapter[method](value));
  await assert.rejects(adapter.renew(owner, 1));
  for (const value of [null, {}, { consumer: 'x', namespace: 'y', limit: 0 }, { consumer: 'x', namespace: 'y', limit: 1001 }, { consumer: 'x', namespace: 'y', apply: 'true' }]) await assert.rejects(adapter.reclaimExpired(value));
  assert.equal(calls.length, 0);
});
test('owner creation uses fresh identities and the database clock, with acknowledgment verification', async () => {
  const { adapter, calls } = fixture((_sql, values) => ({ rows: [{ id: values[0] }] }));
  const a = await adapter.createOwner(owner), b = await adapter.createOwner(owner, 1000);
  assert.notEqual(a.id, b.id); assert.equal(Object.isFrozen(a), true);
  assert.equal(a.namespace, owner.namespace);
  assert.match(calls[1].sql, /clock_timestamp\(\)/);
  assert.equal(calls[1].values[4], 60000); assert.equal(calls[3].values[4], 1000);
  await assert.rejects(fixture().adapter.createOwner(owner), /not acknowledged/);
});
test('expired and sealed renewal cannot revive ownership and SQL is precisely scoped', async () => {
  const { adapter, calls } = fixture({ rows: [{ id }] });
  await adapter.renew(owner);
  assert.deepEqual(calls[1].values, [id, owner.consumer, owner.namespace, owner.runId, 60000]);
  assert.match(calls[1].sql, /state = 'active' AND expires_at > clock_timestamp\(\)/);
  for (const rows of [[], [{ id: 'foreign' }], [{ id }, { id }]]) await assert.rejects(fixture({ rows }).adapter.renew(owner), /expired, sealed/);
});
test('provision is atomic, row-locked and refuses foreign or stale ownership', async () => {
  const row = { id: `forgeqa-${id}-tenant`, owner_id: id };
  const { adapter, calls } = fixture({ rows: [row] });
  assert.deepEqual(await adapter.provision(owner), { id: row.id, ownerId: id });
  assert.match(calls[1].sql, /FOR UPDATE/); assert.match(calls[1].sql, /ON CONFLICT \(owner_id\) DO UPDATE/);
  assert.match(calls[1].sql, /forgeqa_test_leased_tenants.id = EXCLUDED.id/);
  for (const rows of [[], [{ ...row, id: 'foreign' }], [{ ...row, owner_id: 'foreign' }], [row, row]]) await assert.rejects(fixture({ rows }).adapter.provision(owner), /refused/);
});
test('close seals and deletes in one statement, validating cleanup receipts', async () => {
  const { adapter, calls } = fixture({ rows: [{ removed: 1 }] });
  assert.equal(await adapter.close(owner), 1);
  assert.match(calls[1].sql, /SET state = 'sealed'/);
  assert.match(calls[1].sql, /tenant.owner_id = owner.id/);
  assert.equal(await fixture({ rows: [{ removed: 0 }] }).adapter.close(owner), 0);
  for (const rows of [[], [{ removed: -1 }], [{ removed: '1' }], [{ removed: 1001 }], [{ removed: 1 }, { removed: 2 }]]) await assert.rejects(fixture({ rows }).adapter.close(owner), /cleanup count/);
});
test('recovery defaults to nonmutating exact-scope dry run', async () => {
  const { adapter, calls } = fixture({ rows: [{ id }] });
  assert.deepEqual(await adapter.reclaimExpired(owner), { dryRun: true, owners: [id], tenantsRemoved: 0 });
  assert.doesNotMatch(calls[1].sql, /UPDATE|DELETE/);
  assert.deepEqual(calls[1].values, [owner.consumer, owner.namespace, 100]);
  assert.match(calls[1].sql, /expires_at <= clock_timestamp\(\)/);
});
test('reapers skip locked owners and atomically seal and delete with bounded receipts', async () => {
  const { adapter, calls } = fixture({ rows: [{ owners: [id], removed: 1 }] });
  assert.deepEqual(await adapter.reclaimExpired({ ...owner, limit: 1, apply: true }), { dryRun: false, owners: [id], tenantsRemoved: 1 });
  assert.match(calls[1].sql, /FOR UPDATE SKIP LOCKED/);
  assert.match(calls[1].sql, /tenant.owner_id = sealed.id/);
  assert.doesNotMatch(calls[1].sql, /DELETE FROM forgeqa_test_lease_owners/);
  for (const rows of [[], [{ owners: null, removed: 0 }], [{ owners: ['bad'], removed: 0 }], [{ owners: [id, id], removed: 0 }]]) await assert.rejects(fixture({ rows }).adapter.reclaimExpired({ ...owner, apply: true }), /receipt|inventory/);
  await assert.rejects(fixture({ rows: [{ id }, { id: 'aaaaaaaa-1234-4123-8123-123456789abc' }] }).adapter.reclaimExpired({ ...owner, limit: 1 }), /inventory/);
});
test('unavailable authority fails closed and never becomes an empty successful inventory', async () => {
  const adapter = new DurablePostgresAdapter({ query: async () => { throw new Error('authority unavailable'); } }, 'forgeqa_test_unit');
  for (const method of ['createOwner', 'renew', 'provision', 'close', 'reclaimExpired']) await assert.rejects(adapter[method](owner), /authority unavailable/);
});
