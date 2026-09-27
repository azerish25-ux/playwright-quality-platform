import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

const LEDGERGUARD_SHA = '9478663f97f9dc65d0c85117f244e1b8b80c37cb';
const packages = ['core', 'api', 'test-data', 'reporter', 'flake-analysis', 'playwright', 'github-action', 'cli'];
const root = process.cwd();
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run LedgerGuard acceptance through npm run test:ledgerguard.');

const ledgerRoot = resolve(process.env.LEDGERGUARD_ROOT ?? '.tmp/ledgerguard');
const evidence = resolve('evidence/ledgerguard');
const temporary = await mkdtemp(join(tmpdir(), 'ForgeQA LedgerGuard '));
const artifacts = join(temporary, 'packages');
const runtimeEnv = join(temporary, 'ledgerguard.env');
const project = `forgeqa-ledger-${randomBytes(4).toString('hex')}`;
const startedAt = new Date().toISOString();
const secrets = {
  postgres: randomBytes(32).toString('hex'),
  owner: randomBytes(32).toString('hex'),
  runtime: randomBytes(32).toString('hex'),
  rabbit: randomBytes(32).toString('hex'),
  auth: randomBytes(64).toString('base64'),
  demo: `Fq!${randomBytes(24).toString('base64url')}Aa9`
};
let primaryFailure;
let acceptanceRecord;
let httpPort;
let rabbitPort;
let sourceSha = process.env.FORGEQA_SOURCE_SHA ?? 'unknown';

await mkdir(evidence, { recursive: true });
await mkdir(artifacts, { recursive: true });

