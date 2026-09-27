import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = process.cwd();
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run this harness using npm run test:consumers.');
const mode = process.argv[2] ?? 'template';
if (!['template', 'teamboard', 'ledgerguard'].includes(mode)) throw new Error('Unknown consumer mode.');
const temp = await mkdtemp(join(tmpdir(), 'ForgeQA packed Ω '));
const artifacts = join(temp, 'packages');
const evidence = resolve('evidence', `packed-${mode}`);
await mkdir(artifacts);
await mkdir(evidence, { recursive: true });
const packages = ['core', 'api', 'test-data', 'reporter', 'flake-analysis', 'playwright', 'github-action', 'cli'];
const expectedTests = { template: 2, teamboard: 20, ledgerguard: 9 };

async function run(args, cwd = root, env = process.env) {
  return await new Promise((done, reject) => {
    const child = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('Consumer command exceeded eight minutes.'));
    }, 8 * 60_000);
    child.stdout.on('data', (data) => { out += data; });
    child.stderr.on('data', (data) => { err += data; });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`Command failed (${code}): ${args.slice(1, 3).join(' ')}\n${out}\n${err}`));
      else done(out);
    });
  });
}

function sourceFor(selectedMode) {
  if (selectedMode === 'teamboard') return join(root, 'examples/demo-saas');
  if (selectedMode === 'ledgerguard') return join(root, 'examples/ledgerguard-integration/consumer');
  return undefined;
}

function inventory(report) {
  return report.attempts
    .map((attempt) => `${attempt.logicalTestId}:${attempt.project}:${attempt.environment}`)
    .sort();
}

