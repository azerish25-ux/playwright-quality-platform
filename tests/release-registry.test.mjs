import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RELEASE_PACKAGES, artifactDigests, reconcileCandidate, assertStablePromotion } from '../scripts/release-state.mjs';
import { registryAddress, createRegistryTransport } from '../scripts/release-registry.mjs';
import { runNpm } from '../scripts/release-process.mjs';
import { startRegistry } from './fixtures/release-registry-server.mjs';

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'forgeqa-registry-test-'));
  const registry = await startRegistry();
  const tarballs = join(directory, 'tarballs'); await mkdir(tarballs);
  const entries = [];
  for (const [i, name] of RELEASE_PACKAGES.entries()) {
    const packageRoot = join(directory, `fixture-${i}`); await mkdir(packageRoot);
    await writeFile(join(packageRoot, 'package.json'), JSON.stringify({ name, version: '1.0.0', description: 'Isolated protocol test fixture; not a ForgeQA product release.', files: ['index.js'] }));
    await writeFile(join(packageRoot, 'index.js'), 'module.exports = "fixture";\n');
    const [packed] = JSON.parse(await runNpm(['pack', packageRoot, '--json', '--ignore-scripts', '--pack-destination', tarballs], { cwd: directory }));
    entries.push({ name, version: '1.0.0', filename: packed.filename, status: 'staged', ...artifactDigests(await readFile(join(tarballs, packed.filename))) });
  }
  const manifest = { schemaVersion: 2, kind: 'forgeqa-release-candidate', sourceSha: 'a'.repeat(40), version: '1.0.0', channel: 'forgeqa-candidate', status: 'staged', entries };
  const transport = createRegistryTransport({ directory, registry: registry.url, allowLoopback: true, timeoutMs: 3000 });
  return { directory, registry, manifest, transport, async dispose() { await registry.close(); await rm(directory, { recursive: true, force: true }); } };
}

test('registry policy rejects unsafe origins and non-boolean authorization', () => {
  assert.equal(registryAddress('https://registry.npmjs.org/').origin, 'https://registry.npmjs.org');
  for (const url of ['http://registry.npmjs.org/', 'https://example.com/', 'http://127.0.0.1:1234/', 'https://user:password@registry.npmjs.org/', 'https://registry.npmjs.org/path']) assert.throws(() => registryAddress(url));
  assert.equal(registryAddress('http://127.0.0.1:1234/', true).port, '1234');
  assert.throws(() => registryAddress('http://127.0.0.1:1234/', 'true'));
  assert.throws(() => createRegistryTransport({ directory: '.', authorizePublicPublish: 'true' }));
});

test('actual npm publishes: interruption after three uploads resumes without republishing', { timeout: 60000 }, async () => {
  const f = await fixture();
  try {
    const initial = await reconcileCandidate(f.manifest, f.transport);
    assert.equal(initial.status, 'partial'); assert.equal(f.registry.publications.length, 0);
    f.registry.faults.beforeUpload = count => count === 3;
    await assert.rejects(reconcileCandidate(f.manifest, f.transport, { allowPublish: true }), /partial/);
    assert.equal(f.registry.publications.length, 3);
    const partial = JSON.parse(await readFile(join(f.directory, 'release-manifest.json')));
    assert.equal(partial.status, 'partial'); assert.throws(() => assertStablePromotion(partial, {}));
    f.registry.faults.beforeUpload = null;
    const complete = await reconcileCandidate(partial, f.transport, { allowPublish: true });
    assert.equal(complete.status, 'candidate-verified'); assert.equal(f.registry.publications.length, 8);
    await reconcileCandidate(complete, f.transport, { allowPublish: true });
    assert.equal(f.registry.publications.length, 8);
    assert(f.registry.requests.some(request => request.method === 'GET' && request.path.includes('/-/')));
  } finally { await f.dispose(); }
});

test('actual npm lost acknowledgement is reconciled; conflicting registry bytes stop all writes', { timeout: 60000 }, async () => {
  const f = await fixture();
  try {
    f.registry.faults.afterUpload = count => count === 1;
    await assert.rejects(reconcileCandidate(f.manifest, f.transport, { allowPublish: true }), /partial/);
    assert.equal(f.registry.publications.length, 1);
    const partial = JSON.parse(await readFile(join(f.directory, 'release-manifest.json')));
    f.registry.faults.afterUpload = null;
    const first = f.registry.packages.values().next().value, saved = first.bytes;
    first.bytes = Buffer.concat([saved, Buffer.from('conflict')]);
    await assert.rejects(reconcileCandidate(partial, f.transport, { allowPublish: true }), /mismatch/);
    assert.equal(f.registry.publications.length, 1);
    first.bytes = saved;
    const complete = await reconcileCandidate(partial, f.transport, { allowPublish: true });
    assert.equal(complete.status, 'candidate-verified'); assert.equal(f.registry.publications.length, 8);
    for (const status of [401, 403, 429, 500]) {
      f.registry.faults.readStatus = status;
      await assert.rejects(f.transport.lookup(RELEASE_PACKAGES[0], '1.0.0'), /absence is not established/);
    }
    f.registry.faults.readStatus = null;
    f.registry.faults.metadata = metadata => ({ ...metadata, dist: { ...metadata.dist, tarball: 'http://169.254.169.254/latest/meta-data/' } });
    await assert.rejects(f.transport.lookup(RELEASE_PACKAGES[0], '1.0.0'), /escaped/);
    assert.equal(f.registry.publications.length, 8);
  } finally { await f.dispose(); }
});
