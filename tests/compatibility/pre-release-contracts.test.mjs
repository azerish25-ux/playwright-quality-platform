import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RESULT_SCHEMA_VERSION } from '@azerish25-ux/forgeqa-core';
import { validateReportDocument } from '../../scripts/pr-report/evidence.mjs';
import { REPORT_KIND, REPORT_SCHEMA_VERSION } from '../../scripts/pr-report/shared.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const fixture = JSON.parse(await readFile(new URL('./fixtures/pre-release-contracts.v1.json', import.meta.url), 'utf8'));
const readJson = async (path) => JSON.parse(await readFile(resolve(root, path), 'utf8'));

function topLevelChildren(yaml, section) {
  const lines = yaml.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((line) => line === `${section}:`);
  assert.notEqual(start, -1, `action.yml contains ${section}`);
  const keys = [];
  for (const line of lines.slice(start + 1)) {
    if (/^[^\s#][^:]*:/.test(line)) break;
    const match = /^  ([A-Za-z0-9-]+):\s*$/.exec(line);
    if (match) keys.push(match[1]);
  }
  return keys.sort();
}

function reportFixture(schemaVersion) {
  const aggregate = schemaVersion === 1
    ? { verify: 'success', consumer: 'success', teamboard: 'success', action: 'success', gateStep: 'success' }
    : schemaVersion === 2
      ? { verify: 'success', consumer: 'success', teamboard: 'success', ledgerguard: 'success', action: 'success', gateStep: 'success' }
      : { verify: 'success', consumer: 'success', teamboard: 'success', ledgerguard: 'success', hardening: 'success', action: 'success', gateStep: 'success' };
  return {
    schemaVersion,
    kind: REPORT_KIND,
    repository: 'azerish25-ux/playwright-quality-platform',
    workflow: 'CI',
    workflowPath: '.github/workflows/ci.yml',
    runId: 100,
    runAttempt: 1,
    pullRequestNumber: 10,
    pullRequestHeadSha: '1'.repeat(40),
    pullRequestBaseSha: '2'.repeat(40),
    sourceHeadSha: '1'.repeat(40),
    testedSha: '3'.repeat(40),
    aggregate,
    generatedAt: '2026-09-27T14:04:00.000Z',
  };
}

const reportContext = {
  repository: 'azerish25-ux/playwright-quality-platform',
  workflowName: 'CI',
  workflowPath: '.github/workflows/ci.yml',
  runId: 100,
  runAttempt: 1,
  prNumber: 10,
  headSha: '1'.repeat(40),
  baseSha: '2'.repeat(40),
  sourceSha: '1'.repeat(40),
  testedSha: '3'.repeat(40),
  runCreatedAt: '2026-09-27T14:00:00.000Z',
  runUpdatedAt: '2026-09-27T14:05:00.000Z',
};

test('the eight public package boundaries remain frozen and independently publishable', async () => {
  assert.equal(fixture.schemaVersion, 1);
  assert.equal(fixture.kind, 'forgeqa-pre-release-contracts');
  const actualDirectories = (await Promise.all(fixture.packages.map(async (contract) => {
    const pkg = await readJson(`packages/${contract.directory}/package.json`);
    assert.equal(pkg.name, contract.name);
    assert.equal(pkg.version, fixture.packageVersion);
    assert.equal(pkg.type, 'module');
    assert.equal(pkg.main, contract.main);
    assert.equal(pkg.types, contract.types);
    assert.equal(pkg.exports['.'].import, contract.main);
    assert.equal(pkg.exports['.'].types, contract.types);
    assert.equal(pkg.engines.node, fixture.packageNodeEngine);
    assert.equal(pkg.license, 'MIT');
    assert.equal(pkg.publishConfig?.access, 'public');
    assert.ok(pkg.files.includes('dist'));
    assert.ok(pkg.files.includes('README.md'));
    assert.ok(pkg.files.includes('LICENSE'));
    if (contract.bin) assert.deepEqual(pkg.bin, contract.bin);
    for (const group of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      for (const value of Object.values(pkg[group] ?? {})) assert.doesNotMatch(value, /^(?:workspace|file|link):/);
    }
    await stat(resolve(root, `packages/${contract.directory}/${contract.main}`));
    await stat(resolve(root, `packages/${contract.directory}/${contract.types}`));
    return contract.directory;
  }))).sort();
  assert.deepEqual(actualDirectories, fixture.packages.map((entry) => entry.directory).sort());
});

test('private maintainer tooling cannot silently narrow the frozen public runtime', async () => {
  const rootPackage = await readJson('package.json');
  assert.equal(rootPackage.private, true);
  assert.equal(fixture.packageNodeEngine, '>=22');
  assert.equal(rootPackage.engines.node, '^22.14.0 || >=24.10.0');
  assert.notEqual(rootPackage.engines.node, fixture.packageNodeEngine);
  for (const contract of fixture.packages) {
    const pkg = await readJson(`packages/${contract.directory}/package.json`);
    assert.equal(pkg.engines.node, fixture.packageNodeEngine, `${pkg.name} must retain consumer support independently of release tooling.`);
  }
});

test('root scripts expose the frozen verification and hardening entrypoints', async () => {
  const rootPackage = await readJson('package.json');
  for (const script of fixture.rootScripts) assert.equal(typeof rootPackage.scripts[script], 'string', `missing ${script}`);
  assert.match(rootPackage.scripts.hardening, /coverage/);
  assert.match(rootPackage.scripts.hardening, /package:hardening/);
});

test('the composite action input, output, and runtime contract is frozen', async () => {
  const action = await readFile(resolve(root, 'action.yml'), 'utf8');
  assert.deepEqual(topLevelChildren(action, 'inputs'), [...fixture.action.inputs].sort());
  assert.deepEqual(topLevelChildren(action, 'outputs'), [...fixture.action.outputs].sort());
  assert.match(action, new RegExp(`using:\\s*${fixture.action.runtime}`));
  assert.match(action, new RegExp(`main:\\s*${fixture.action.main.replaceAll('.', '\\.')}`));
});

test('result and PR-report schemas preserve v1/v2 while introducing hardening-aware v3', () => {
  assert.equal(RESULT_SCHEMA_VERSION, fixture.schemas.result);
  assert.equal(REPORT_SCHEMA_VERSION, 3);
  assert.deepEqual(fixture.schemas.prReports, [1, 2, 3]);
  for (const version of fixture.schemas.prReports) {
    assert.equal(validateReportDocument(reportFixture(version), reportContext).schemaVersion, version);
  }
  assert.throws(() => validateReportDocument(reportFixture(4), reportContext), /Unsupported report schema version/);
  const missingHardening = reportFixture(3);
  delete missingHardening.aggregate.hardening;
  assert.throws(() => validateReportDocument(missingHardening, reportContext), /unexpected fields/);
});

test('the packed CLI entrypoint remains executable with documented exit semantics', () => {
  const execution = spawnSync(process.execPath, ['packages/cli/dist/cli.js', '--help'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  assert.equal(execution.status, 0, execution.stderr);
  assert.match(execution.stdout, /ForgeQA|forgeqa/i);
  assert.match(execution.stdout, /init|plan|run|report/i);
});
