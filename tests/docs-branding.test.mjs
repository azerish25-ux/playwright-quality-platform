import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = path => readFile(resolve(root, path), 'utf8');
const json = async path => JSON.parse(await read(path));
const previousBrand = new RegExp('\\b' + ['Forge', 'QA'].join('') + '\\b');

test('maintained Markdown uses Deadpan rather than the previous display brand', async () => {
  const paths = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0').filter(path => /\.md$/i.test(path) && !path.startsWith('docs/versions/'));
  assert(paths.length > 30, 'The branding check must cover the documentation inventory.');
  for (const path of paths) assert.doesNotMatch(await read(path), previousBrand, path);
  assert.match(await read('README.md'), /^# Deadpan\b/);
});

test('private project metadata and its npm lock agree on deadpan', async () => {
  const manifest = await json('package.json');
  const lock = await json('package-lock.json');
  assert.equal(manifest.name, 'deadpan');
  assert.equal(manifest.private, true);
  assert.equal(lock.name, manifest.name);
  assert.equal(lock.packages[''].name, manifest.name);
});

test('Deadpan package READMEs retain the real compatible package and binary names', async () => {
  const contract = await json('tests/compatibility/fixtures/pre-release-contracts.v1.json');
  for (const entry of contract.packages) {
    const manifest = await json(`packages/${entry.directory}/package.json`);
    assert.equal(manifest.name, entry.name);
    if (entry.bin) assert.deepEqual(manifest.bin, entry.bin);
    const markdown = await read(`packages/${entry.directory}/README.md`);
    assert.match(markdown, /^# Deadpan\b/);
    assert(markdown.includes('`' + entry.name + '`'), `${entry.directory} must document its actual package name.`);
  }
});

test('the documentation site, generated onboarding, CLI banner and reports use Deadpan', async () => {
  for (const path of ['scripts/docs/prepare.mjs', 'scripts/docs/browser-check.mjs',
    'packages/cli/src/templates.ts', 'packages/cli/src/cli.ts', 'packages/reporter/src/outputs.ts', 'action.yml']) {
    const source = await read(path);
    assert(source.includes('Deadpan'), path);
    assert.doesNotMatch(source, previousBrand, path);
  }
});

test('onboarding explains the unchanged executable interfaces instead of inventing packages', async () => {
  for (const path of ['README.md', 'docs/guide/quickstart.md']) {
    const markdown = await read(path);
    assert(markdown.includes('`forgeqa`'), path);
    assert(markdown.includes('`@azerish25-ux/forgeqa-*`'), path);
  }
});