try {
  sourceSha = process.env.FORGEQA_SOURCE_SHA ?? (await command('git', ['rev-parse', 'HEAD'], { cwd: root })).trim();
  const ledgerSha = (await command('git', ['rev-parse', 'HEAD'], { cwd: ledgerRoot })).trim();
  assert.equal(ledgerSha, LEDGERGUARD_SHA, 'LedgerGuard checkout must match the verified P07A source SHA.');

  await command('docker', ['info'], { timeoutMs: 60_000 });
  await command('docker', ['compose', 'version'], { timeoutMs: 60_000 });
  httpPort = await freePort();
  rabbitPort = await freePort();
  await writeFile(runtimeEnv, runtimeEnvironment({ httpPort, rabbitPort }), { encoding: 'utf8', mode: 0o600 });

  const compose = composeArguments(runtimeEnv, ledgerRoot);
  await command('docker', [
    ...compose,
    'up', '-d', '--build', '--wait', '--wait-timeout', '360'
  ], { cwd: ledgerRoot, timeoutMs: 12 * 60_000 });
  await command('docker', [
    ...compose,
    '--profile', 'tools', 'run', '--rm', 'seed'
  ], { cwd: ledgerRoot, timeoutMs: 3 * 60_000 });

  const baseUrl = `http://127.0.0.1:${httpPort}`;
  const system = await waitForReadiness(baseUrl, 180_000);
  assert.equal(system.databaseRole, 'ledger_runtime');
  const running = new Set((await command('docker', [...compose, 'ps', '--status', 'running', '--services'], { cwd: ledgerRoot })).split(/\s+/).filter(Boolean));
  for (const service of ['postgres', 'rabbitmq', 'api', 'outbox-publisher', 'payment-worker-a', 'payment-worker-b', 'scheduler-a', 'scheduler-b']) {
    assert(running.has(service), `LedgerGuard service ${service} must be running.`);
  }

  const packageSpecs = {};
  const packageChecksums = {};
  for (const directory of packages) {
    const metadata = JSON.parse(await readFile(join(root, 'packages', directory, 'package.json'), 'utf8'));
    const packedOutput = await node([npm, 'pack', `./packages/${directory}`, '--pack-destination', artifacts, '--json', '--ignore-scripts'], {
      cwd: root,
      timeoutMs: 3 * 60_000
    });
    const packed = JSON.parse(packedOutput)[0];
    assert(packed.files.some(file => file.path === 'dist/index.js'));
    assert(packed.files.some(file => file.path === 'dist/index.d.ts'));
    assert(!packed.files.some(file => /(^|\/)(node_modules|\.env|src|test-results|\.auth)(\/|$)/.test(file.path)));
    const archive = join(artifacts, packed.filename);
    packageSpecs[metadata.name] = `file:${archive.replace(/\\/g, '/')}`;
    packageChecksums[packed.filename] = createHash('sha256').update(await readFile(archive)).digest('hex');
  }
  await writeFile(join(evidence, 'package-checksums.json'), `${JSON.stringify(packageChecksums, null, 2)}\n`);

  const managerRuns = [];
  let expectedIdentities;
  for (const manager of ['npm', 'pnpm']) {
    const consumer = join(temporary, `ledgerguard-${manager}`);
    await copyConsumer(consumer);
    await installPackedConsumer(consumer, manager, packageSpecs);

    const require = createRequire(join(consumer, 'package.json'));
    await cp(join(root, 'tests/consumers/public-exports.mjs'), join(consumer, 'public-exports.mjs'));
    const resolved = JSON.parse(await node([join(consumer, 'public-exports.mjs'), ...Object.keys(packageSpecs)], {
      cwd: consumer,
      timeoutMs: 60_000
    }));
    assert.equal(Object.keys(resolved.entries).length, packages.length);

    await node([require.resolve('typescript/bin/tsc'), '--noEmit'], { cwd: consumer, timeoutMs: 2 * 60_000 });
    const runEnvironment = {
      ...process.env,
      FORGEQA_SOURCE_SHA: sourceSha,
      LEDGERGUARD_SOURCE_SHA: LEDGERGUARD_SHA,
      LEDGERGUARD_BASE_URL: baseUrl,
      LEDGERGUARD_ROOT: ledgerRoot,
      LEDGERGUARD_ENV_FILE: runtimeEnv,
      LEDGER_OWNER_PASSWORD: secrets.owner,
      LEDGER_DEMO_PASSWORD: secrets.demo,
      POSTGRES_DB: 'ledgerguard'
    };
    const summary = JSON.parse(await node([resolved.cli, 'run', '--suite', 'release', '--json'], {
      cwd: consumer,
      env: runEnvironment,
      timeoutMs: 12 * 60_000
    }));
    assert.equal(summary.exitCode, 0);
    assert.equal(summary.tests, 12);
    assert.equal(summary.attempts, 12);

    const report = JSON.parse(await readFile(join(summary.runDir, 'report.json'), 'utf8'));
    assert.equal(report.gate.outcome, 'pass');
    assert.equal(report.missingExecutions.length, 0);
    assert.equal(report.unexpectedExecutions.length, 0);
    assert.equal(report.duplicateExecutions.length, 0);
    assert(report.attempts.every(attempt => attempt.retry === 0 && attempt.outcome === 'passed'));
    const identities = report.attempts
      .map(attempt => `${attempt.logicalTestId}:${attempt.project}:${attempt.environment}`)
      .sort();
    if (expectedIdentities === undefined) expectedIdentities = identities;
    else assert.deepEqual(identities, expectedIdentities, 'npm and pnpm consumers must execute the same LedgerGuard identity set.');

    const destination = join(evidence, manager);
    await rm(destination, { recursive: true, force: true });
    await cp(summary.runDir, destination, { recursive: true });
    const sanitized = {
      manager,
      independentConsumer: true,
      forgeqaSourceSha: sourceSha,
      ledgerguardSourceSha: LEDGERGUARD_SHA,
      tests: summary.tests,
      attempts: summary.attempts,
      exitCode: summary.exitCode,
      gate: summary.gate,
      runId: summary.runId
    };
    await writeFile(join(evidence, `${manager}.json`), `${JSON.stringify(sanitized, null, 2)}\n`);
    managerRuns.push(sanitized);
  }

  const reconciliation = Number(await sqlScalar(compose, ledgerRoot,
    "SELECT count(*) FROM ledger.account_balances b JOIN ledger.accounts a ON a.id=b.account_id "
    + "WHERE b.posted_minor::numeric<>(SELECT coalesce(sum(CASE WHEN a.kind='WALLET_LIABILITY' "
    + "THEN CASE WHEN e.side='CREDIT' THEN e.amount_minor::numeric ELSE -e.amount_minor::numeric END "
    + "ELSE CASE WHEN e.side='DEBIT' THEN e.amount_minor::numeric ELSE -e.amount_minor::numeric END END),0) "
    + "FROM ledger.journal_entries e WHERE e.account_id=a.id) "
    + "OR b.reserved_minor::numeric<>(SELECT coalesce(sum(h.amount_minor::numeric),0) "
    + "FROM ledger.holds h WHERE h.account_id=a.id AND h.state='ACTIVE');"
  ));
  assert.equal(reconciliation, 0, 'LedgerGuard must reconcile after both external consumers.');

  acceptanceRecord = {
    schemaVersion: 1,
    status: 'PASS',
    startedAt,
    completedAt: new Date().toISOString(),
    forgeqaSourceSha: sourceSha,
    ledgerguardSourceSha: LEDGERGUARD_SHA,
    ledgerguardVerificationRun: 36319414655,
    consumerManagers: managerRuns,
    expectedTests: 12,
    reconciliationDiscrepancies: reconciliation,
    apiFirst: true,
    uiClaimed: false
  };
} catch (failure) {
  primaryFailure = failure;
  await writeFailure(failure);
} finally {
  if (httpPort !== undefined) {
    const compose = composeArguments(runtimeEnv, ledgerRoot);
    try {
      const logs = await command('docker', [...compose, 'logs', '--no-color'], {
        cwd: ledgerRoot,
        timeoutMs: 2 * 60_000,
        allowFailure: true
      });
      await writeFile(join(evidence, 'services.log'), sanitize(logs), 'utf8');
    } catch (failure) {
      await writeFile(join(evidence, 'log-capture-failure.txt'), sanitize(String(failure)), 'utf8');
    }
    try {
      await command('docker', [...compose, 'down', '--volumes', '--remove-orphans', '--timeout', '30'], {
        cwd: ledgerRoot,
        timeoutMs: 4 * 60_000,
        allowFailure: false
      });
      const containers = (await command('docker', ['ps', '-aq', '--filter', `label=com.docker.compose.project=${project}`], { allowFailure: true })).trim();
      const volumes = (await command('docker', ['volume', 'ls', '-q', '--filter', `label=com.docker.compose.project=${project}`], { allowFailure: true })).trim();
      assert.equal(containers, '', 'LedgerGuard acceptance leaked containers.');
      assert.equal(volumes, '', 'LedgerGuard acceptance leaked volumes.');
      await writeFile(join(evidence, 'cleanup.json'), `${JSON.stringify({ containers: 0, volumes: 0, project }, null, 2)}\n`);
    } catch (cleanupFailure) {
      if (primaryFailure === undefined) {
        primaryFailure = cleanupFailure;
        await writeFailure(cleanupFailure);
      }
      await writeFile(join(evidence, 'cleanup-failure.txt'), sanitize(String(cleanupFailure)), 'utf8');
    }
  }
  if (primaryFailure === undefined && acceptanceRecord !== undefined) {
    await writeFile(join(evidence, 'acceptance.json'), `${JSON.stringify(acceptanceRecord, null, 2)}\n`);
  }
  await rm(temporary, { recursive: true, force: true });
}

