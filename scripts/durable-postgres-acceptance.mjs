import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import { setTimeout as pause } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';
import { DurablePostgresAdapter, DURABLE_POSTGRES_SCHEMA } from '@azerish25-ux/forgeqa-test-data';

/** Called only from the already guarded disposable-PostgreSQL acceptance lane. */
export async function acceptDurablePostgres(url) {
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !/^\/forgeqa_test(?:_[a-z0-9_]+)?$/.test(url.pathname)) throw new Error('Durable acceptance requires an authorized laboratory database.');
  const schema = `forgeqa_durable_${randomUUID().replaceAll('-', '')}`;
  const role = `forgeqa_durable_role_${randomUUID().replaceAll('-', '')}`;
  const clients = [0, 1, 2].map(() => new pg.Client({ connectionString: url.href, connectionTimeoutMillis: 10000, statement_timeout: 10000 }));
  const [admin, left, right] = clients;
  const cases = [];
  let created = false, roleCreated = false, child;
  try {
    await Promise.all(clients.map(client => client.connect()));
    await admin.query(`CREATE SCHEMA ${schema}`); created = true;
    await Promise.all(clients.map(client => client.query(`SET search_path TO ${schema}`)));
    await admin.query(DURABLE_POSTGRES_SCHEMA);
    await admin.query(`CREATE ROLE ${role} NOLOGIN`); roleCreated = true;
    await admin.query(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`);
    await admin.query(`GRANT SELECT, INSERT, UPDATE ON forgeqa_test_lease_owners TO ${role}`);
    await admin.query(`GRANT SELECT, INSERT, DELETE ON forgeqa_test_leased_tenants TO ${role}`);
    await Promise.all([left, right].map(client => client.query(`SET ROLE ${role}`)));
    const a = new DurablePostgresAdapter(left, url.pathname.slice(1));
    const b = new DurablePostgresAdapter(right, url.pathname.slice(1));
    const identity = { consumer: 'durable-acceptance', namespace: 'lost-runner', runId: 'surviving' };
    const live = await a.createOwner(identity);
    // ON CONFLICT DO UPDATE needs this column privilege even for a fresh insert.
    // A superuser-only acceptance would conceal an unusable runtime grant recipe.
    await assert.rejects(a.provision(live), error => error.code === '42501');
    await admin.query(`GRANT UPDATE(id) ON forgeqa_test_leased_tenants TO ${role}`);
    const privileges = (await left.query(`SELECT
      has_schema_privilege(current_user, $1, 'CREATE') AS can_create,
      has_column_privilege(current_user, 'forgeqa_test_leased_tenants', 'owner_id', 'UPDATE') AS can_change_owner`, [schema])).rows[0];
    assert.equal(privileges.can_create, false); assert.equal(privileges.can_change_owner, false);
    cases.push('minimal runtime grants permit idempotent use without schema creation or tenant-owner mutation');
    const tenant = await a.provision(live);
    assert.deepEqual(await b.provision(live), tenant);
    assert.deepEqual(await Promise.all([a.provision(live), b.provision(live)]), [tenant, tenant]);
    cases.push('independent connections serialize idempotent tenant provisioning');

    child = fork(fileURLToPath(new URL('../tests/fixtures/durable-postgres-owner.mjs', import.meta.url)), [], {
      env: { ...process.env, DATABASE_URL: url.href, FORGEQA_DURABLE_SCHEMA: schema, FORGEQA_DURABLE_ROLE: role }, silent: true, execArgv: []
    });
    let errorOutput = ''; child.stderr.on('data', chunk => { errorOutput += chunk; }); child.stdout.resume();
    const exited = new Promise(resolve => child.once('exit', resolve));
    const abandoned = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Durable owner startup deadline exceeded.')), 15000);
      child.once('message', message => { clearTimeout(timer); resolve(message); });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Durable owner exited early (${code}): ${errorOutput}`)); });
    });
    child.kill('SIGKILL'); await exited;
    // Poll the authority's actual expiry, never infer expiry from a local wall clock.
    const deadline = performance.now() + 10000;
    while (!(await admin.query('SELECT expires_at <= clock_timestamp() AS expired FROM forgeqa_test_lease_owners WHERE id = $1', [abandoned.owner.id])).rows[0].expired) {
      if (performance.now() >= deadline) throw new Error('Database lease did not expire.');
      await pause(25);
    }
    await assert.rejects(b.renew(abandoned.owner), /expired, sealed/);
    await assert.rejects(b.provision(abandoned.owner), /expired, sealed/);
    const preview = await b.reclaimExpired(identity);
    assert.deepEqual(preview, { dryRun: true, owners: [abandoned.owner.id], tenantsRemoved: 0 });
    assert.equal((await admin.query('SELECT id FROM forgeqa_test_leased_tenants WHERE owner_id = $1', [abandoned.owner.id])).rows.length, 1);
    const recovered = await b.reclaimExpired({ ...identity, apply: true });
    assert.deepEqual(recovered, { dryRun: false, owners: [abandoned.owner.id], tenantsRemoved: 1 });
    assert.deepEqual(await a.provision(live), tenant);
    await assert.rejects(a.renew(abandoned.owner), /expired, sealed/);
    await assert.rejects(a.provision(abandoned.owner), /expired, sealed/);
    assert.equal((await a.reclaimExpired({ ...identity, apply: true })).tenantsRemoved, 0);
    cases.push('hard-killed owner reclaimed without its disk journal; live owner and sealed tombstone protected');

    const expired = await a.createOwner(identity), foreign = await a.createOwner({ ...identity, namespace: 'different' });
    await a.provision(expired); await a.provision(foreign);
    await admin.query("UPDATE forgeqa_test_lease_owners SET expires_at = clock_timestamp() - interval '1 second' WHERE id = ANY($1::uuid[])", [[expired.id, foreign.id]]);
    // A concurrent reaper must skip an in-flight owner transaction, not steal it.
    await left.query('BEGIN');
    await left.query('SELECT id FROM forgeqa_test_lease_owners WHERE id = $1 FOR UPDATE', [expired.id]);
    try { assert.deepEqual((await b.reclaimExpired({ ...identity, apply: true })).owners, []); }
    finally { await left.query('ROLLBACK'); }
    const racers = await Promise.all([a.reclaimExpired({ ...identity, apply: true }), b.reclaimExpired({ ...identity, apply: true })]);
    assert.equal(racers.reduce((sum, report) => sum + report.tenantsRemoved, 0), 1);
    assert.deepEqual(racers.flatMap(report => report.owners), [expired.id]);
    assert.equal((await admin.query('SELECT id FROM forgeqa_test_leased_tenants WHERE owner_id = $1', [foreign.id])).rows.length, 1);
    cases.push('competing reapers, locked owners and foreign exact namespace remain isolated');

    await a.renew(live);
    assert.deepEqual((await b.reclaimExpired({ ...identity, apply: true })).owners, []);
    assert.equal(await a.close(live), 1); assert.equal(await b.close(live), 0);
    await assert.rejects(b.renew(live), /expired, sealed/);
    await assert.rejects(b.provision(live), /expired, sealed/);
    assert.equal(await a.close(foreign), 1);
    assert.equal((await admin.query('SELECT count(*)::integer AS count FROM forgeqa_test_leased_tenants')).rows[0].count, 0);
    cases.push('renewed leases, normal close, lost-ack replay and zero remaining owned tenants');
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    if (created) {
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      assert.equal((await admin.query('SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname = $1) AS present', [schema])).rows[0].present, false);
    }
    await Promise.all([left, right].map(client => client.end()));
    if (roleCreated) {
      await admin.query(`DROP ROLE ${role}`);
      assert.equal((await admin.query('SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname = $1) AS present', [role])).rows[0].present, false);
    }
    await admin.end();
  }
  cases.push('owned durable schema, runtime role and all acceptance resources removed');
  return { status: 'PASS', authority: 'PostgreSQL server clock and row locks', processLoss: 'SIGKILL', localJournalRequired: false, cases };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.env.FORGEQA_ALLOW_ADAPTER_TEST !== '1') throw new Error('Explicit disposable-database authorization is required.');
  const receipt = { schemaVersion: 1, kind: 'forgeqa-durable-postgres-acceptance', sourceSha: process.env.FORGEQA_SOURCE_SHA ?? null, status: 'FAIL' };
  await mkdir('evidence/durable-postgres', { recursive: true });
  try { Object.assign(receipt, await acceptDurablePostgres(new URL(process.env.DATABASE_URL))); }
  catch (error) { receipt.failure = error.message; throw error; }
  finally { await writeFile('evidence/durable-postgres/acceptance.json', `${JSON.stringify(receipt, null, 2)}\n`); }
}
