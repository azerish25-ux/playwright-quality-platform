import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, cp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { rewritePackage, inspectPackedMetadata, assertAuditedArtifact } from '../scripts/release-prepare.mjs';
import { validateConsumerReceipt, validateRegistryReceipt, assertPublicContext, withPublicationLock } from '../scripts/release-engine.mjs';
import { RELEASE_PACKAGES, artifactDigests } from '../scripts/release-state.mjs';
import { execute } from '../scripts/release-process.mjs';

const packageFixture = () => ({ name: RELEASE_PACKAGES[0], version: '0.1.0', private: false, publishConfig: { access: 'public' },
  main: './dist/index.js', types: './dist/index.d.ts', exports: { '.': { import: './dist/index.js', types: './dist/index.d.ts' } },
  dependencies: { [RELEASE_PACKAGES[1]]: '0.1.0' }, optionalDependencies: { [RELEASE_PACKAGES[2]]: '^0.1.0' },
  peerDependencies: { [RELEASE_PACKAGES[3]]: 'workspace:~', external: '>=2 <3' }, devDependencies: { [RELEASE_PACKAGES[4]]: 'workspace:*' } });

test('one calculated version rewrites all internal dependency kinds and preserves private source inputs', () => {
  const original = packageFixture(), before = structuredClone(original), prepared = rewritePackage(original, '2.1.0');
  assert.deepEqual(original, before);
  assert.equal(prepared.version, '2.1.0');
  assert.equal(prepared.dependencies[RELEASE_PACKAGES[1]], '2.1.0');
  assert.equal(prepared.optionalDependencies[RELEASE_PACKAGES[2]], '^2.1.0');
  assert.equal(prepared.peerDependencies[RELEASE_PACKAGES[3]], '~2.1.0');
  assert.equal(prepared.devDependencies[RELEASE_PACKAGES[4]], '2.1.0');
  assert.equal(prepared.peerDependencies.external, '>=2 <3');
  for (const patch of [{ private: true }, { name: 'private-example' }, { publishConfig: { access: 'public', registry: 'https://example.invalid/' } }, { dependencies: { external: 'file:../other' } }, { dependencies: { [RELEASE_PACKAGES[1]]: '>=0.1' } }]) assert.throws(() => rewritePackage({ ...before, ...patch }, '2.1.0'));
});

test('prepared tarball audit refuses inventory drift, missing runtime/declarations and unsafe paths', () => {
  const manifest = rewritePackage(packageFixture(), '2.1.0');
  const files = ['package.json', 'README.md', 'LICENSE', 'dist/index.js', 'dist/index.d.ts'];
  const pack = { name: manifest.name, version: manifest.version, filename: 'fixture.tgz', files: files.map(path => ({ path })) };
  assert.deepEqual(inspectPackedMetadata(pack, manifest, files), [...files].sort());
  for (const path of ['../escape', '.npmrc', '.auth/session.json', 'tests/private.test.js', 'dist/new-unaccepted.js']) assert.throws(() => inspectPackedMetadata({ ...pack, files: [...pack.files, { path }] }, manifest, files));
  assert.throws(() => inspectPackedMetadata({ ...pack, version: '0.1.0' }, manifest, files));
  assert.throws(() => inspectPackedMetadata({ ...pack, files: pack.files.slice(1) }, manifest, files));
});

