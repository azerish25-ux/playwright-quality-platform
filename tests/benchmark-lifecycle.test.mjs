import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { protocolDigest, assessHardware } from '../benchmarks/lib/measurement.mjs';
test('software protocol stays exact while every memory difference blocks performance comparability', async () => {
  const runner = { platform: 'linux', arch: 'x64', node: '22', playwright: '1.58.2', image: 'ubuntu24', imageVersion: 'fixed', cpuCount: 4, cpuModel: 'reference', totalMemoryBytes: 16766414848 };
  const changed = {...runner, totalMemoryBytes: 16766410752};
  assert.equal(await protocolDigest(runner), await protocolDigest(changed));
  assert.notEqual(await protocolDigest(runner), await protocolDigest({...runner, cpuCount: 2}));
  assert.notEqual(await protocolDigest(runner), await protocolDigest({...runner, playwright: 'different'}));
  const cohort = [{shards:1, runners:[runner]}, {shards:1, runners:[runner]}];
  assert.equal(assessHardware(cohort).comparable, true);
  for (const totalMemoryBytes of [runner.totalMemoryBytes - 1, changed.totalMemoryBytes, 8 * 1024 ** 3]) {
    assert.equal(assessHardware([cohort[0], {shards:1, runners:[{...runner, totalMemoryBytes}]}]).comparable, false);
  }
  assert.equal(assessHardware([{shards:1, runners:[]}]).comparable, false);
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
