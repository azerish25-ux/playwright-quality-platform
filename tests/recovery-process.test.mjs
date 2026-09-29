import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, realpath, rm, stat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
const helper = fileURLToPath(new URL('./helpers/recovery-process.mjs', import.meta.url));
async function root(t) { const path = await mkdtemp(join(await realpath(tmpdir()), 'forgeqa killed Ω ')); t.after(() => rm(path, { recursive: true, force: true })); return path; }
function message(child, type) { return new Promise((resolve, reject) => {
  const timer = setTimeout(() => finish(new Error(`Child did not send ${type}: ${child.diagnostics}`)), 20_000);
  const onMessage = data => { if (data.type === type) finish(null, data); };
  const onExit = (code, signal) => finish(new Error(`Child exited before ${type}: ${code}/${signal}: ${child.diagnostics}`));
  function finish(error, value) { clearTimeout(timer); child.off('message', onMessage); child.off('exit', onExit); error ? reject(error) : resolve(value); }
  child.on('message', onMessage); child.once('exit', onExit); child.once('error', error => finish(error));
}); }
function child(t, mode, root, namespace = 'killed-owner', endpoint = '') {
  const processChild = spawn(process.execPath, [helper, mode, root, namespace, endpoint], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  processChild.diagnostics = ''; for (const stream of [processChild.stdout, processChild.stderr]) stream.on('data', data => { processChild.diagnostics = (processChild.diagnostics + data).slice(-16_384); });
  t.after(async () => { if (processChild.exitCode === null && processChild.signalCode === null) await kill(processChild); });
  return processChild;
}
async function kill(processChild) { const closed = once(processChild, 'close'); processChild.kill('SIGKILL'); await closed; }
async function recover(t, path, mode = 'recover', endpoint = '') {
  const processChild = child(t, mode, path, 'reclaimer', endpoint), response = await message(processChild, 'result');
  await once(processChild, 'close'); assert.equal(processChild.exitCode, 0, processChild.diagnostics); return response.result;
}
async function lab(t, onCreate) {
  const accounts = new Map([['unrelated', { namespace: 'unrelated' }]]); let deletions = 0;
  const server = createServer(async (request, response) => {
    const namespace = decodeURIComponent(new URL(request.url, 'http://localhost').pathname.slice('/accounts/'.length));
    if (request.method === 'POST') { if (accounts.has(namespace) && accounts.get(namespace).ownerId !== request.headers['x-owner-id']) { response.statusCode = 409; response.end(); return; } accounts.set(namespace, { namespace, ownerId: request.headers['x-owner-id'] }); if (onCreate && await onCreate(namespace)) return; response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(accounts.get(namespace))); }
    else if (request.method === 'GET') { response.statusCode = accounts.has(namespace) ? 200 : 404; response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(accounts.get(namespace) ?? {})); }
    else if (request.method === 'DELETE') { if (request.headers['x-owner-namespace'] !== namespace || (accounts.has(namespace) && request.headers['x-owner-id'] !== accounts.get(namespace).ownerId)) { response.statusCode = 403; response.end(); return; } if (accounts.delete(namespace)) deletions++; response.statusCode = 204; response.end(); }
    else { response.statusCode = 405; response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return { accounts, endpoint: `http://127.0.0.1:${server.address().port}`, deletions: () => deletions };
}

test('fresh-process recovery removes killed-worker private files and preserves a live peer', { timeout: 30_000 }, async t => {
  const path = await root(t), killed = child(t, 'files', path, 'abandoned'); const deadState = await message(killed, 'ready');
  const active = child(t, 'files', path, 'active'); const activeState = await message(active, 'ready');
  await kill(killed);
  const planned = await recover(t, path, 'dry-run'); assert(planned.events.some(event => event.status === 'eligible')); assert.equal(planned.reclaimed, 0); assert((await stat(deadState.directory)).isDirectory());
  const result = await recover(t, path); assert.equal(result.incomplete, false); assert.equal(result.reclaimed, 1); assert(result.events.some(event => event.status === 'active'));
  await assert.rejects(stat(deadState.directory), { code: 'ENOENT' }); assert.equal(await readFile(join(activeState.directory, 'private-state.json'), 'utf8'), 'credential-canary');
  assert.equal((await recover(t, path)).reclaimed, 0); await kill(active); assert.equal((await recover(t, path)).reclaimed, 1);
});
test('killed authentication owner leaves recoverable remote intent and private state, not reusable credentials', { timeout: 30_000 }, async t => {
  const path = await root(t), remote = await lab(t), processChild = child(t, 'authentication', path, 'owned-account', remote.endpoint);
  const ready = await message(processChild, 'ready'); assert(remote.accounts.has('owned-account')); await kill(processChild);
  const report = await recover(t, path, 'recover', remote.endpoint); assert.equal(report.incomplete, false); assert.equal(report.reclaimed, 2);
  assert.equal(remote.accounts.has('owned-account'), false); assert(remote.accounts.has('unrelated')); assert.equal(remote.deletions(), 1);
  await assert.rejects(stat(ready.statePath), { code: 'ENOENT' }); assert.doesNotMatch(JSON.stringify(report), /credential-canary/);
  assert.equal((await recover(t, path, 'recover', remote.endpoint)).reclaimed, 0);
});
test('a crash after server acquisition but before the response is covered by durable pre-acquisition intent', { timeout: 30_000 }, async t => {
  const path = await root(t); let created; const createdPromise = new Promise(resolve => { created = resolve; });
  const remote = await lab(t, async namespace => { if (namespace === 'mid-acquisition') { created(); return true; } return false; });
  const processChild = child(t, 'authentication', path, 'mid-acquisition', remote.endpoint);
  await createdPromise; await kill(processChild); assert(remote.accounts.has('mid-acquisition'));
  const report = await recover(t, path, 'recover', remote.endpoint); assert.equal(report.incomplete, false); assert.equal(report.reclaimed, 1); assert.equal(remote.accounts.has('mid-acquisition'), false); assert(remote.accounts.has('unrelated'));
});
test('a live reclaimer cannot lose its claim; killing it allows a new generation to resume cleanup', { timeout: 30_000 }, async t => {
  const path = await root(t), remote = await lab(t), original = child(t, 'authentication', path, 'resume-account', remote.endpoint);
  await message(original, 'ready'); await kill(original);
  const blocked = child(t, 'blocked-reclaimer', path, 'reclaimer', remote.endpoint); await message(blocked, 'cleanup-started');
  const other = await recover(t, path, 'recover', remote.endpoint); assert(other.events.some(event => event.status === 'busy')); assert.equal(other.reclaimed, 0); assert(remote.accounts.has('resume-account'));
  await kill(blocked);
  const resumed = await recover(t, path, 'recover', remote.endpoint); assert.equal(resumed.incomplete, false); assert.equal(resumed.reclaimed, 1); assert.equal(remote.accounts.has('resume-account'), false); assert.equal(remote.deletions(), 1);
});
test('a dead process is not enough to bypass a configured minimum grace period', { timeout: 30_000 }, async t => {
  const path = await root(t), original = child(t, 'grace', path); const ready = await message(original, 'ready'); await kill(original);
  const result = await recover(t, path); assert.equal(result.reclaimed, 0); assert.equal(result.events[0].status, 'grace'); assert((await stat(ready.directory)).isDirectory());
});

test('a conflicting authentication owner cannot reclaim an active account with the same logical name', { timeout: 30_000 }, async t => {
  const path = await root(t), remote = await lab(t), active = child(t, 'authentication', path, 'shared-name', remote.endpoint);
  await message(active, 'ready'); const ownerId = remote.accounts.get('shared-name').ownerId;
  const conflict = child(t, 'authentication', path, 'shared-name', remote.endpoint);
  await once(conflict, 'close'); assert.equal(conflict.exitCode, 1, conflict.diagnostics);
  const report = await recover(t, path, 'recover', remote.endpoint);
  assert.equal(report.reclaimed, 0); assert.equal(report.incomplete, true);
  assert.equal(remote.accounts.get('shared-name').ownerId, ownerId); assert.equal(remote.deletions(), 0);
  await kill(active);
  const final = await recover(t, path, 'recover', remote.endpoint);
  assert.equal(remote.accounts.has('shared-name'), false); assert.equal(remote.deletions(), 1);
  assert(final.reclaimed >= 2);
});
