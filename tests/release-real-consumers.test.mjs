import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateRealConsumer } from '../scripts/release-real-consumers.mjs';
import { RELEASE_PACKAGES } from '../scripts/release-state.mjs';
const manifest = { sourceSha: 'a'.repeat(40), version: '1.0.0', entries: RELEASE_PACKAGES.map((name, index) => ({ name, filename: `${index}.tgz`, sha256: String(index).repeat(64) })) };
const base = { status: 'PASS', sourceSha: manifest.sourceSha, version: manifest.version, manager: 'npm', distribution: 'loopback-registry', tests: 20, attempts: 20,
  versions: Object.fromEntries(RELEASE_PACKAGES.map(name => [name, '1.0.0'])), packageChecksums: Object.fromEntries(manifest.entries.map(entry => [entry.filename, entry.sha256])) };
test('real registry receipts bind every installed version, full inventory and exact artifact set', () => {
  const options = { manager: 'npm', tests: 20, application: 'teamboard' };
  assert.equal(validateRealConsumer(base, manifest, options), base);
  for (const patch of [{ status: 'FAIL' }, { sourceSha: 'b'.repeat(40) }, { version: '0.1.0' }, { manager: 'pnpm' }, { distribution: 'prepared-tarballs' },
    { tests: 19 }, { attempts: 21 }, { versions: {} }, { packageChecksums: {} }, { versions: { ...base.versions, [RELEASE_PACKAGES[0]]: '0.1.0' } }]) {
    assert.throws(() => validateRealConsumer({ ...base, ...patch }, manifest, options), /incompatible/);
  }
});
test('financial browser registry acceptance cannot omit cleanup, reconciliation or browser projects', () => {
  const receipt = { ...base, sourceSha: undefined, forgeqaSourceSha: manifest.sourceSha, tests: 24, attempts: 24, reconciliationDiscrepancies: 0, cleanupStatus: 'PASS', uiClaimed: true,
    projects: { 'ledgerguard-api': 12, 'ledgerguard-chromium': 4, 'ledgerguard-firefox': 4, 'ledgerguard-webkit': 4 } };
  const options = { manager: 'npm', tests: 24, application: 'ledgerguard' };
  assert.equal(validateRealConsumer(receipt, manifest, options), receipt);
  for (const patch of [{ reconciliationDiscrepancies: 1 }, { cleanupStatus: 'FAIL' }, { uiClaimed: false }, { projects: { 'ledgerguard-api': 24 } }]) {
    assert.throws(() => validateRealConsumer({ ...receipt, ...patch }, manifest, options), /financial, browser or cleanup/);
  }
});
test('real registry qualification preserves onboarding receipts and publication remains manually guarded', async () => {
  const packed = await readFile('tests/consumers/packed.mjs', 'utf8');
  assert.match(packed, /registry-teamboard-consumers/); assert.match(packed, /registry-consumers/);
  const preparation = await readFile('scripts/ledgerguard-consumer-preparation.mjs', 'utf8');
  assert.match(preparation, /verifyPrepared/); assert.match(preparation, /assertArtifact\(entry, await transport.readPublished/);
  const workflow = await readFile('.github/workflows/release.yml', 'utf8');
  assert.match(workflow, /verify-real-consumers:/);
  assert.match(workflow, /needs: \[verify-artifacts, verify-real-consumers\]/);
  assert.match(workflow, /github.event_name == 'workflow_dispatch' && inputs.publish_candidate/);
});