try {
  const specs = {};
  const checksums = {};
  for (const directory of packages) {
    const metadata = JSON.parse(await readFile(join(root, 'packages', directory, 'package.json'), 'utf8'));
    const packed = JSON.parse(await run([
      npm, 'pack', `./packages/${directory}`, '--pack-destination', artifacts, '--json', '--ignore-scripts',
    ]))[0];
    assert(packed.files.some((file) => file.path === 'dist/index.js'));
    assert(packed.files.some((file) => file.path === 'dist/index.d.ts'));
    assert(!packed.files.some((file) => /(^|\/)(node_modules|\.env|src|test-results|\.auth)(\/|$)/.test(file.path)));
    const file = join(artifacts, packed.filename);
    specs[metadata.name] = `file:${file.replace(/\\/g, '/')}`;
    checksums[packed.filename] = createHash('sha256').update(await readFile(file)).digest('hex');
  }
  await writeFile(join(evidence, 'package-checksums.json'), JSON.stringify(checksums, null, 2));

  for (const manager of ['npm', 'pnpm']) {
    const consumer = join(temp, `${mode}-${manager}`);
    await mkdir(consumer);
    const source = sourceFor(mode);
    if (source) {
      await cp(source, consumer, {
        recursive: true,
        filter: (candidate) => !relative(source, candidate).split(/[\\/]/)
          .some((part) => ['node_modules', 'dist', 'forgeqa-results', 'test-results'].includes(part)),
      });
    } else {
      await run([join(root, 'packages/cli/dist/cli.js'), 'init', '--destination', consumer, '--template', 'demo', '--package-manager', manager, '--json']);
    }

    const manifest = JSON.parse(await readFile(join(consumer, 'package.json'), 'utf8'));
    manifest.dependencies = { ...manifest.dependencies, ...specs };
    for (const name of Object.keys(specs)) {
      if (manifest.devDependencies) delete manifest.devDependencies[name];
    }
    manifest.devDependencies = {
      ...manifest.devDependencies,
      '@playwright/test': '1.58.2',
      typescript: '5.8.3',
      '@types/node': '22.18.6',
    };
    manifest.pnpm = { ...(manifest.pnpm ?? {}), overrides: specs };
    await writeFile(join(consumer, 'package.json'), JSON.stringify(manifest, null, 2));

    const executable = manager === 'npm' ? npm : join(root, 'node_modules/pnpm/bin/pnpm.cjs');
    await run([executable, 'install', '--ignore-scripts', ...(manager === 'npm' ? ['--no-audit', '--no-fund'] : [])], consumer);
    await run([
      executable,
      ...(manager === 'npm'
        ? ['ci', '--ignore-scripts', '--no-audit', '--no-fund']
        : ['install', '--frozen-lockfile', '--ignore-scripts']),
    ], consumer);

    const require = createRequire(join(consumer, 'package.json'));
    await cp(join(root, 'tests/consumers/public-exports.mjs'), join(consumer, 'public-exports.mjs'));
    const resolved = JSON.parse(await run([join(consumer, 'public-exports.mjs'), ...Object.keys(specs)], consumer));
    assert.equal(Object.keys(resolved.entries).length, packages.length);
    const cli = resolved.cli;

    if (mode === 'teamboard' || mode === 'ledgerguard') {
      await run([require.resolve('typescript/bin/tsc'), '--noEmit'], consumer);
      if (mode === 'teamboard') await run([join(consumer, 'build.mjs')], consumer);
    } else {
      await writeFile(join(consumer, 'contract.ts'), "import {test as base,expect} from '@playwright/test';\nimport {createForgeTest} from '@azerish25-ux/forgeqa-playwright';\nconst test=createForgeTest(base).extend<{answer:number}>({answer:42});\ntest('callable composed public interface',async({page,answer,forge})=>{expect(answer).toBe(42);expect(forge.namespace).toBeTruthy();await page.goto('/');});\ntest.describe('native annotations',()=>{});\n");
      await run([
        require.resolve('typescript/bin/tsc'), '--noEmit', '--strict', '--skipLibCheck', '--module', 'NodeNext',
        '--moduleResolution', 'NodeNext', '--target', 'ES2022', 'contract.ts',
      ], consumer);
    }

    const summary = JSON.parse(await run([cli, 'run', '--suite', 'release', '--json'], consumer));
    assert.equal(summary.exitCode, 0);
    assert.equal(summary.tests, expectedTests[mode]);
    assert.equal(summary.attempts, summary.tests);
    const runDir = resolve(consumer, summary.runDir);
    const report = JSON.parse(await readFile(join(runDir, 'report.json'), 'utf8'));
    assert.equal(report.gate.outcome, 'pass');
    assert.equal(report.missingExecutions.length, 0);
    assert.equal(report.unexpectedExecutions.length, 0);
    assert.equal(report.duplicateExecutions.length, 0);

    if (mode === 'teamboard' || mode === 'ledgerguard') {
      const workspace = JSON.parse(await readFile(join(root, `evidence/${mode}-workspace.json`), 'utf8'));
      const original = JSON.parse(await readFile(join(workspace.runDir, 'report.json'), 'utf8'));
      assert.deepEqual(inventory(report), inventory(original), `Packed ${mode} must execute the workspace identity set.`);
      assert(report.attempts.every((attempt) => attempt.retry === 0 && attempt.outcome === 'passed'), 'Retry recovery cannot satisfy consumer acceptance.');

      if (mode === 'teamboard') {
        const { default: pg } = await import('pg');
        const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
        try {
          const { rows } = await pool.query('SELECT (SELECT count(*) FROM teamboard_test_runs)::int AS namespaces,(SELECT count(*) FROM workspaces WHERE test_namespace IS NOT NULL)::int AS tenants,(SELECT count(*) FROM users WHERE test_namespace IS NOT NULL)::int AS accounts');
          assert(Object.values(rows[0]).every((value) => value === 0), 'Packed consumer leaked run-owned database resources.');
          await writeFile(join(evidence, `${manager}-cleanup.json`), JSON.stringify({ cleanup: rows[0], sameInventory: true, executions: report.attempts.length }, null, 2));
        } finally {
          await pool.end();
        }
      } else {
        await writeFile(join(evidence, `${manager}-identity.json`), JSON.stringify({
          ledgerguardSourceSha: process.env.LEDGERGUARD_SOURCE_SHA,
          sameInventory: true,
          executions: report.attempts.length,
          interface: 'public-http-api',
        }, null, 2));
      }
    }

    await cp(runDir, join(evidence, manager), { recursive: true });
    await writeFile(join(evidence, `${manager}.json`), JSON.stringify({
      manager,
      mode,
      independentConsumer: true,
      ...summary,
    }, null, 2));
    if (mode === 'template') await run([require.resolve('@playwright/test/cli'), 'test'], consumer);
    console.log(JSON.stringify({ manager, mode, tests: summary.tests, attempts: summary.attempts, gate: summary.gate.outcome, independentConsumer: true }));
  }
} finally {
  await rm(temp, { recursive: true, force: true });
}
