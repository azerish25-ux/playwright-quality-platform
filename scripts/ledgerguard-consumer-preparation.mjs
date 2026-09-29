import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, relative } from 'node:path';

export const LEDGERGUARD_PACKAGE_DIRECTORIES = Object.freeze([
  'core',
  'api',
  'test-data',
  'reporter',
  'flake-analysis',
  'playwright',
  'github-action',
  'cli'
]);

export const LEDGERGUARD_CONSUMER_MANAGERS = Object.freeze(['npm', 'pnpm']);

export async function prepareLedgerGuardConsumers({
  root,
  npm,
  temporary,
  evidenceDirectory
}) {
  if (!root) throw new Error('LedgerGuard consumer preparation requires a repository root.');
  if (!npm) throw new Error('Run LedgerGuard consumer preparation through an npm script.');
  if (!temporary) throw new Error('LedgerGuard consumer preparation requires an owned temporary directory.');

  const artifacts = join(temporary, 'packages');
  await mkdir(artifacts, { recursive: true });
  if (evidenceDirectory) await mkdir(evidenceDirectory, { recursive: true });

  const packageSpecs = {};
  const packageChecksums = {};
  for (const directory of LEDGERGUARD_PACKAGE_DIRECTORIES) {
    const metadata = JSON.parse(await readFile(join(root, 'packages', directory, 'package.json'), 'utf8'));
    const packedOutput = await node([
      npm,
      'pack',
      `./packages/${directory}`,
      '--pack-destination',
      artifacts,
      '--json',
      '--ignore-scripts'
    ], {
      cwd: root,
      timeoutMs: 3 * 60_000
    });
    const [packed] = JSON.parse(packedOutput);
    assert(packed, `npm pack returned no metadata for packages/${directory}.`);
    assert(packed.files.some(file => file.path === 'dist/index.js'));
    assert(packed.files.some(file => file.path === 'dist/index.d.ts'));
    assert(!packed.files.some(file => /(^|\/)(node_modules|\.env|src|test-results|\.auth)(\/|$)/.test(file.path)));
    const archive = join(artifacts, packed.filename);
    packageSpecs[metadata.name] = `file:${archive.replace(/\\/g, '/')}`;
    packageChecksums[packed.filename] = createHash('sha256').update(await readFile(archive)).digest('hex');
  }

  if (evidenceDirectory) {
    await writeFile(
      join(evidenceDirectory, 'package-checksums.json'),
      `${JSON.stringify(packageChecksums, null, 2)}\n`
    );
  }

  const consumers = [];
  for (const manager of LEDGERGUARD_CONSUMER_MANAGERS) {
    const consumer = join(temporary, `ledgerguard-${manager}`);
    await copyConsumer(root, consumer);
    await installPackedConsumer({ root, npm, consumer, manager, specs: packageSpecs });

    const require = createRequire(join(consumer, 'package.json'));
    await cp(join(root, 'tests/consumers/public-exports.mjs'), join(consumer, 'public-exports.mjs'));
    const resolved = JSON.parse(await node([
      join(consumer, 'public-exports.mjs'),
      ...Object.keys(packageSpecs)
    ], {
      cwd: consumer,
      timeoutMs: 60_000
    }));
    assert.equal(Object.keys(resolved.entries).length, LEDGERGUARD_PACKAGE_DIRECTORIES.length);
    assert.equal(typeof resolved.cli, 'string', 'The isolated consumer must resolve the Deadpan CLI executable.');

    await node([require.resolve('typescript/bin/tsc'), '--noEmit'], {
      cwd: consumer,
      timeoutMs: 2 * 60_000
    });
    consumers.push({ manager, consumer, resolved });
  }

  return consumers;
}

async function copyConsumer(root, destination) {
  await mkdir(destination, { recursive: true });
  const source = join(root, 'consumers/ledgerguard');
  await cp(source, destination, {
    recursive: true,
    filter: candidate => !relative(source, candidate).split(/[\\/]/).some(part =>
      ['node_modules', 'forgeqa-results', 'test-results', '.forgeqa'].includes(part)
    )
  });
}

async function installPackedConsumer({ root, npm, consumer, manager, specs }) {
  const manifestPath = join(consumer, 'package.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.dependencies = { ...manifest.dependencies, ...specs };
  for (const name of Object.keys(specs)) {
    if (manifest.devDependencies) delete manifest.devDependencies[name];
  }
  manifest.devDependencies = {
    ...manifest.devDependencies,
    '@playwright/test': '1.58.2',
    'typescript': '5.8.3',
    '@types/node': '22.18.6'
  };
  manifest.pnpm = { overrides: specs };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const executable = manager === 'npm' ? npm : join(root, 'node_modules/pnpm/bin/pnpm.cjs');
  await node([
    executable,
    'install',
    '--ignore-scripts',
    ...(manager === 'npm' ? ['--no-audit', '--no-fund'] : [])
  ], {
    cwd: consumer,
    timeoutMs: 8 * 60_000
  });
  await node([
    executable,
    ...(manager === 'npm'
      ? ['ci', '--ignore-scripts', '--no-audit', '--no-fund']
      : ['install', '--frozen-lockfile', '--ignore-scripts'])
  ], {
    cwd: consumer,
    timeoutMs: 8 * 60_000
  });
}

async function node(args, options = {}) {
  return command(process.execPath, args, options);
}

async function command(executable, args, options = {}) {
  const {
    cwd,
    env = process.env,
    timeoutMs = 5 * 60_000
  } = options;

  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', code => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`Command exceeded ${timeoutMs}ms: ${executable} ${args.slice(0, 4).join(' ')}`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`Command failed (${code}): ${executable} ${args.slice(0, 4).join(' ')}\n${stdout}\n${stderr}`));
        return;
      }
      resolvePromise(stdout);
    });
  });
}
