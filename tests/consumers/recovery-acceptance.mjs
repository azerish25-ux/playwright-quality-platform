import assert from 'node:assert/strict';
import { fork, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { RecoveryJournal } from '@azerish25-ux/forgeqa-core';
const self = fileURLToPath(import.meta.url);
if (process.argv[2] === 'owner') {
  const journal = await RecoveryJournal.create({ runId: 'installed-run', consumer: 'installed-consumer', namespace: process.argv[4] }, { root: process.argv[3], graceMs: 0 });
  const allocation = await journal.createDirectory();
  await writeFile(join(allocation.directory, 'private.json'), 'private-canary', { mode: 0o600 });
  process.send({ directory: allocation.directory });
  await new Promise(() => { setInterval(() => {}, 1000); });
} else {
  const cli = process.argv[2];
  const root = await mkdtemp(join(await realpath(tmpdir()), 'installed recovery Ω '));
  const children = [];
  async function owner(namespace) {
    const child = fork(self, ['owner', root, namespace], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    children.push(child); let diagnostics = ''; child.stderr.on('data', data => diagnostics += data);
    const message = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Installed owner did not become ready.')), 15000);
      child.once('message', value => { clearTimeout(timer); resolve(value); });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Installed owner exited ${code}: ${diagnostics}`)); });
    });
    return { child, ...message };
  }
  async function kill(child) { if (child.exitCode !== null || child.signalCode !== null) return; const closed = once(child, 'close'); child.kill('SIGKILL'); await closed; }
  function command(args, expected = 0) {
    const result = spawnSync(process.execPath, [cli, 'recovery', '--root', root, '--json', ...args], { encoding: 'utf8', timeout: 15000 });
    assert.ifError(result.error); assert.equal(result.status, expected, result.stdout + result.stderr);
    return JSON.parse(result.stdout);
  }
  try {
    const abandoned = await owner('abandoned'), active = await owner('active');
    await kill(abandoned.child);
    const planned = command(['--dry-run']); assert.equal(planned.dryRun, true); assert.equal(planned.reclaimed, 0);
    assert(planned.events.some(event => event.status === 'eligible')); assert((await stat(abandoned.directory)).isDirectory());
    const applied = command(['--apply']); assert.equal(applied.reclaimed, 1); assert.equal(applied.incomplete, false);
    await assert.rejects(stat(abandoned.directory), { code: 'ENOENT' }); assert((await stat(active.directory)).isDirectory());
    assert.equal(command(['--apply']).reclaimed, 0);
    command(['--apply', '--dry-run'], 2); command(['--apply=false'], 2); command(['--timeout-ms', '0'], 2);
    command(['--workers', '2'], 2);
    await kill(active.child); assert.equal(command(['--apply']).reclaimed, 1);
    const journal = await RecoveryJournal.create({ runId: 'installed', consumer: 'installed', namespace: 'unknown' }, { root });
    await journal.reserve({ adapter: 'unknown-v1', target: 'lab', key: 'account' }); await journal.close();
    assert.equal(command(['--apply'], 3).incomplete, true);
    process.stdout.write(JSON.stringify({ schemaVersion: 1, status: 'PASS', installedPublicPackages: true, cases: 8,
      behaviors: ['killed-owner', 'dry-run', 'active-peer', 'repeat', 'conflicting-options', 'boolean-validation', 'limits-and-scope', 'unknown-adapter-exit-3'] }) + '\n');
  } finally { for (const child of children) await kill(child); await rm(root, { recursive: true, force: true }); }
}
