import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RELEASE_PACKAGES, artifactDigests, assertArtifact, validateReleaseManifest, reconcileCandidate, assertStablePromotion, saveManifestAtomically } from '../scripts/release-state.mjs';

function fixture() {
  const staged = new Map(RELEASE_PACKAGES.map(name => [name, Buffer.from(`Synthetic complete artifact for ${name}; not an npm publication.`)]));
  const manifest = { schemaVersion: 2, kind: 'forgeqa-release-candidate', sourceSha: 'a'.repeat(40), version: '0.1.0', channel: 'forgeqa-candidate', status: 'staged', entries: RELEASE_PACKAGES.map((name, i) => ({ name, version: '0.1.0', filename: `package-${i}.tgz`, ...artifactDigests(staged.get(name)), status: 'staged' })) };
  const registry = new Map(), writes = [], saves = [];
  const transport = {
    readStaged: async entry => staged.get(entry.name),
    lookup: async (name, version) => registry.has(name) ? { name, version } : null,
    readPublished: async entry => registry.get(entry.name),
    publish: async (entry, bytes, options) => { assert.equal(options.tag, 'forgeqa-candidate'); assert.equal(registry.has(entry.name), false); registry.set(entry.name, Buffer.from(bytes)); writes.push(entry.name); },
    save: async value => saves.push(structuredClone(value))
  };
  return { staged, manifest, registry, writes, saves, transport };
}

test('manifest requires eight distinct packages, one version, safe filenames and full digests', () => {
  const f = fixture(); validateReleaseManifest(f.manifest);
  for (const mutate of [m => m.entries.pop(), m => { m.entries[1] = m.entries[0]; }, m => { m.entries[0].version = '9.0.0'; }, m => { m.entries[0].filename = '../escape.tgz'; }, m => { m.entries[0].sha256 = 'bad'; }, m => { m.channel = 'latest'; }, m => { m.version = '1.0.0-..'; }, m => { m.entries[1].filename = m.entries[0].filename; }]) {
    const m = structuredClone(f.manifest); mutate(m); assert.throws(() => validateReleaseManifest(m));
  }
});

test('changing any complete artifact byte invalidates integrity', () => {
  const f = fixture(), entry = f.manifest.entries[0];
  assertArtifact(entry, f.staged.get(entry.name));
  assert.throws(() => assertArtifact(entry, Buffer.concat([f.staged.get(entry.name), Buffer.from('template changed')])));
});

test('default reconciliation is read-only and cannot publish', async () => {
  const f = fixture(), result = await reconcileCandidate(f.manifest, f.transport);
  assert.equal(result.status, 'partial'); assert.equal(f.writes.length, 0); assert.equal(f.manifest.status, 'staged');
});

test('corrupt late staged or already-published artifacts prevent every write', async () => {
  for (const target of ['staged', 'registry']) {
    const f = fixture(); f[target].set(RELEASE_PACKAGES.at(-1), Buffer.from('conflict'));
    await assert.rejects(reconcileCandidate(f.manifest, f.transport, { allowPublish: true }), /mismatch/);
    assert.equal(f.writes.length, 0);
  }
});

test('publication interrupted after three uploads resumes without republishing immutable versions', async () => {
  const f = fixture(), original = f.transport.publish;
  f.transport.publish = async (...args) => { if (f.writes.length === 3) throw new Error('Synthetic registry interruption'); return original(...args); };
  await assert.rejects(reconcileCandidate(f.manifest, f.transport, { allowPublish: true }), /partial/);
  assert.equal(f.writes.length, 3); assert.equal(f.saves.at(-1).status, 'partial');
  f.transport.publish = original;
  const complete = await reconcileCandidate(f.saves.at(-1), f.transport, { allowPublish: true });
  assert.equal(complete.status, 'candidate-verified'); assert.equal(f.writes.length, 8); assert.equal(new Set(f.writes).size, 8);
  await reconcileCandidate(complete, f.transport, { allowPublish: true }); assert.equal(f.writes.length, 8);
});

test('lost upload acknowledgement is reconciled by independently reading registry bytes', async () => {
  const f = fixture(), original = f.transport.publish;
  f.transport.publish = async (...args) => { await original(...args); throw new Error('Synthetic connection loss after registry accepted upload'); };
  await assert.rejects(reconcileCandidate(f.manifest, f.transport, { allowPublish: true }));
  assert.equal(f.registry.size, 1);
  f.transport.publish = original;
  await reconcileCandidate(f.saves.at(-1), f.transport, { allowPublish: true });
  assert.equal(f.writes.length, 8);
});

test('lookup permission or network failures are never treated as absent versions', async () => {
  const f = fixture(); f.transport.lookup = async () => { throw new Error('Synthetic permission denial'); };
  await assert.rejects(reconcileCandidate(f.manifest, f.transport, { allowPublish: true }), /permission/);
  assert.equal(f.writes.length, 0);
});

test('registry metadata with a mismatched identity is rejected', async () => {
  const f = fixture(); f.transport.lookup = async () => ({ name: 'wrong', version: '0.1.0' });
  await assert.rejects(reconcileCandidate(f.manifest, f.transport, { allowPublish: true }), /identity/);
  assert.equal(f.writes.length, 0);
});

test('stable promotion requires every exact-source and exact-version acceptance gate', async () => {
  const f = fixture(); assert.throws(() => assertStablePromotion(f.manifest, {}));
  const complete = await reconcileCandidate(f.manifest, f.transport, { allowPublish: true });
  assert.throws(() => assertStablePromotion(complete, {}));
  const names = ['platform', 'teamboardRegistry', 'ledgerguardRegistry', 'immutableAction', 'documentation', 'benchmarks', 'lifecycle', 'semanticVersion'];
  const evidence = Object.fromEntries(names.map(name => [name, { status: 'PASS', sourceSha: complete.sourceSha, version: complete.version }]));
  assert.equal(assertStablePromotion(complete, evidence), true);
  for (const name of names) for (const patch of [{ status: 'PARTIAL' }, { sourceSha: 'b'.repeat(40) }, { version: '2.0.0' }]) {
    const altered = structuredClone(evidence); Object.assign(altered[name], patch);
    assert.throws(() => assertStablePromotion(complete, altered));
  }
});

test('atomic checkpoint replacement leaves parseable manifests and no temporary files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'forgeqa-release-state-'));
  try {
    const path = join(directory, 'manifest.json'), f = fixture();
    await saveManifestAtomically(path, f.manifest);
    await saveManifestAtomically(path, { ...f.manifest, status: 'partial' });
    assert.equal(JSON.parse(await readFile(path, 'utf8')).status, 'partial');
    assert.deepEqual(await readdir(directory), ['manifest.json']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
