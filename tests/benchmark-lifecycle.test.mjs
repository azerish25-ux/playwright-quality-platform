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

test('immutable container protocol does not conceal differing or missing physical host provenance', async () => {
  const runner = { platform: 'linux', arch: 'x64', node: 'v22.23.3', playwright: '1.58.2', cpuCount: 4, cpuModel: 'reference', totalMemoryBytes: 16000000000,
    containerImage: `mcr.microsoft.com/playwright:v1.58.2-noble@sha256:${'a'.repeat(64)}`, image: 'ubuntu24', imageVersion: 'host-a', release: 'kernel-a' };
  const changed = { ...runner, imageVersion: 'host-b' };
  assert.equal(await protocolDigest(runner), await protocolDigest(changed), 'An identical pinned userspace is a valid software cohort.');
  assert.notEqual(await protocolDigest(runner), await protocolDigest({ ...runner, containerImage: runner.containerImage.replace('a'.repeat(64), 'b'.repeat(64)) }));
  await assert.rejects(protocolDigest({ ...runner, containerImage: 'mcr.microsoft.com/playwright:latest' }), /immutable/);
  assert.equal(assessHardware([{ shards: 1, runners: [runner] }, { shards: 1, runners: [changed] }]).comparable, false);
  assert.equal(assessHardware([{ shards: 1, runners: [{ ...runner, imageVersion: 'local' }] }]).comparable, false);
  assert.equal(assessHardware([{ shards: 1, runners: [runner] }, { shards: 1, runners: [{ ...runner, release: 'kernel-b' }] }]).comparable, false);
});

test('all hosted benchmark jobs use the declared immutable image and matching browser userspace', async () => {
  const image = 'mcr.microsoft.com/playwright:v1.58.2-noble@sha256:65cefd09a5e943921ecd3a6e5414c603db2eb161e9eb48f2e2ccc63486dc7dc0';
  for (const name of ['benchmark.yml', 'benchmark-controlled.yml', 'benchmark-secondary.yml']) {
    const source = await readFile(`.github/workflows/${name}`, 'utf8');
    const containers = [...source.matchAll(/container: (\S+)/g)].map(match => match[1]);
    assert.equal(containers.length, [...source.matchAll(/runs-on:/g)].length);
    assert(containers.length > 0 && containers.every(value => value === image));
    assert(source.includes(`FORGEQA_BENCHMARK_IMAGE: ${image}`));
    assert.doesNotMatch(source, /playwright install --with-deps/);
    assert.match(source, /shell: bash/);
    assert.match(source, /@postgres:5432\/forgeqa_test/);
  }
});

test('controlled benchmark failures retain unmerged native evidence instead of only a summary', async () => {
  const workflow = await readFile('.github/workflows/benchmark-controlled.yml', 'utf8');
  assert.match(workflow, /if: always\(\)[\s\S]*evidence\/benchmarks\/controlled\/[\s\S]*examples\/demo-saas\/forgeqa-benchmark-results\//);
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
