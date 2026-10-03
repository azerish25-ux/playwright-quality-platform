import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { reportFixture } from '../scripts/report/fixture.mjs';
import { executions, toHtmlReport } from '@azerish25-ux/forgeqa-reporter';

test('the reproducible report walkthrough stays synthetic and exercises distinct outcomes', () => {
  const run = reportFixture();
  assert.match(run.runId, /^SYNTHETIC DEMO/);
  assert.equal(run.revision.repository, 'synthetic/report-fixtures');
  assert.equal(run.gate.outcome, 'fail');
  assert.deepEqual(new Set(executions(run).map(value => value.outcome)), new Set(['passed', 'flaky', 'failed', 'timed-out', 'skipped', 'expected-failure']));
  assert.equal(executions(run).length, 7);
  assert.equal(run.attempts.length, 8);
  assert.match(toHtmlReport(run), /SYNTHETIC DEMO/);
});

test('report browser verification is required in the existing three-engine CI lane', async () => {
  const ci = await readFile('.github/workflows/ci.yml', 'utf8');
  const teamboard = ci.slice(ci.indexOf('  teamboard:'), ci.indexOf('  ledgerguard:'));
  assert.match(teamboard, /playwright install --with-deps chromium firefox webkit/);
  assert.match(teamboard, /run: npm run test:report-browser/);
  const script = await readFile('scripts/report/browser-check.mjs', 'utf8');
  assert.match(script, /'chromium,firefox,webkit'/);
  assert.match(script, /javaScriptEnabled: false/);
  assert.match(script, /throw error;/);
  assert.doesNotMatch(teamboard, /continue-on-error/);
});
