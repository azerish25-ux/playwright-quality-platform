import test from 'node:test';
import assert from 'node:assert/strict';
import { RELEASE_PACKAGES, artifactDigests, validateReleaseManifest, reconcileCandidate, assertStablePromotion } from '../scripts/release-state.mjs';

function fixture(version = '0.1.0') {
  return { schemaVersion: 2, kind: 'forgeqa-release-candidate', sourceSha: 'a'.repeat(40), version, channel: 'forgeqa-candidate', status: 'staged', entries: RELEASE_PACKAGES.map((name, i) => ({ name, version, filename: `artifact-${i}.tgz`, status: 'staged', ...artifactDigests(Buffer.from(name)) })) };
}

test('publication authorization rejects truthy strings and numeric flags before touching transport', async () => {
  for (const allowPublish of ['false', 'true', 0, 1, null, {}, []]) await assert.rejects(reconcileCandidate(fixture(), {}, { allowPublish }), /explicit boolean/);
});

test('manifest validation does not coerce arrays into source, version or artifact strings', () => {
  for (const key of ['sourceSha', 'version']) { const manifest = fixture(); manifest[key] = [manifest[key]]; assert.throws(() => validateReleaseManifest(manifest)); }
  for (const key of ['filename', 'sha256', 'integrity']) { const manifest = fixture(); manifest.entries[0][key] = [manifest.entries[0][key]]; assert.throws(() => validateReleaseManifest(manifest)); }
});

test('unknown and contradictory candidate states fail validation', () => {
  for (const status of ['published', 'PASS', null, true]) { const manifest = fixture(); manifest.status = status; assert.throws(() => validateReleaseManifest(manifest), /state/); }
  for (const status of ['published', 'PASS', null, true]) { const manifest = fixture(); manifest.entries[0].status = status; assert.throws(() => validateReleaseManifest(manifest), /state/); }
  const manifest = fixture(); manifest.status = 'candidate-verified';
  assert.throws(() => validateReleaseManifest(manifest), /unverified/);
});

test('a verified prerelease cannot masquerade as a stable version even with green gates', () => {
  const manifest = fixture('1.0.0-rc.1'); manifest.status = 'candidate-verified'; manifest.entries.forEach(entry => { entry.status = 'verified'; });
  const evidence = Object.fromEntries(['platform', 'teamboardRegistry', 'ledgerguardRegistry', 'immutableAction', 'documentation', 'benchmarks', 'lifecycle', 'semanticVersion'].map(name => [name, { status: 'PASS', version: manifest.version, sourceSha: manifest.sourceSha }]));
  assert.throws(() => assertStablePromotion(manifest, evidence), /prerelease/);
});
