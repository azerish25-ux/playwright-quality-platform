import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, readdir, readFile, writeFile, stat, rename, symlink, link, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { RecoveryJournal, recoverResources, OWNED_FILES_ADAPTER } from '@azerish25-ux/forgeqa-core';
import { GuardedPostgresAdapter } from '@azerish25-ux/forgeqa-test-data';
const identity = namespace => ({ runId: 'test-run', consumer: 'recovery-unit', namespace });
async function root(t) { const path = await mkdtemp(join(await realpath(tmpdir()), 'forgeqa-recovery-unit-')); t.after(() => rm(path, { recursive: true, force: true })); return path; }
async function owner(t, namespace = 'owned', options = {}) { return RecoveryJournal.create(identity(namespace), { root: await root(t), graceMs: 0, ...options }); }
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const adapter = (reclaim = async () => {}) => ({ id: 'unit-resource-v1', target: 'test-target', reclaim });
const reserve = (journal, key = 'owned') => journal.reserve({ adapter: 'unit-resource-v1', target: 'test-target', key });

 test('recovery is a side-effect-free dry-run when no journal root exists', async t => {
  const path = join(await root(t), 'absent');
  const result = await recoverResources({ root: path });
  assert.equal(result.dryRun, true); assert.equal(result.ownersScanned, 0);
  await assert.rejects(stat(path), { code: 'ENOENT' });
});
test('live owners remain protected after grace expiry in dry-run and apply', async t => {
  const journal = await owner(t); const files = await journal.createDirectory();
  await writeFile(join(files.directory, 'private'), 'credential-canary', { mode: 0o600 });
  for (const apply of [false, true]) {
    const result = await recoverResources({ root: journal.root, apply });
    assert.equal(result.incomplete, false); assert.equal(result.events[0].status, 'active'); assert.equal(result.reclaimed, 0);
    assert.equal(await readFile(join(files.directory, 'private'), 'utf8'), 'credential-canary');
  }
  await journal.close();
});
test('retired owners are planned without mutations, then reclaimed idempotently', async t => {
  const journal = await owner(t); const files = await journal.createDirectory(); await journal.close();
  const before = await readdir(journal.path);
  const plan = await recoverResources({ root: journal.root });
  assert.equal(plan.events[0].status, 'eligible'); assert.deepEqual(await readdir(journal.path), before);
  assert((await stat(files.directory)).isDirectory());
  const applied = await recoverResources({ root: journal.root, apply: true });
  assert.equal(applied.reclaimed, 1); assert.equal(applied.incomplete, false);
  await assert.rejects(stat(files.directory), { code: 'ENOENT' });
  assert.equal((await recoverResources({ root: journal.root, apply: true })).reclaimed, 0);
});
test('exact consumer and namespace filters never become prefix-wide cleanup', async t => {
  const path = await root(t), first = await RecoveryJournal.create(identity('owned'), { root: path }), other = await RecoveryJournal.create(identity('owned-neighbour'), { root: path });
  const a = await first.createDirectory(), b = await other.createDirectory(); await first.close(); await other.close();
  assert.equal((await recoverResources({ root: path, consumer: 'foreign', apply: true })).reclaimed, 0);
  assert.equal((await recoverResources({ root: path, namespace: 'owned', apply: true })).reclaimed, 1);
  await assert.rejects(stat(a.directory), { code: 'ENOENT' }); assert((await stat(b.directory)).isDirectory());
});
test('reserve is durable before acquisition; fabricated or completed intents cannot acquire', async t => {
  const journal = await owner(t), record = await reserve(journal);
  const name = (await readdir(journal.path)).find(name => name.startsWith('resource-'));
  assert.deepEqual(JSON.parse(await readFile(join(journal.path, name), 'utf8')), record);
  assert.equal(await journal.acquire(record, async () => 42), 42);
  for (const bad of [{ ...record, key: 'foreign' }, { ...record, id: randomUUID() }, { ...record, ownerId: randomUUID() }]) await assert.rejects(journal.acquire(bad, async () => assert.fail()));
  await journal.complete(record); await journal.complete(record);
  await assert.rejects(journal.acquire(record, async () => assert.fail()), /complete/);
  await journal.close(); await assert.rejects(journal.reserve(record), /closed/);
});
test('in-flight acquisitions cannot be acknowledged, disposed, or retired after a timeout', async t => {
  const journal = await owner(t), record = await reserve(journal), gate = deferred(), entered = deferred();
  const pending = journal.acquire(record, async () => { entered.resolve(); await gate.promise; }); await entered.promise;
  await assert.rejects(journal.complete(record), /still-acquiring/);
  await assert.rejects(journal.dispose(record, adapter(), new AbortController().signal), /active/);
  await assert.rejects(journal.acquire(record, async () => assert.fail()), /acquisition/);
  await assert.rejects(journal.close(), /in-flight/);
  assert.equal((await recoverResources({ root: journal.root, apply: true })).events[0].status, 'active');
  gate.resolve(); await pending;
});
test('normal adapter disposal verifies identity, remains idempotent, and preserves failed intents', async t => {
  const journal = await owner(t), record = await reserve(journal); let calls = 0;
  const good = adapter(async () => { calls++; });
  await assert.rejects(journal.dispose(record, { ...good, target: 'wrong' }, new AbortController().signal), /mismatched/);
  await assert.rejects(journal.dispose(record, adapter(async () => { throw new Error('private error'); }), new AbortController().signal));
  assert.equal((await readdir(journal.path)).filter(name => name.startsWith('done-')).length, 0);
  await journal.dispose(record, good, new AbortController().signal); await journal.dispose(record, good, new AbortController().signal);
  assert.equal(calls, 1); await journal.close();
});
test('unknown adapters fail closed and do not load code from journal records', async t => {
  const journal = await owner(t); await reserve(journal); await journal.close();
  const result = await recoverResources({ root: journal.root, apply: true });
  assert.equal(result.incomplete, true); assert.equal(result.reclaimed, 0); assert.equal(result.events[0].reason, 'trusted-adapter-required');
  assert.equal((await recoverResources({ root: journal.root, apply: true, adapters: [adapter()] })).reclaimed, 1);
});
test('partial adapter failure preserves pending intent, redacts diagnostics and permits retry', async t => {
  const journal = await owner(t); await reserve(journal, 'first'); await reserve(journal, 'second'); await journal.close();
  const order = []; const incomplete = await recoverResources({ root: journal.root, apply: true, adapters: [adapter(async record => {
    order.push(record.key); if (record.key === 'first') throw new Error('secret-cookie=credential-canary');
  })] });
  assert.deepEqual(order, ['second', 'first']); assert.equal(incomplete.incomplete, true); assert.equal(incomplete.reclaimed, 1);
  assert.doesNotMatch(JSON.stringify(incomplete), /credential-canary|secret-cookie/);
  const repeated = [];
  assert.equal((await recoverResources({ root: journal.root, apply: true, adapters: [adapter(async record => repeated.push(record.key))] })).reclaimed, 1);
  assert.deepEqual(repeated, ['first']);
});
test('an uncooperative timed-out cleanup retains its claim instead of overlapping another callback', async t => {
  const journal = await owner(t); await reserve(journal); await journal.close();
  const gate = deferred();
  const result = await recoverResources({ root: journal.root, apply: true, timeoutMs: 5, adapters: [adapter(() => gate.promise)] });
  assert.equal(result.incomplete, true); assert.equal(result.events[0].status, 'failed');
  const other = await recoverResources({ root: journal.root, apply: true, adapters: [adapter(() => assert.fail('must not overlap'))] });
  assert.equal(other.events[0].status, 'busy'); gate.resolve();
});
test('foreign PID namespaces cannot be reclaimed solely because their leases have expired', async t => {
  const journal = await owner(t); await journal.createDirectory();
  const path = join(journal.path, 'owner.json'), value = JSON.parse(await readFile(path, 'utf8')); value.host = 'f'.repeat(64); await writeFile(path, JSON.stringify(value), { mode: 0o600 });
  const report = await recoverResources({ root: journal.root, apply: true });
  assert.equal(report.reclaimed, 0); assert.equal(report.events[0].status, 'foreign-host');
});
test('corrupt or future owner metadata is refused without deleting files', async t => {
  for (const corrupt of ['{', JSON.stringify({ schemaVersion: 99 })]) {
    const journal = await owner(t); const files = await journal.createDirectory(); await journal.close();
    await writeFile(join(journal.path, 'owner.json'), corrupt, { mode: 0o600 });
    const report = await recoverResources({ root: journal.root, apply: true }); assert.equal(report.incomplete, true); assert.equal(report.reclaimed, 0); assert((await stat(files.directory)).isDirectory());
  }
});
test('foreign resource identities and traversal keys are rejected before adapter invocation', async t => {
  const journal = await owner(t); await reserve(journal); await journal.close();
  const path = join(journal.path, (await readdir(journal.path)).find(name => name.startsWith('resource-')));
  const original = JSON.parse(await readFile(path, 'utf8'));
  for (const value of [{ ...original, ownerId: randomUUID() }, { ...original, key: '../foreign' }, { ...original, callback: '/some/file' }]) {
    await writeFile(path, JSON.stringify(value), { mode: 0o600 });
    const result = await recoverResources({ root: journal.root, apply: true, adapters: [adapter(() => assert.fail())] });
    assert.equal(result.incomplete, true); assert.equal(result.reclaimed, 0);
  }
});
test('replaced private directories and symlink metadata cannot redirect deletion', async t => {
  const journal = await owner(t), files = await journal.createDirectory(), outside = await root(t);
  await writeFile(join(outside, 'sentinel'), 'keep'); await journal.close();
  const moved = files.directory + '-original'; await rename(files.directory, moved);
  await symlink(outside, files.directory, process.platform === 'win32' ? 'junction' : 'dir');
  const result = await recoverResources({ root: journal.root, apply: true });
  assert.equal(result.incomplete, true); assert.equal(result.reclaimed, 0); assert.equal(await readFile(join(outside, 'sentinel'), 'utf8'), 'keep');
  await rm(files.directory, { force: true, recursive: true }); await rename(moved, files.directory);
  const ownerPath = join(journal.path, 'owner.json'); await rename(ownerPath, join(outside, 'owner.json'));
  // A directory junction is sufficient to exercise metadata symlink rejection without Windows privileges.
  await symlink(outside, ownerPath, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await recoverResources({ root: journal.root, apply: true })).reclaimed, 0);
});
test('hardlinked metadata, unsafe root permissions and tampered root markers are refused', async t => {
  const journal = await owner(t); await journal.createDirectory(); await journal.close();
  const outside = await root(t); await link(join(journal.path, 'owner.json'), join(outside, 'hardlinked-owner'));
  assert.equal((await recoverResources({ root: journal.root, apply: true })).incomplete, true);
  if (process.platform !== 'win32') { await chmod(journal.root, 0o755); await assert.rejects(recoverResources({ root: journal.root }), /Unsafe/); await chmod(journal.root, 0o700); }
  await writeFile(join(journal.root, 'root.json'), '{}', { mode: 0o600 }); await assert.rejects(recoverResources({ root: journal.root }), /record/);
});
test('pending empty directory allocation is recoverable, but unstamped nonempty data is refused', async t => {
  for (const hasData of [false, true]) {
    const journal = await owner(t), files = await journal.createDirectory();
    await rm(join(journal.path, `directory-${files.record.id}.json`)); if (hasData) await writeFile(join(files.directory, 'unexpected'), 'keep'); await journal.close();
    const result = await recoverResources({ root: journal.root, apply: true });
    assert.equal(result.reclaimed, hasData ? 0 : 1); assert.equal(result.incomplete, hasData);
  }
});
test('invalid options, descriptor values and reserved adapter injection fail before cleanup', async t => {
  const journal = await owner(t);
  for (const graceMs of [-1, NaN, 1.5, 86_400_001]) await assert.rejects(RecoveryJournal.create(identity('safe'), { root: journal.root, graceMs }));
  for (const value of [{ runId: '', consumer: 'test', namespace: 'a' }, identity('../escape')]) await assert.rejects(RecoveryJournal.create(value, { root: journal.root }));
  for (const value of [{ adapter: 'valid', target: 'test', key: '../escape' }, { adapter: OWNED_FILES_ADAPTER, target: 'foreign', key: 'key' }]) await assert.rejects(journal.reserve(value));
  for (const options of [{ timeoutMs: 0 }, { budgetMs: Infinity }, { maxOwners: 0 }, { consumer: '' }, { namespace: '../escape' }, { adapters: [adapter(), adapter()] }, { adapters: [{ ...adapter(), id: OWNED_FILES_ADAPTER }] }]) await assert.rejects(recoverResources({ root: journal.root, ...options }));
  await journal.close();
});
test('owner scan limits report incomplete rather than pretending all resources were considered', async t => {
  const path = await root(t);
  for (const namespace of ['a', 'b']) { const journal = await RecoveryJournal.create(identity(namespace), { root: path }); await journal.createDirectory(); await journal.close(); }
  const result = await recoverResources({ root: path, maxOwners: 1 }); assert.equal(result.incomplete, true); assert.equal(result.ownersScanned, 1);
});
test('PostgreSQL recovery uses the guarded adapter and exact journal namespace, never a prefix sweep', async t => {
  const journal = await owner(t, 'forgeqa-owned'); const rows = new Map(); const queries = [];
  const sql = { async query(text, values = []) { queries.push(text);
    if (text.startsWith('SELECT current_database')) return { rows: [{ database_name: 'forgeqa_test_lab' }] };
    if (text.startsWith('INSERT')) { rows.set(values[0], values[1]); return { rows: [{ id: values[0], owner_namespace: values[1] }] }; }
    if (text.startsWith('DELETE')) { const owned = rows.get(values[0]) === values[1]; if (owned) rows.delete(values[0]); return { rows: [], rowCount: owned ? 1 : 0 }; }
    throw new Error('Unexpected query');
  } };
  const pg = new GuardedPostgresAdapter(sql, 'forgeqa_test_lab');
  const { provision, record } = await pg.provisionRecoverable(journal);
  const active = await RecoveryJournal.create(identity('forgeqa-owned'), { root: journal.root });
  const second = await pg.provisionRecoverable(active); assert.notEqual(provision.tenantId, second.provision.tenantId);
  rows.set('neighbour', 'foreign'); await journal.close();
  const trusted = pg.recoveryAdapter();
  await assert.rejects(trusted.reclaim({ ...record, key: 'neighbour' }, journal.owner, new AbortController().signal), /exact owned/);
  assert.equal((await recoverResources({ root: journal.root, apply: true, adapters: [trusted] })).reclaimed, 1);
  assert.equal(rows.has(provision.tenantId), false); assert.equal(rows.get('neighbour'), 'foreign');
  assert.equal(rows.get(second.provision.tenantId), second.provision.namespace);
  await active.dispose(second.record, trusted, new AbortController().signal); await active.close();
  assert(queries.every(text => !text.includes('left(owner_namespace')));
});

