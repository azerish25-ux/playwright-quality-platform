import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const pinned = '9478663f97f9dc65d0c85117f244e1b8b80c37cb';
const contract = JSON.parse(await readFile('examples/ledgerguard-integration/contract.json', 'utf8'));
const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
const workflow = await readFile('.github/workflows/ci.yml', 'utf8');
const sources = await Promise.all([
  'examples/ledgerguard-integration/consumer/src/client.ts',
  'examples/ledgerguard-integration/consumer/tests/fixtures.ts',
  'examples/ledgerguard-integration/consumer/tests/ledgerguard.api.spec.ts',
].map((path) => readFile(path, 'utf8')));
const combined = sources.join('\n');

test('LedgerGuard second consumer is executable and pinned to reviewed source', () => {
  assert.equal(contract.schemaVersion, 2);
  assert.equal(contract.sourceSha, pinned);
  assert.equal(contract.interface, 'public-http-api');
  assert.equal(contract.applicationHasProductUi, false);
  assert.match(packageJson.scripts['test:ledgerguard'], /ledgerguard-acceptance\.mjs/);
  assert.match(workflow, new RegExp(`ref: ${pinned}`));
  assert.match(workflow, /needs: \[verify, consumer, teamboard, ledgerguard, action\]/);
  assert.match(workflow, /LEDGERGUARD_RESULT/);
});

test('LedgerGuard consumer contains no fake UI, fixed sleeps, private imports, or response interception', () => {
  assert.doesNotMatch(combined, /\.waitForTimeout\s*\(/);
  assert.doesNotMatch(combined, /\bsetTimeout\s*\(/);
  assert.doesNotMatch(combined, /\.route\s*\(|route\.fulfill|mock/i);
  assert.doesNotMatch(combined, /packages\/.+\/src/);
  assert.doesNotMatch(combined, /test\.(?:skip|fixme)\s*\(/);
  assert.match(combined, /pollUntil/);
  assert.match(combined, /Idempotency-Key/);
});
