import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { protocolDigest } from '../benchmarks/lib/measurement.mjs';
test('protocol compares actual capacity without mistaking reserved pages for a VM class', async () => {
  const runner = { platform: 'linux', arch: 'x64', node: '22', playwright: '1.58.2', image: 'ubuntu24', imageVersion: 'fixed', cpuCount: 4, totalMemoryBytes: 16766414848 };
  assert.equal(await protocolDigest(runner), await protocolDigest({...runner, totalMemoryBytes: 16766410752}));
  assert.notEqual(await protocolDigest(runner), await protocolDigest({...runner, totalMemoryBytes: 8 * 1024 ** 3}));
  assert.notEqual(await protocolDigest(runner), await protocolDigest({...runner, cpuCount: 2}));
});
test('role transitions await completed logout instead of racing a new navigation', async () => {
  const fixtures = await readFile('examples/demo-saas/tests/fixtures.ts', 'utf8');
  const ui = await readFile('examples/demo-saas/tests/teamboard.ui.spec.ts', 'utf8');
  assert.match(fixtures, /logoutPage[\s\S]*waitForResponse[\s\S]*\/api\/logout[\s\S]*response\.status/);
  assert.match(ui, /await logoutPage\(page\);await loginPage\(page,tenant,'viewer'\)/);
  assert.doesNotMatch(ui, /Sign out.*?\.click\(\);await loginPage/);
});
test('supplementary evidence uses real reporters and public merge APIs with a cleanup gate', async () => {
  const workflow = await readFile('.github/workflows/benchmark-secondary.yml', 'utf8');
  assert.match(workflow, /reporter-overhead\.mjs/);
  assert.match(workflow, /result-scaling\.mjs/);
  assert.match(workflow, /verify-cleanup\.mjs/);
  const source = await readFile('benchmarks/reporter-overhead.mjs', 'utf8');
  assert.match(source, /json,blob,@azerish25-ux\/forgeqa-playwright\/reporter/);
  assert.match(source, /inventory\.count !== 20/);
});