test('Unicode ownership labels are preserved and exact filtered without becoming paths', async t => {
  const path = await root(t);
  const journal = await RecoveryJournal.create({ runId: 'run Ω', consumer: 'SaaS équipe', namespace: 'tenant Ω' }, { root: path });
  await journal.createDirectory(); await journal.close();
  assert.equal((await recoverResources({ root: path, apply: true, consumer: 'SaaS', namespace: 'tenant Ω' })).reclaimed, 0);
  assert.equal((await recoverResources({ root: path, apply: true, consumer: 'SaaS équipe', namespace: 'tenant Ω' })).reclaimed, 1);
});
test('creating a root through a symlink cannot write into the foreign directory', async t => {
  const path = await root(t), foreign = await root(t), alias = join(path, 'alias');
  await symlink(foreign, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(RecoveryJournal.create(identity('safe'), { root: join(alias, 'must-not-create') }), /Unsafe/);
  assert.deepEqual(await readdir(foreign), []);
});
test('runtime callers cannot accidentally enable apply with a non-boolean value', async t => {
  const journal = await owner(t); await journal.createDirectory(); await journal.close();
  for (const value of ['false', 1, null]) await assert.rejects(recoverResources({ root: journal.root, apply: value }));
  for (const adapters of [null, {}, [null]]) await assert.rejects(recoverResources({ root: journal.root, adapters }));
  assert.equal((await recoverResources({ root: journal.root })).events[0].status, 'eligible');
});
