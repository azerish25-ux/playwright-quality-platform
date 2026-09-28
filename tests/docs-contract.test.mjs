import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { assertSourceSha, expandIncludes, readSnapshot, safeRelative, sha256, validateBase, validateVersions } from '../scripts/docs/contracts.mjs';
import { pages, root, rewriteLinks } from '../scripts/docs/prepare.mjs';

const sha = 'a'.repeat(40);
async function fixture(t) {
  const root = await mkdtemp(resolve(tmpdir(), 'forgeqa-docs-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = resolve(root, 'docs/versions/v1.2.3');
  await mkdir(directory, { recursive: true });
  const text = '# Released test fixture\n';
  await writeFile(resolve(directory, 'index.md'), text);
  const manifest = JSON.stringify({ schemaVersion: 1, sourceSha: sha, files: { 'index.md': sha256(text) } });
  await writeFile(resolve(directory, 'manifest.json'), manifest);
  return { root, directory, release: { version: 'v1.2.3', sourceSha: sha, manifestSha256: sha256(manifest) } };
}
test('unreleased documentation does not invent a release snapshot', async () => {
  const versions = validateVersions(JSON.parse(await readFile(resolve(root, 'docs/versions.json'), 'utf8')));
  assert.equal(versions.current, 'next');
  assert.deepEqual(validateVersions({schemaVersion:1,current:'next',releases:[]}).releases, []);
  for (const release of versions.releases) await readSnapshot(root, release);
});
test('version contract rejects missing provenance, duplicate and unsafe versions', () => {
  const release = { version: 'v1.2.3', sourceSha: sha, manifestSha256: 'b'.repeat(64) };
  for (const releases of [[{ ...release, version: '../main' }], [{ ...release, sourceSha: 'main' }], [release, release]]) {
    assert.throws(() => validateVersions({ schemaVersion: 1, current: 'next', releases }));
  }
});
test('valid frozen test fixture retains its original content', async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await readSnapshot(f.root, f.release), { 'index.md': '# Released test fixture\n' });
});
test('frozen file tampering fails', async (t) => {
  const f = await fixture(t);
  await writeFile(resolve(f.directory, 'index.md'), '# Changed\n');
  await assert.rejects(readSnapshot(f.root, f.release), /Frozen documentation changed/);
});
test('unlisted snapshot files fail rather than becoming a silent new release', async (t) => {
  const f = await fixture(t);
  await writeFile(resolve(f.directory, 'unlisted.md'), '# Unlisted');
  await assert.rejects(readSnapshot(f.root, f.release), /inventory mismatch/);
});
test('snapshot manifest tampering fails before reading entries', async (t) => {
  const f = await fixture(t);
  await writeFile(resolve(f.directory, 'manifest.json'), '{}');
  await assert.rejects(readSnapshot(f.root, f.release), /checksum mismatch/);
});
test('mounts and file paths reject escape and malformed values', () => {
  for (const path of ['../secret', '/etc/passwd', 'C:\\private', 'a/../../b', 'a//b', 'a/./b']) assert.throws(() => safeRelative(path));
  for (const base of ['relative/', '/a/../', '//', '/a/?query']) assert.throws(() => validateBase(base));
  assert.equal(validateBase('/project/'), '/project/');
  assert.equal(validateBase('/'), '/');
  assert.throws(() => assertSourceSha('main'));
});
test('embedded snippets are the exact maintained TypeScript files', async () => {
  const path = 'docs/snippets/fixtures.ts';
  const expanded = await expandIncludes(`<!-- forgeqa:include ${path} -->`, root);
  assert(expanded.includes((await readFile(resolve(root, path), 'utf8')).trimEnd()));
  await assert.rejects(expandIncludes('<!-- forgeqa:include packages/core/src/index.ts -->', root), /outside/);
  await assert.rejects(expandIncludes('<!-- forgeqa:include docs/snippets/missing.ts -->', root));
  await assert.rejects(expandIncludes('<!-- forgeqa:include bad syntax -->', root), /Malformed/);
});
test('site links are remapped but illustrative code is left untouched', async () => {
  const routes = new Map([['docs/cli.md', 'next/cli.md']]);
  const text = '[CLI](../cli.md)\n```text\n[Not a link](missing.md)\n```\n';
  const transformed = await rewriteLinks(text, 'docs/guide/index.md', 'next/index.md', routes, sha);
  assert.match(transformed, /\[CLI\]\(cli.md\)/);
  assert.match(transformed, /\[Not a link\]\(missing.md\)/);
});
test('bad source links fail rather than becoming a broken website', async () => {
  await assert.rejects(rewriteLinks('[Missing](missing.md)', 'docs/guide/index.md', 'next/index.md', new Map(), sha));
  await assert.rejects(rewriteLinks('[Unsafe](javascript:bad)', 'docs/guide/index.md', 'next/index.md', new Map(), sha), /Unsafe/);
});
test('every maintained page and important public snippet is present', async () => {
  for (const [, , source] of pages) assert((await readFile(resolve(root, source), 'utf8')).startsWith('# '), source);
  const consumer = await readFile(resolve(root, 'tests/consumers/packed.mjs'), 'utf8');
  assert.match(consumer, /mode==='docs'/);
  assert.match(consumer, /docs\/snippets/);
  assert.match(consumer, /doctor/);
});

test('documentation workflow requires all acceptance steps without deployment permissions', async () => {
  const workflow = await readFile(resolve(root, '.github/workflows/docs.yml'), 'utf8');
  for (const command of ['npm run docs:onboarding', 'mkdocs build --strict', 'check_site.py', 'browser-check.mjs', 'npm run test:docs']) assert(workflow.includes(command), command);
  assert.match(workflow, /contents: read/);
  assert(!workflow.includes('pages: write'));
  assert(!workflow.includes('id-token: write'));
});
