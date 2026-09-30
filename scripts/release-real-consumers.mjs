import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, cp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { verifyPrepared } from './release-engine.mjs';
import { createRegistryTransport } from './release-registry.mjs';
import { reconcileCandidate, RELEASE_PACKAGES } from './release-state.mjs';
import { runNpm, atomicJson } from './release-process.mjs';
import { startRegistry } from '../tests/fixtures/release-registry-server.mjs';

export function validateRealConsumer(receipt, manifest, { manager, tests, application }) {
  const source = receipt?.sourceSha ?? receipt?.forgeqaSourceSha;
  const checksums = Object.fromEntries(manifest.entries.map(entry => [entry.filename, entry.sha256]));
  if (receipt?.status !== 'PASS' || source !== manifest.sourceSha || receipt.version !== manifest.version || receipt.manager !== manager
    || receipt.distribution !== 'loopback-registry' || receipt.tests !== tests || receipt.attempts !== tests
    || Object.keys(receipt.versions ?? {}).length !== 8 || !RELEASE_PACKAGES.every(name => receipt.versions[name] === manifest.version)
    || JSON.stringify(Object.entries(receipt.packageChecksums ?? {}).sort()) !== JSON.stringify(Object.entries(checksums).sort())) {
    throw new Error(`Incomplete or incompatible ${application} registry consumer receipt.`);
  }
  if (application === 'ledgerguard' && (receipt.reconciliationDiscrepancies !== 0 || receipt.cleanupStatus !== 'PASS' || receipt.uiClaimed !== true
    || JSON.stringify(receipt.projects) !== JSON.stringify({ 'ledgerguard-api': 12, 'ledgerguard-chromium': 4, 'ledgerguard-firefox': 4, 'ledgerguard-webkit': 4 }))) {
    throw new Error('LedgerGuard real-registry acceptance lacks financial, browser or cleanup evidence.');
  }
  return receipt;
}

export async function qualifyRealConsumers(root, directory, sourceSha) {
  const { manifest } = await verifyPrepared(directory, sourceSha);
  const temporary = await mkdtemp(join(tmpdir(), 'deadpan-real-registry-'));
  const evidence = resolve(root, 'evidence/release-real-consumers');
  await mkdir(evidence, { recursive: true });
  let registry;
  const receipt = { schemaVersion: 1, kind: 'forgeqa-real-registry-consumer-acceptance', status: 'FAIL', sourceSha,
    version: manifest.version, scope: 'isolated-loopback-registry', publicNpmPublication: 'NOT_ATTEMPTED', consumers: [] };
  try {
    registry = await startRegistry();
    await cp(join(directory, 'tarballs'), join(temporary, 'tarballs'), { recursive: true });
    const transport = createRegistryTransport({ directory: temporary, registry: registry.url, allowLoopback: true, timeoutMs: 10000 });
    const published = await reconcileCandidate(manifest, transport, { allowPublish: true });
    assert.equal(published.status, 'candidate-verified'); assert.equal(registry.publications.length, 8);
    const env = { ...process.env, FORGEQA_SOURCE_SHA: sourceSha, FORGEQA_PREPARED_DIRECTORY: directory,
      FORGEQA_CONSUMER_REGISTRY: registry.url, FORGEQA_TEST_REGISTRY: 'true' };
    // Establish the real workspace inventory before comparing exact released packages.
    await runNpm(['run', 'test:teamboard'], { cwd: root, timeoutMs: 600000 });
    await runNpm(['run', 'test:consumers', '--', 'teamboard'], { cwd: root, env, timeoutMs: 900000 });
    for (const manager of ['npm', 'pnpm']) {
      const folder = join(directory, 'registry-teamboard-consumers');
      const consumer = validateRealConsumer(JSON.parse(await readFile(join(folder, `${manager}-release.json`))), manifest, { manager, tests: 20, application: 'teamboard' });
      const cleanup = JSON.parse(await readFile(join(folder, `${manager}-cleanup.json`)));
      assert.equal(cleanup.sameInventory, true); assert(Object.values(cleanup.cleanup).every(count => count === 0));
      receipt.consumers.push({ application: 'teamboard', ...consumer, cleanup: 'PASS', sameInventory: true });
    }
    await runNpm(['run', 'test:ledgerguard'], { cwd: root, env, timeoutMs: 1800000 });
    const ledger = JSON.parse(await readFile(join(root, 'evidence/ledgerguard/acceptance.json')));
    assert.equal(ledger.status, 'PASS'); assert.equal(ledger.forgeqaSourceSha, sourceSha); assert.equal(ledger.consumerManagers.length, 2);
    for (const manager of ['npm', 'pnpm']) {
      const candidates = ledger.consumerManagers.filter(consumer => consumer.manager === manager); assert.equal(candidates.length, 1);
      receipt.consumers.push({ application: 'ledgerguard', ...validateRealConsumer(candidates[0], manifest, { manager, tests: 24, application: 'ledgerguard' }) });
    }
    await verifyPrepared(directory, sourceSha); // Real-consumer reports must not overwrite onboarding evidence.
    receipt.status = 'PASS';
  } catch (error) { receipt.failure = error.message; throw error; }
  finally {
    try { await registry?.close(); await rm(temporary, { recursive: true, force: true }); receipt.registryCleanup = 'PASS'; }
    catch (error) { receipt.status = 'FAIL'; receipt.registryCleanup = 'FAIL'; receipt.failure = error.message; throw error; }
    finally { await atomicJson(join(evidence, 'acceptance.json'), receipt); }
  }
  return receipt;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await qualifyRealConsumers(resolve('.'), resolve('evidence/release-prepared'), process.env.FORGEQA_SOURCE_SHA), null, 2)); }
  catch (error) { console.error(error.message); if (error.stdout) console.error(error.stdout.slice(-12000)); if (error.stderr) console.error(error.stderr.slice(-12000)); process.exitCode = 1; }
}
