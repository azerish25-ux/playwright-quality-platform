// Child-process fault-injection harness. No browser is needed for the recovery protocol.
import { RecoveryJournal, recoverResources } from '@azerish25-ux/forgeqa-core';
import { AuthenticationManager } from '../../packages/playwright/dist/authentication.js';
import { OwnedFiles } from '../../packages/playwright/dist/owned-files.js';
const [mode, root, namespace = 'killed-owner', endpoint = ''] = process.argv.slice(2);
const identity = { runId: 'recovery-process-test', consumer: 'recovery-process', namespace };
const send = value => new Promise((resolve, reject) => process.send(value, error => error ? reject(error) : resolve()));
const hold = () => new Promise(() => { setInterval(() => {}, 60_000); });
const adapter = {
  id: 'test-http-account-v1', target: 'disposable-loopback-lab',
  async reclaim(record, owner, signal) {
    if (record.key !== owner.namespace || record.target !== this.target || record.ownerId !== owner.id) throw new Error('Refusing foreign account.');
    const url = new URL(`/accounts/${encodeURIComponent(record.key)}`, endpoint);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') throw new Error('Disposable loopback lab required.');
    if (mode === 'blocked-reclaimer') { await send({ type: 'cleanup-started' }); return hold(); }
    const found = await fetch(url, { signal });
    if (found.status === 404) return;
    if (!found.ok) throw new Error('Remote lookup failed.');
    const remote = await found.json();
    if (remote.namespace !== owner.namespace || remote.ownerId !== owner.id) throw new Error('Remote ownership mismatch.');
    const removed = await fetch(url, { method: 'DELETE', signal, headers: { 'x-owner-namespace': owner.namespace, 'x-owner-id': owner.id } });
    if (![204, 404].includes(removed.status)) throw new Error('Owned account cleanup failed.');
  },
};
try {
  if (mode === 'files') {
    const files = await OwnedFiles.create(1024, { root, graceMs: 0, identity });
    await files.write('private-state.json', 'credential-canary');
    await send({ type: 'ready', directory: files.directory }); await hold();
  } else if (mode === 'authentication') {
    const manager = new AuthenticationManager({
      id: 'test-http-authentication-v1',
      recovery: { adapter, key: id => id.namespace },
      async authenticate(id, _scope, signal, recovery) {
        const response = await fetch(new URL(`/accounts/${id.namespace}`, endpoint), { method: 'POST', signal, headers: { 'x-owner-id': recovery.owner.id } });
        if (!response.ok) throw new Error('Provision failed.'); return response.json();
      },
      async validate(session, id) { return session.namespace === id.namespace; },
      async storageState() { return { cookies: [{ name: 'session', value: 'credential-canary' }], origins: [] }; },
    }, { reuse: 'worker', recovery: { root, graceMs: 0 } });
    await manager.withSession({ ...identity, application: identity.consumer, environment: 'local', role: 'owner', project: 'api',
      configHash: 'config', shard: 1, parallelIndex: 0, workerIndex: 0 }, async (_session, statePath) => {
      await send({ type: 'ready', statePath }); await hold();
    });
  } else if (mode === 'grace') {
    const journal = await RecoveryJournal.create(identity, { root, graceMs: 86_400_000 });
    const allocation = await journal.createDirectory();
    await send({ type: 'ready', directory: allocation.directory }); await hold();
  } else {
    const result = await recoverResources({ root, apply: mode !== 'dry-run', adapters: [adapter] });
    await send({ type: 'result', result }); process.disconnect();
  }
} catch (error) { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; process.disconnect?.(); }