if (primaryFailure !== undefined) throw primaryFailure;


async function writeFailure(failure) {
  await writeFile(join(evidence, 'failure.json'), `${JSON.stringify({
    schemaVersion: 1,
    status: 'FAIL',
    startedAt,
    failedAt: new Date().toISOString(),
    forgeqaSourceSha: sourceSha,
    ledgerguardSourceSha: LEDGERGUARD_SHA,
    message: sanitize(failure instanceof Error ? failure.message : String(failure))
  }, null, 2)}\n`);
}

function composeArguments(envFile, checkout) {
  return [
    'compose', '--ansi', 'never', '--env-file', envFile,
    '-f', join(checkout, 'compose.yaml'),
    '-f', join(checkout, 'compose.p07.yaml')
  ];
}

function runtimeEnvironment({ httpPort, rabbitPort }) {
  return [
    `COMPOSE_PROJECT_NAME=${project}`,
    'POSTGRES_DB=ledgerguard',
    `POSTGRES_SUPERUSER_PASSWORD=${secrets.postgres}`,
    `LEDGER_OWNER_PASSWORD=${secrets.owner}`,
    `LEDGER_RUNTIME_PASSWORD=${secrets.runtime}`,
    'RABBITMQ_DEFAULT_USER=ledgerguard',
    `RABBITMQ_DEFAULT_PASS=${secrets.rabbit}`,
    'RABBITMQ_DEFAULT_VHOST=/ledgerguard',
    `LEDGER_AUTH_KEY=${secrets.auth}`,
    `LEDGER_DEMO_PASSWORD=${secrets.demo}`,
    `LEDGER_HTTP_PORT=${httpPort}`,
    `LEDGER_RABBIT_MANAGEMENT_PORT=${rabbitPort}`,
    ''
  ].join('\n');
}

