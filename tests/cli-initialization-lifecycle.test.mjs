import test from 'node:test';
import assert from 'node:assert/strict';
import { fork, spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../packages/cli/dist/cli.js', import.meta.url));
const fixture = fileURLToPath(new URL('./fixtures/init-boundary-child.mjs', import.meta.url));
function capture(child) {
  let out = '', err = '';
  const completed = new Promise((resolve, reject) => {
    child.stdout.on('data', data => { out += data; });
    child.stderr.on('data', data => { err += data; });
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal, out, err }));
  });
  return { child, completed };
}
function paused(destination, phase) {
  const process = capture(fork(fixture, [destination, phase], { execArgv: [], silent: true }));
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { process.child.kill('SIGKILL'); reject(new Error('Initialization never reached its filesystem boundary.')); }, 20000);
    process.child.once('message', message => { clearTimeout(timer); resolve(message); });
    process.child.once('error', error => { clearTimeout(timer); reject(error); });
    process.child.once('close', code => { clearTimeout(timer); reject(new Error(`Initialization exited before its boundary: ${code}`)); });
  });
  return { ...process, ready };
}
async function stop(process) {
  if (process.child.exitCode === null && process.child.signalCode === null) process.child.kill('SIGKILL');
  await process.completed;
}
async function run(destination) {
  const process = capture(spawn(globalThis.process.execPath, [cli, 'init', '--destination', destination, '--json'], { stdio: ['ignore', 'pipe', 'pipe'] }));
  const timer = setTimeout(() => process.child.kill('SIGKILL'), 20000);
  try { return await process.completed; } finally { clearTimeout(timer); }
}
async function treeFiles(directory) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) paths.push(...(await treeFiles(join(directory, entry.name))).map(path => `${entry.name}/${path}`));
    else paths.push(entry.name);
  }
  return paths.sort();
}

test('two initializers that both finished preflight converge without overwrite or spurious failure', { timeout: 30000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'forgeqa-concurrent-init-'));
  const first = paused(directory, 'before-link'), second = paused(directory, 'before-link');
  try {
    const [left, right] = await Promise.all([first.ready, second.ready]);
    assert.equal(left.path, right.path);
    first.child.send('continue'); second.child.send('continue');
    for (const result of await Promise.all([first.completed, second.completed])) {
      assert.equal(result.code, 0, result.out + result.err);
      assert.deepEqual(JSON.parse(result.out).conflicts, []);
    }
    assert.ok((await treeFiles(directory)).every(path => !path.endsWith('.tmp')));
    const repeat = await run(directory);
    assert.equal(repeat.code, 0, repeat.out + repeat.err);
    assert.ok(JSON.parse(repeat.out).files.every(entry => entry.action === 'unchanged'));
  } finally { await Promise.all([stop(first), stop(second)]); await rm(directory, { recursive: true, force: true }); }
});

test('a conflicting file arriving after preflight is preserved and explained', { timeout: 30000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'forgeqa-conflict-race-'));
  const child = paused(directory, 'before-link');
  try {
    const ready = await child.ready;
    await writeFile(ready.path, 'independent concurrent user content', { flag: 'wx' });
    child.child.send('continue');
    const result = await child.completed;
    assert.equal(result.code, 2, result.out + result.err);
    assert.match(JSON.parse(result.out).error.message, /concurrent conflicting file/);
    assert.equal(await readFile(ready.path, 'utf8'), 'independent concurrent user content');
    assert.ok((await treeFiles(directory)).every(path => !path.endsWith('.tmp')));
  } finally { await stop(child); await rm(directory, { recursive: true, force: true }); }
});

test('real process termination after a committed file leaves a resumable prefix', { timeout: 30000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'forgeqa-interrupted-init-'));
  const child = paused(directory, 'after-link');
  try {
    const ready = await child.ready;
    const original = await readFile(ready.path);
    await stop(child);
    const result = await run(directory);
    assert.equal(result.code, 0, result.out + result.err);
    assert.deepEqual(await readFile(ready.path), original);
    const repeated = await run(directory);
    assert.equal(repeated.code, 0, repeated.out + repeated.err);
    assert.ok(JSON.parse(repeated.out).files.every(entry => entry.action === 'unchanged'));
    // A hard-killed writer cannot run finally. The CLI does not delete an
    // unproven temporary file left by another process merely by filename.
    assert.deepEqual(await readFile(ready.temporary), original);
  } finally { await stop(child); await rm(directory, { recursive: true, force: true }); }
});
