import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile('scripts/distributed-browser-evidence.mjs', 'utf8');

test('distributed browser probe guarantees failure-bound screenshot and trace evidence', () => {
  assert.match(source, /trace:'retain-on-failure',screenshot:'only-on-failure',video:'off'/);
  assert.match(source, /testInfo\.retry===0[\s\S]+testInfo\.attach\('screenshot',[\s\S]+page\.screenshot\(\)[\s\S]+expect\('first-attempt'\)\.toBe\('retry-pass'\)/);
  assert.match(source, /attempt\.retry === 0 && attempt\.outcome === 'failed'/);
  assert.match(source, /Expected captured \$\{kind\} evidence on the failed attempt/);
  assert.doesNotMatch(source, /continue-on-error|\|\| true/);
});