async function copyConsumer(destination) {
  await mkdir(destination, { recursive: true });
  const source = join(root, 'consumers/ledgerguard');
  await cp(source, destination, {
    recursive: true,
    filter: candidate => !relative(source, candidate).split(/[\\/]/).some(part =>
      ['node_modules', 'forgeqa-results', 'test-results', '.forgeqa'].includes(part)
    )
  });
}

async function installPackedConsumer(consumer, manager, specs) {
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
  await node([executable, 'install', '--ignore-scripts', ...(manager === 'npm' ? ['--no-audit', '--no-fund'] : [])], {
    cwd: consumer,
    timeoutMs: 8 * 60_000
  });
  await node([
    executable,
    ...(manager === 'npm'
      ? ['ci', '--ignore-scripts', '--no-audit', '--no-fund']
      : ['install', '--frozen-lockfile', '--ignore-scripts'])
  ], { cwd: consumer, timeoutMs: 8 * 60_000 });
}

async function sqlScalar(compose, cwd, query) {
  return (await command('docker', [
    ...compose,
    'exec', '-T', '-e', 'PGPASSWORD',
    'postgres', 'psql', '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1',
    '-U', 'ledger_owner', '-d', 'ledgerguard', '-c', query
  ], {
    cwd,
    env: { ...process.env, PGPASSWORD: secrets.owner },
    timeoutMs: 60_000
  })).trim();
}

async function waitForReadiness(baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = 'not attempted';
  while (Date.now() < deadline) {
    try {
      const healthResponse = await fetch(`${baseUrl}/actuator/health/readiness`, { signal: AbortSignal.timeout(5_000) });
      const systemResponse = await fetch(`${baseUrl}/api/v1/system`, { signal: AbortSignal.timeout(5_000) });
      const health = await healthResponse.json();
      const system = await systemResponse.json();
      if (healthResponse.ok && systemResponse.ok && health.status === 'UP' && system.databaseRole === 'ledger_runtime') return system;
      last = JSON.stringify({ health, system });
    } catch (failure) {
      last = failure instanceof Error ? failure.message : String(failure);
    }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 1_000));
  }
  throw new Error(`LedgerGuard did not become ready: ${last}`);
}

async function freePort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Could not allocate an acceptance port.');
  await new Promise((resolvePromise, reject) => server.close(error => error ? reject(error) : resolvePromise()));
  return address.port;
}

async function node(args, options = {}) {
  return command(process.execPath, args, options);
}

async function command(executable, args, options = {}) {
  const {
    cwd = root,
    env = process.env,
    timeoutMs = 5 * 60_000,
    allowFailure = false
  } = options;
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Command exceeded ${timeoutMs}ms: ${executable} ${args.slice(0, 4).join(' ')}`));
    }, timeoutMs);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', code => {
      clearTimeout(timer);
      if (code !== 0 && !allowFailure) {
        reject(new Error(`Command failed (${code}): ${executable} ${args.slice(0, 4).join(' ')}\n${stdout}\n${stderr}`));
      } else {
        resolvePromise(`${stdout}${allowFailure ? stderr : ''}`);
      }
    });
  });
}

function sanitize(value) {
  let result = value;
  for (const secret of Object.values(secrets)) result = result.split(secret).join('[REDACTED]');
  return result;
}
