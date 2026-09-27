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
  const fixtures = await text('consumers/ledgerguard/tests/fixtures.ts');
  assert.match(config, /consumer:\s*'transaction-reliability-lab'/);
  assert.match(config, /workers:\s*1/);
  assert.match(config, /retries:\s*0/);
  assert.match(playwright, /ledgerguard-api/);
  assert.doesNotMatch(playwright, /webServer/);
  assert.doesNotMatch(fixtures, /baseURL!/);
  assert.match(fixtures, /function requiredBaseURL\(value: string \| undefined\): string/);
  assert.match(fixtures, /LedgerGuard Playwright baseURL is required for external-consumer acceptance/);
  assert.equal((fixtures.match(/requiredBaseURL\(baseURL\)/g) ?? []).length, 3);

  const entries = await readdir('consumers/ledgerguard/tests');
  const specs = entries.filter(entry => entry.endsWith('.api.spec.ts')).sort();
  assert.deepEqual(specs, [
    'auth.api.spec.ts',
    'payments.api.spec.ts',
    'schedules.api.spec.ts',
    'transfers.api.spec.ts'
  ]);
  const source = await Promise.all([
    ...specs.map(file => text(`consumers/ledgerguard/tests/${file}`)),
    Promise.resolve(fixtures),
    text('consumers/ledgerguard/src/client.ts'),
    text('consumers/ledgerguard/src/lab.ts')
  ]).then(parts => parts.join('\n'));
  assert.equal((source.match(/\btest\('/g) ?? []).length, 12);
  assert.doesNotMatch(source, /\.skip\(|test\.fixme|waitForTimeout|setTimeout\([^,]+,\s*[1-9][0-9]{4,}/);
  assert.doesNotMatch(source, /packages\/.+\/src|@azerish25-ux\/.+\/src/);
  assert.match(source, /INSUFFICIENT_FUNDS/);
  assert.doesNotMatch(source, /TRANSFER_REJECTED/);
  assert.match(source, /waitForSettledProjection/);
  assert.match(source, /projectionState === 'SETTLED'/);
  assert.match(source, /projectionVersion === value\.body\.version/);
  for (const capability of [
    'auth-session',
    'role-separation',
    'owner-scope',
    'transfer-idempotency',
    'payment-terminal-status',
    'payment-cancellation',
    'payment-refund',
    'payment-reversal',
    'schedule-one-time',
    'schedule-lifecycle'
  ]) {
    assert(source.includes(capability), `Missing LedgerGuard capability coverage ${capability}.`);
  }
});

test('LedgerGuard consumer compilation is shared, isolated and completed before Docker startup', async () => {
  const harness = await text('scripts/ledgerguard-acceptance.mjs');
  const preparation = await text('scripts/ledgerguard-consumer-preparation.mjs');
  const preflight = await text('scripts/ledgerguard-consumer-preflight.mjs');
  assert(harness.includes(PINNED_LEDGERGUARD_SHA));
  assert.match(harness, /const preparedConsumers = await prepareLedgerGuardConsumers/);
  assert.match(harness, /for \(const \{ manager, consumer, resolved \} of preparedConsumers\)/);
  const preparationIndex = harness.indexOf('const preparedConsumers = await prepareLedgerGuardConsumers');
  const dockerIndex = harness.indexOf("await command('docker', ['info']");
  assert(preparationIndex >= 0, 'Full acceptance invokes shared consumer preparation.');
  assert(dockerIndex > preparationIndex, 'Isolated consumer compilation must complete before Docker startup.');

  assert.match(preparation, /LEDGERGUARD_CONSUMER_MANAGERS = Object\.freeze\(\['npm', 'pnpm'\]\)/);
  assert.match(preparation, /tests\/consumers\/public-exports\.mjs/);
  assert.match(preparation, /typescript\/bin\/tsc/);
  assert.match(preparation, /--frozen-lockfile/);
  assert.match(preparation, /dist\/index\.js/);
  assert.match(preparation, /dist\/index\.d\.ts/);
  assert.doesNotMatch(preparation, /continue-on-error|\|\| true/);

  assert.match(preflight, /prepareLedgerGuardConsumers/);
  assert.match(preflight, /strictTypeScript:\s*true/);
  assert.match(preflight, /independentConsumers:\s*true/);
  assert.match(preflight, /failure\.json/);

  assert.match(harness, /independentConsumer:\s*true/);
  assert.match(harness, /reconciliationDiscrepancies/);
  assert.match(harness, /down', '--volumes', '--remove-orphans'/);
  assert.match(harness, /LedgerGuard acceptance leaked containers/);
  assert.match(harness, /LedgerGuard acceptance leaked volumes/);
  assert.doesNotMatch(harness, /continue-on-error|\|\| true/);

  const rootManifest = JSON.parse(await text('package.json'));
  assert.equal(
    rootManifest.scripts['test:ledgerguard:consumer'],
    'node scripts/ledgerguard-consumer-preflight.mjs'
  );
  assert.equal(rootManifest.scripts['test:ledgerguard'], 'node scripts/ledgerguard-acceptance.mjs');
  assert.match(rootManifest.scripts.verify, /npm run test:ledgerguard:consumer/);
});