test('installed CLI and generated dependencies follow rewritten package metadata', async () => {
  const root = await mkdtemp(join(tmpdir(), 'forgeqa-versioned-cli-'));
  try {
    await mkdir(join(root, 'dist'));
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: '@azerish25-ux/forgeqa-cli', version: '9.8.7', type: 'module' }));
    await cp(resolve('packages/cli/dist/version.js'), join(root, 'dist/version.js'));
    await cp(resolve('packages/cli/dist/templates.js'), join(root, 'dist/templates.js'));
    const source = `import {VERSION} from './dist/version.js';import {templateFiles} from './dist/templates.js';console.log(JSON.stringify({version:VERSION,generated:['npm','pnpm'].flatMap(manager=>['demo','existing'].map(template=>JSON.parse(templateFiles(manager,template)['package.json']).devDependencies))}));`;
    await writeFile(join(root, 'probe.mjs'), source);
    const output = JSON.parse(await execute(process.execPath, [join(root, 'probe.mjs')], { cwd: tmpdir() }));
    assert.equal(output.version, '9.8.7');
    assert.equal(output.generated.length, 4);
    for (const dependencies of output.generated) {
      assert.equal(Object.keys(dependencies).filter(name => name.startsWith('@azerish25-ux/')).length, 3);
      for (const [name, version] of Object.entries(dependencies)) if (name.startsWith('@azerish25-ux/')) assert.equal(version, '9.8.7');
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('consumer receipts must bind all eight versions and digests to the exact source/distribution', () => {
  const manifest = { sourceSha: 'a'.repeat(40), version: '1.0.0', entries: RELEASE_PACKAGES.map((name, i) => ({ name, filename: `${i}.tgz`, sha256: `${i}`.repeat(64) })) };
  const receipt = { schemaVersion: 1, status: 'PASS', sourceSha: manifest.sourceSha, version: manifest.version, manager: 'npm', distribution: 'prepared-tarballs', initializer: 'installed-cli', tests: 2, attempts: 2,
    versions: Object.fromEntries(RELEASE_PACKAGES.map(name => [name, '1.0.0'])), packageChecksums: Object.fromEntries(manifest.entries.map(entry => [entry.filename, entry.sha256])) };
  validateConsumerReceipt(receipt, manifest, 'npm', 'prepared-tarballs');
  for (const patch of [{ status: 'PARTIAL' }, { sourceSha: 'b'.repeat(40) }, { version: '0.1.0' }, { attempts: 3 }, { distribution: 'public-npm' }, { versions: {} }, { packageChecksums: {} }]) assert.throws(() => validateConsumerReceipt({ ...receipt, ...patch }, manifest, 'npm', 'prepared-tarballs'));
});

test('public publishing cannot run locally, automatically, from another ref, or without OIDC/scope confirmation', () => {
  const sha = 'a'.repeat(40), repository = 'azerish25-ux/playwright-quality-platform';
  const env = { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: repository, GITHUB_REF: 'refs/heads/main', GITHUB_SHA: sha, GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_WORKFLOW_REF: `${repository}/.github/workflows/release.yml@refs/heads/main`, FORGEQA_CONFIRM_SOURCE: sha, FORGEQA_CONFIRM_NPM_SCOPE: 'true', ACTIONS_ID_TOKEN_REQUEST_URL: 'https://example.invalid/oidc', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'test-fixture' };
  assertPublicContext(env, sha);
  for (const key of Object.keys(env)) { const wrong = { ...env }; delete wrong[key]; assert.throws(() => assertPublicContext(wrong, sha)); }
  assert.throws(() => assertPublicContext({ ...env, GITHUB_EVENT_NAME: 'push' }, sha));
  assert.throws(() => assertPublicContext({ ...env, FORGEQA_CONFIRM_NPM_SCOPE: 'false' }, sha));
});

test('publication lock rejects overlap and is cleaned after failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'forgeqa-release-lock-'));
  try {
    await assert.rejects(withPublicationLock(root, async () => {
      await assert.rejects(withPublicationLock(root, async () => {}), /concurrent/);
      throw new Error('Injected operation failure');
    }), /Injected/);
    assert.deepEqual(await readdir(root), []);
    await withPublicationLock(root, async () => {});
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('untracked build-output changes cannot replace the artifact accepted by hardening', () => {
  const bytes = Buffer.from('audited artifact'), record = artifactDigests(bytes);
  assertAuditedArtifact(bytes, record);
  assert.throws(() => assertAuditedArtifact(Buffer.from('changed artifact'), record), /hardening/);
  assert.throws(() => assertAuditedArtifact(bytes, { ...record, size: 999 }), /hardening/);
});

test('public publication requires exact-source registry recovery and cleanup evidence', () => {
  const manifest = { sourceSha: 'a'.repeat(40), version: '1.0.0' };
  const receipt = { schemaVersion: 1, kind: 'forgeqa-registry-acceptance', status: 'PASS', ...manifest, scope: 'isolated-loopback-registry',
    interruptedAfter: 3, uniquePublications: 8, npmConsumer: 'PASS', pnpmConsumer: 'PASS', cleanup: 'PASS', publicNpmPublication: 'NOT_ATTEMPTED' };
  validateRegistryReceipt(receipt, manifest);
  for (const patch of [{ cleanup: 'FAIL' }, { sourceSha: 'b'.repeat(40) }, { version: '0.1.0' }, { uniquePublications: 7 }, { pnpmConsumer: 'NOT_RUN' }]) assert.throws(() => validateRegistryReceipt({ ...receipt, ...patch }, manifest));
});
