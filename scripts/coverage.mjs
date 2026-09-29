import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const evidenceDirectory = resolve(root, 'evidence/hardening');
const lcovPath = resolve(evidenceDirectory, 'policy-kernel.lcov');
await mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });

const includedModules = [
  'packages/core/dist/lifecycle.js',
  'packages/core/dist/recovery.js',
  'packages/playwright/dist/authentication.js',
  'packages/playwright/dist/owned-files.js',
  'packages/playwright/dist/overrides.js',
  'packages/core/dist/stable.js',
  'packages/core/dist/redaction.js',
  'packages/core/dist/identity.js',
  'packages/core/dist/gates.js',
  'packages/core/dist/selection.js',
  'packages/test-data/dist/factory.js',
  'packages/test-data/dist/namespace.js',
  'packages/test-data/dist/cleanup.js',
  'packages/reporter/dist/merge.js',
  'packages/flake-analysis/dist/quarantine.js',
];
const testFiles = [
  'tests/fixture-lifecycle.test.mjs',
  'tests/recovery.test.mjs',
  'tests/recovery-cli.test.mjs',
  'tests/recovery-process.test.mjs',
  'tests/core.test.mjs',
  'tests/data.test.mjs',
  'tests/reporter.test.mjs',
  'tests/flake.test.mjs',
  'tests/hardening/property-invariants.test.mjs',
  'tests/hardening/edge-invariants.test.mjs',
  'tests/hardening/seeded-defects.test.mjs',
  'tests/compatibility/pre-release-contracts.test.mjs',
];
const thresholds = { lines: 90, branches: 85, functions: 85 };
const args = [
  '--test',
  '--test-concurrency=1',
  '--experimental-test-coverage',
  `--test-coverage-lines=${thresholds.lines}`,
  `--test-coverage-branches=${thresholds.branches}`,
  `--test-coverage-functions=${thresholds.functions}`,
  ...includedModules.flatMap((path) => [`--test-coverage-include=${path}`]),
  '--test-reporter=spec',
  '--test-reporter-destination=stdout',
  '--test-reporter=lcov',
  `--test-reporter-destination=${lcovPath}`,
  ...testFiles,
];
const execution = spawnSync(process.execPath, args, {
  cwd: root,
  encoding: 'utf8',
  env: { ...process.env, CI: '1', NO_COLOR: '1' },
  maxBuffer: 64 * 1024 * 1024,
});
if (execution.stdout) process.stdout.write(execution.stdout);
if (execution.stderr) process.stderr.write(execution.stderr);
if (execution.error) throw execution.error;
if (execution.status !== 0) process.exit(execution.status ?? 1);

const lcov = await readFile(lcovPath, 'utf8');
const totals = { lines: { found: 0, hit: 0 }, branches: { found: 0, hit: 0 }, functions: { found: 0, hit: 0 } };
for (const line of lcov.split(/\r?\n/)) {
  const [key, raw] = line.split(':', 2);
  const value = Number(raw);
  if (!Number.isFinite(value)) continue;
  if (key === 'LF') totals.lines.found += value;
  if (key === 'LH') totals.lines.hit += value;
  if (key === 'BRF') totals.branches.found += value;
  if (key === 'BRH') totals.branches.hit += value;
  if (key === 'FNF') totals.functions.found += value;
  if (key === 'FNH') totals.functions.hit += value;
}
const percent = (metric) => metric.found === 0 ? 100 : Number(((metric.hit / metric.found) * 100).toFixed(2));
const actual = {
  lines: percent(totals.lines),
  branches: percent(totals.branches),
  functions: percent(totals.functions),
};
for (const [name, minimum] of Object.entries(thresholds)) {
  if (actual[name] < minimum) throw new Error(`${name} coverage ${actual[name]}% is below ${minimum}%.`);
}
await writeFile(resolve(evidenceDirectory, 'coverage-summary.json'), `${JSON.stringify({
  schemaVersion: 1,
  kind: 'forgeqa-policy-kernel-coverage',
  sourceSha: process.env.FORGEQA_SOURCE_SHA ?? null,
  generatedAt: new Date().toISOString(),
  scope: 'release-critical policy, identity, redaction, data-ownership, merge-integrity, and quarantine runtime modules',
  includedModules,
  testFiles,
  thresholds,
  totals,
  actual,
}, null, 2)}\n`, { mode: 0o600 });
console.log(`Policy-kernel coverage passed: lines ${actual.lines}%, branches ${actual.branches}%, functions ${actual.functions}%.`);
