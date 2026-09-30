import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve, relative } from 'node:path';
import { spawn } from 'node:child_process';

const root = fileURLToPath(new URL('../../', import.meta.url));
const cli = resolve(root, 'packages/cli/dist/cli.js');
const native = resolve(root, 'node_modules/@playwright/test/cli.js');
async function run(binary, args, cwd, env = {}) {
  return await new Promise((done, reject) => {
    const child = spawn(process.execPath, [binary, ...args], { cwd, env: { ...process.env, CI: '1', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 45000);
    child.stdout.on('data', chunk => { out += chunk; }); child.stderr.on('data', chunk => { err += chunk; });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); done({ code, out, err }); });
  });
}
async function snapshot(directory, prefix = '') {
  const files = {};
  for (const entry of await readdir(join(directory, prefix), { withFileTypes: true })) {
    const path = join(prefix, entry.name);
    if (entry.isDirectory()) Object.assign(files, await snapshot(directory, path));
    else files[path] = (await readFile(join(directory, path))).toString('base64');
  }
  return files;
}
function inventory(report) {
  const result = [];
  function walk(suite, titles = []) {
    for (const spec of suite.specs ?? []) for (const entry of spec.tests) {
      assert.equal(entry.status, 'expected');
      assert.equal(entry.results.length, 1); assert.equal(entry.results[0].status, 'passed');
      result.push({ path: spec.file.replaceAll('\\', '/'), title: [...titles, spec.title].filter(Boolean).join(' > '), project: entry.projectName, tags: spec.tags });
    }
    for (const child of suite.suites ?? []) walk(child, [...titles, ...(child.file === child.title ? [] : [child.title])]);
  }
  for (const suite of report.suites) walk(suite);
  assert.equal(report.errors.length, 0); assert.equal(report.stats.unexpected, 0); assert.equal(report.stats.flaky, 0); assert.equal(report.stats.skipped, 0);
  return result.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

test('existing native suite retains dependency projects, custom paths, fixtures, hooks and exact executed inventory after adoption', { timeout: 120000 }, async t => {
  await mkdir(join(root, '.tmp'), { recursive: true });
  const directory = await mkdtemp(join(root, '.tmp', 'existing suite Ω '));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const files = {
    'package.json': JSON.stringify({ name: 'existing-suite-contract', private: true, type: 'module', scripts: { test: 'playwright test' } }),
    'application.mjs': 'export const answer = 42;\n',
    'acceptance/custom/fixtures.ts': `import {test as base,expect} from '@playwright/test';
import {answer} from '../../application.mjs';
export const nativeBase=base.extend<{answer:number},{workerLabel:string}>({
  workerLabel:[async({},use,worker)=>{await use('worker-'+worker.parallelIndex);},{scope:'worker'}],
  answer:async({workerLabel},use)=>{expect(workerLabel).toMatch(/^worker-/);await use(answer);}
});
export const test=nativeBase;export {expect};\n`,
    'acceptance/custom/seed.setup.ts': `import {test,expect} from './fixtures.js';
import {writeFileSync} from 'node:fs';
test('seed dependency',{tag:'@smoke'},async({answer})=>{expect(answer).toBe(42);writeFileSync('seed-ready.txt','owned-test-marker');});\n`,
    'acceptance/custom/cases.spec.ts': `import {test,expect} from './fixtures.js';
import {readFileSync,appendFileSync} from 'node:fs';
test.beforeEach(async()=>{expect(readFileSync('seed-ready.txt','utf8')).toBe('owned-test-marker');});
test.afterEach(async({},info)=>{appendFileSync('hook-events.txt',info.project.name+':'+info.title+'\\n');});
test.describe('existing group',()=>{
  test('preserves answer',{tag:'@regression'},async({answer},info)=>{expect(answer).toBe(42);expect(info.project.metadata.owner).toBe('existing-team');});
  test('preserves native baseURL',{tag:'@release'},async({baseURL})=>{expect(baseURL).toBe('http://127.0.0.1:31999');});
});\n`,
    'native-settings.ts': `export default {testDir:'./acceptance/custom',fullyParallel:true,workers:2,retries:0,timeout:5000,
use:{baseURL:'http://127.0.0.1:31999'},metadata:{existing:true},
reporter:[['json',{outputFile:'native-result.json'}]],
projects:[{name:'bootstrap',testMatch:'**/*.setup.ts'},
{name:'service-a',testMatch:'**/*.spec.ts',dependencies:['bootstrap'],metadata:{owner:'existing-team'}},
{name:'service-b',testMatch:'**/*.spec.ts',dependencies:['bootstrap'],metadata:{owner:'existing-team'}}]};\n`,
    'playwright.config.ts': `import {defineConfig} from '@playwright/test';import native from './native-settings.js';export default defineConfig(native);\n`
  };
  for (const [path, content] of Object.entries(files)) { await mkdir(resolve(directory, path, '..'), { recursive: true }); await writeFile(join(directory, path), content); }
  const before = await snapshot(directory);
  const conflict = await run(cli, ['init', '--template', 'existing', '--destination', directory, '--json'], directory);
  assert.equal(conflict.code, 2, conflict.out + conflict.err);
  assert.deepEqual(await snapshot(directory), before, 'Conflicting adoption must not partially edit the existing app.');
  const staged = await run(cli, ['init', '--template', 'existing', '--destination', join(directory, 'review'), '--json'], directory);
  assert.equal(staged.code, 0, staged.out + staged.err);
  await rm(join(directory, 'review'), { recursive: true });
  const baseline = await run(native, ['test'], directory);
  assert.equal(baseline.code, 0, baseline.out + baseline.err);
  const originalReport = JSON.parse(await readFile(join(directory, 'native-result.json'), 'utf8'));
  const originalInventory = inventory(originalReport); assert.equal(originalInventory.length, 5);
  assert.equal((await readFile(join(directory, 'hook-events.txt'), 'utf8')).trim().split('\n').length, 4);
  await rm(join(directory, 'seed-ready.txt')); await rm(join(directory, 'hook-events.txt'));

  // Only the explicit integration seam changes. App, assertions, hooks, selectors,
  // project dependencies and native settings stay byte-for-byte identical.
  await writeFile(join(directory, 'forgeqa.config.ts'), `import {defineForgeConfig} from '@azerish25-ux/forgeqa-core';export default defineForgeConfig({project:'existing-suite-contract',environments:{local:{baseUrl:'http://127.0.0.1:31999'}},browsers:[],workers:2,retries:0,timeout:5000});\n`);
  await writeFile(join(directory, 'playwright.config.ts'), `import {defineForgePlaywrightConfig} from '@azerish25-ux/forgeqa-playwright';import forge from './forgeqa.config.js';import native from './native-settings.js';export default defineForgePlaywrightConfig(forge,native);\n`);
  await writeFile(join(directory, 'acceptance/custom/fixtures.ts'), files['acceptance/custom/fixtures.ts'].replace('export const test=nativeBase;', "import {createForgeTest} from '@azerish25-ux/forgeqa-playwright';export const test=createForgeTest(nativeBase);"));
  const adopted = await run(native, ['test'], directory, { FORGEQA_RUN_ID: 'adopted-native' });
  assert.equal(adopted.code, 0, adopted.out + adopted.err);
  assert.deepEqual(inventory(JSON.parse(await readFile(join(directory, 'native-result.json'), 'utf8'))), originalInventory);
  const nativeCanonical = JSON.parse(await readFile(join(directory, 'forgeqa-results/adopted-native/report.json'), 'utf8'));
  await rm(join(directory, 'seed-ready.txt')); await rm(join(directory, 'hook-events.txt'));
  const planned = await run(cli, ['plan', '--suite', 'release', '--json'], directory);
  assert.equal(planned.code, 0, planned.out + planned.err);
  assert.equal(JSON.parse(planned.out).manifest.expected.length, 5);
  const executed = await run(cli, ['run', '--suite', 'release', '--json'], directory);
  assert.equal(executed.code, 0, executed.out + executed.err);
  const summary = JSON.parse(executed.out);
  assert.equal(summary.tests, 5); assert.equal(summary.attempts, 5);
  const canonical = JSON.parse(await readFile(join(summary.runDir, 'report.json'), 'utf8'));
  const identities = report => report.attempts.map(attempt => `${attempt.logicalTestId}:${attempt.project}:${attempt.environment}`).sort();
  assert.deepEqual(identities(canonical), identities(nativeCanonical));
  assert.deepEqual(inventory(JSON.parse(await readFile(join(directory, 'native-result.json'), 'utf8'))), originalInventory);
  assert.equal((await readFile(join(directory, 'hook-events.txt'), 'utf8')).trim().split('\n').length, 4);
  for (const path of Object.keys(files).filter(path => !['playwright.config.ts', 'acceptance/custom/fixtures.ts'].includes(path))) assert.equal(await readFile(join(directory, path), 'utf8'), files[path], `${relative(directory, join(directory, path))} changed during adoption`);
});
