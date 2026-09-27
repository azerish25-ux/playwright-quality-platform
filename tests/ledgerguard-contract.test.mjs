import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const PINNED_LEDGERGUARD_SHA = '9478663f97f9dc65d0c85117f244e1b8b80c37cb';

async function text(path) {
  return readFile(path, 'utf8');
}

test('LedgerGuard is an executable API-first external consumer contract', async () => {
  const manifest = JSON.parse(await text('consumers/ledgerguard/package.json'));
  assert.equal(manifest.private, true);
  assert.equal(manifest.dependencies['@azerish25-ux/forgeqa-core'], '0.1.0');
  assert.equal(manifest.dependencies['@azerish25-ux/forgeqa-api'], '0.1.0');
  assert.equal(manifest.dependencies['@azerish25-ux/forgeqa-playwright'], '0.1.0');
  assert.equal(manifest.dependencies['@azerish25-ux/forgeqa-test-data'], '0.1.0');
  assert.equal(manifest.devDependencies['@azerish25-ux/forgeqa-cli'], '0.1.0');

  const config = await text('consumers/ledgerguard/forgeqa.config.ts');
  const playwright = await text('consumers/ledgerguard/playwright.config.ts');
  assert.match(config, /consumer:\s*'transaction-reliability-lab'/);
  assert.match(config, /workers:\s*1/);
  assert.match(config, /retries:\s*0/);
  assert.match(playwright, /ledgerguard-api/);
  assert.doesNotMatch(playwright, /webServer/);

  const entries = await readdir('consumers/ledgerguard/tests');
  const specs = entries.filter(entry => entry.endsWith('.api.spec.ts')).sort();
  assert.deepEqual(specs, ['auth.api.spec.ts', 'payments.api.spec.ts', 'schedules.api.spec.ts', 'transfers.api.spec.ts']);
  const source = await Promise.all([
    ...specs.map(file => text(`consumers/ledgerguard/tests/${file}`)),
    text('consumers/ledgerguard/tests/fixtures.ts'),
    text('consumers/ledgerguard/src/client.ts'),
    text('consumers/ledgerguard/src/lab.ts')
  ]).then(parts => parts.join('\n'));
  assert.equal((source.match(/\btest\('/g) ?? []).length, 12);
  assert.doesNotMatch(source, /\.skip\(|test\.fixme|waitForTimeout|setTimeout\([^,]+,\s*[1-9][0-9]{4,}/);
  assert.doesNotMatch(source, /packages\/.+\/src|@azerish25-ux\/.+\/src/);
  for (const capability of ['auth-session', 'role-separation', 'owner-scope', 'transfer-idempotency', 'payment-terminal-status', 'payment-cancellation', 'payment-refund', 'payment-reversal', 'schedule-one-time', 'schedule-lifecycle']) {
    assert(source.includes(capability), `Missing LedgerGuard capability coverage ${capability}.`);
  }
});

test('LedgerGuard acceptance is exact-revision, packed-consumer, reconciled and cleanup-gated', async () => {
  const harness = await text('scripts/ledgerguard-acceptance.mjs');
  assert(harness.includes(PINNED_LEDGERGUARD_SHA));
  assert.match(harness, /for \(const manager of \['npm', 'pnpm'\]\)/);
  assert.match(harness, /independentConsumer:\s*true/);
  assert.match(harness, /reconciliationDiscrepancies/);
  assert.match(harness, /down', '--volumes', '--remove-orphans'/);
  assert.match(harness, /LedgerGuard acceptance leaked containers/);
  assert.match(harness, /LedgerGuard acceptance leaked volumes/);
  assert.doesNotMatch(harness, /continue-on-error|\|\| true/);

  const rootManifest = JSON.parse(await text('package.json'));
  assert.equal(rootManifest.scripts['test:ledgerguard'], 'node scripts/ledgerguard-acceptance.mjs');
});
