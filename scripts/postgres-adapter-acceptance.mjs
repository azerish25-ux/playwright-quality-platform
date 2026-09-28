import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';
import { GuardedPostgresAdapter } from '@azerish25-ux/forgeqa-test-data';

if (process.env.FORGEQA_ALLOW_ADAPTER_TEST !== '1' && process.env.TEAMBOARD_TEST_MODE !== '1') throw new Error('PostgreSQL adapter acceptance needs explicit disposable-database authorization.');
const url = new URL(process.env.DATABASE_URL);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !/^\/forgeqa_test(?:_[a-z0-9_]+)?$/.test(url.pathname)) throw new Error('Refusing a non-laboratory database.');
const databaseName = url.pathname.slice(1);
const connection = new pg.Client({ connectionString: url.href, connectionTimeoutMillis: 10000, statement_timeout: 10000 });
const evidence = { schemaVersion: 1, kind: 'forgeqa-real-postgres-adapter', sourceSha: process.env.FORGEQA_SOURCE_SHA, status: 'FAIL', cases: [] };
const output = resolve('evidence/postgres-adapter');
await mkdir(output, { recursive: true });
await connection.connect();
try {
  // A connection-owned temporary table exercises real PostgreSQL while never
  // creating, rewriting or deleting TeamBoard's persistent application tables.
  await connection.query('CREATE TEMP TABLE forgeqa_test_tenants (id text PRIMARY KEY, owner_namespace text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())');
  const adapter = new GuardedPostgresAdapter(connection, databaseName, 'forgeqa_test');
  await adapter.health();
  await assert.rejects(new GuardedPostgresAdapter(connection, 'forgeqa_test_wrong').health(), /connected PostgreSQL database/);
  evidence.cases.push('actual database identity');

  const first = await adapter.provision('forgeqa-first');
  const other = await adapter.provision('forgeqa-other');
  assert.deepEqual(await adapter.provision('forgeqa-first'), first);
  evidence.cases.push('idempotent real provisioning');

  await assert.rejects(adapter.cleanup({ namespace: first.namespace, tenantId: other.tenantId }), /declared namespace/);
  await adapter.cleanup(first);
  await adapter.cleanup(first);
  assert.equal((await connection.query('SELECT id FROM forgeqa_test_tenants WHERE id = $1', [other.tenantId])).rows.length, 1);
  evidence.cases.push('idempotent cleanup preserves another namespace');

  await connection.query('INSERT INTO forgeqa_test_tenants (id, owner_namespace) VALUES ($1, $2)', ['forgeqa-collision-tenant', 'forgeqa-other']);
  await assert.rejects(adapter.provision('forgeqa-collision'), /not owned/);
  evidence.cases.push('provision collision rejects foreign ownership');

  await connection.query('INSERT INTO forgeqa_test_tenants (id, owner_namespace, created_at) VALUES ($1, $2, $3), ($4, $5, $6), ($7, $8, $9)', [
    'old-owned', 'forgeqa-owner_one-old', '2000-01-01T00:00:00Z',
    'old-neighbour', 'forgeqa-ownerXone-old', '2000-01-01T00:00:00Z',
    'recent-owned', 'forgeqa-owner_one-recent', '2020-01-01T00:00:00Z'
  ]);
  assert.equal(await adapter.reclaimStale('2001-01-01T00:00:00Z', 'forgeqa-owner_one-'), 1);
  assert.equal(await adapter.reclaimStale('2001-01-01T00:00:00Z', 'forgeqa-owner_one-'), 0);
  const retained = (await connection.query("SELECT id FROM forgeqa_test_tenants WHERE id IN ('old-neighbour', 'recent-owned') ORDER BY id")).rows.map(row => row.id);
  assert.deepEqual(retained, ['old-neighbour', 'recent-owned']);
  evidence.cases.push('literal underscore prefix and age boundary');

  for (const prefix of ['forgeqa-', 'forgeqa-%']) await assert.rejects(adapter.reclaimStale('2001-01-01T00:00:00Z', prefix));
  for (const cutoff of ['invalid', '9999-01-01T00:00:00Z']) await assert.rejects(adapter.reclaimStale(cutoff, 'forgeqa-owner_one-'));
  evidence.cases.push('unsafe reclamation arguments refused');
  await connection.query('DROP TABLE pg_temp.forgeqa_test_tenants');
  assert.equal((await connection.query("SELECT to_regclass('pg_temp.forgeqa_test_tenants') AS remaining")).rows[0].remaining, null);
  evidence.cases.push('owned temporary table removed');
  evidence.status = 'PASS';
} catch (error) {
  evidence.failure = error.message;
  throw error;
} finally {
  await connection.end();
  await writeFile(resolve(output, 'acceptance.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence));
}
