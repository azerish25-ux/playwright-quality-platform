import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
const directory = resolve('tools/semantic-release');
test('private semantic-release retains every upstream runtime byte and the MIT license', async () => {
  const provenance = JSON.parse(await readFile(join(directory, 'UPSTREAM.json'), 'utf8'));
  assert.equal(provenance.version, '25.0.9'); assert.equal(provenance.runtimeModification, 'none');
  const actual = [];
  async function walk(path = '') {
    for (const entry of await readdir(join(directory, path), { withFileTypes: true })) {
      const name = [path, entry.name].filter(Boolean).join('/');
      if (entry.isDirectory()) { if (entry.name !== 'node_modules') await walk(name); }
      else if (!['package.json', 'README.md', 'UPSTREAM.json'].includes(name)) actual.push(name);
    }
  }
  await walk(); assert.deepEqual(actual.sort(), Object.keys(provenance.files).sort());
  for (const [name, digest] of Object.entries(provenance.files)) assert.equal(createHash('sha256').update(await readFile(join(directory, name))).digest('hex'), digest, name);
  assert.match(await readFile(join(directory, 'LICENSE'), 'utf8'), /Permission is hereby granted/);
});
test('private analyzer runtime does not reinstall unused publishing plugins or bundled npm', async () => {
  const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  assert.equal(manifest.private, true); assert.equal(manifest.bin, undefined);
  for (const name of ['npm', '@semantic-release/npm', '@semantic-release/github']) assert.equal(manifest.dependencies[name], undefined);
  const root = JSON.parse(await readFile('package.json', 'utf8'));
  assert.equal(root.devDependencies['semantic-release'], 'file:tools/semantic-release');
  const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
  assert.equal(lock.packages['node_modules/npm'], undefined);
  assert.equal(lock.packages['node_modules/@semantic-release/npm'], undefined);
  const { default: config } = await import('../release.config.mjs');
  assert.equal(config.dryRun, true);
  assert.deepEqual(config.plugins.map(plugin => plugin[0]), ['@semantic-release/commit-analyzer']);
});
