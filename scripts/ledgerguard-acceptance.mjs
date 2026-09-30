import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { prepareLedgerGuardConsumers } from './ledgerguard-consumer-preparation.mjs';
import { retainConsumerRun } from './ledgerguard-acceptance-support.mjs';

const LEDGERGUARD_SHA = 'd8d365690d961580d22105feb15ddec3267185ae';
const REQUIRED_SERVICES = Object.freeze([
  'postgres',
  'rabbitmq',
  'api',
  'web',
  'outbox-publisher',
  'payment-worker-a',
  'payment-worker-b',
  'scheduler-a',
  'scheduler-b'
]);
const APPLICATION_SERVICES = Object.freeze([
  'outbox-publisher',
  'payment-worker-a',
  'payment-worker-b',
  'scheduler-a',
  'scheduler-b'
]);

const root = process.cwd();
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run LedgerGuard acceptance through npm run test:ledgerguard.');

const ledgerRoot = resolve(process.env.LEDGERGUARD_ROOT ?? '.tmp/ledgerguard');
const evidence = resolve('evidence/ledgerguard');
const temporary = await mkdtemp(join(tmpdir(), 'Deadpan LedgerGuard '));
const startedAt = new Date().toISOString();
const redactions = new Set();
let primaryFailure;
let acceptanceRecord;
let sourceSha = process.env.FORGEQA_SOURCE_SHA ?? 'unknown';

await rm(evidence, { recursive: true, force: true });
await mkdir(evidence, { recursive: true });

try {
  sourceSha = process.env.FORGEQA_SOURCE_SHA ?? (await command('git', ['rev-parse', 'HEAD'], { cwd: root })).trim();
  const ledgerSha = (await command('git', ['rev-parse', 'HEAD'], { cwd: ledgerRoot })).trim();
  assert.equal(ledgerSha, LEDGERGUARD_SHA, 'LedgerGuard checkout must match the pinned product source SHA.');

  const preparedConsumers = await prepareLedgerGuardConsumers({
    root,
    npm,
    temporary,
    evidenceDirectory: evidence
  });

  await command('docker', ['info'], { timeoutMs: 60_000 });
  await command('docker', ['compose', 'version'], { timeoutMs: 60_000 });

  const managerRuns = [];
  const managerFailures = [];
  let expectedIdentities;

  for (const { manager, consumer, resolved, distribution, version, packageChecksums } of preparedConsumers) {
    try {
      const run = await runConsumerManager({ manager, consumer, resolved, distribution, version, packageChecksums });
      managerRuns.push(run.record);
      if (expectedIdentities === undefined) {
        expectedIdentities = run.identities;
      } else {
        assert.deepEqual(
          run.identities,
          expectedIdentities,
          'npm and pnpm consumers must execute the same LedgerGuard identity set.'
        );
      }
    } catch (failure) {
      managerFailures.push({ manager, failure });
    }
  }

  if (managerFailures.length > 0) {
    throw new Error([
      'LedgerGuard package-manager acceptance failed.',
      ...managerFailures.map(({ manager, failure }) => `${manager}: ${failureMessage(failure)}`)
    ].join('\n'));
  }

  assert.equal(managerRuns.length, preparedConsumers.length);
  acceptanceRecord = {
    schemaVersion: 1,
    status: 'PASS',
    startedAt,
    completedAt: new Date().toISOString(),
    forgeqaSourceSha: sourceSha,
    ledgerguardSourceSha: LEDGERGUARD_SHA,
    ledgerguardVerificationRun: 36656046918,
    consumerManagers: managerRuns,
    expectedTests: 24,
    reconciliationDiscrepancies: managerRuns.reduce(
      (total, manager) => total + manager.reconciliationDiscrepancies,
      0
    ),
    isolatedComposeProjects: true,
    failedRunEvidenceRetained: true,
    apiFirst: false,
    uiClaimed: true,
    expectedApiTests: 12,
    expectedBrowserTests: 12,
    browsers: ['chromium', 'firefox', 'webkit'],
    applicationVerificationScope: 'required product gate; separate internal fault-lab acceptance is not substituted',
    applicationVerificationJob: 109700516992
  };
} catch (failure) {
  primaryFailure = failure;
  await writeFailure(failure);
} finally {
  if (primaryFailure === undefined && acceptanceRecord !== undefined) {
    await writeFile(join(evidence, 'acceptance.json'), `${JSON.stringify(acceptanceRecord, null, 2)}\n`);
  }
  await rm(temporary, { recursive: true, force: true });
}

if (primaryFailure !== undefined) throw primaryFailure;

async function runConsumerManager({ manager, consumer, resolved, distribution, version, packageChecksums }) {
  const environment = await createManagerEnvironment(manager);
  const managerEvidence = join(evidence, manager);
  const compose = composeArguments(environment.runtimeEnv, ledgerRoot);
  let runFailure;
  let record;
  let identities;

  await rm(managerEvidence, { recursive: true, force: true });
  await mkdir(managerEvidence, { recursive: true });
  await writeFile(
    environment.runtimeEnv,
    runtimeEnvironment(environment),
    { encoding: 'utf8', mode: 0o600 }
  );

  try {
    await command('docker', [
      ...compose,
      'up', '-d', '--build', '--wait', '--wait-timeout', '360'
    ], { cwd: ledgerRoot, timeoutMs: 12 * 60_000 });
    await command('docker', [
      ...compose,
      '--profile', 'tools', 'run', '--rm', 'seed'
    ], { cwd: ledgerRoot, timeoutMs: 3 * 60_000 });

    const baseUrl = `http://127.0.0.1:${environment.httpPort}`;
    const system = await waitForReadiness(baseUrl, 180_000);
    const uiUrl = `http://127.0.0.1:${environment.uiPort}`;
    const uiHealth = await fetch(`${uiUrl}/healthz`, { signal: AbortSignal.timeout(5000) });
    assert.equal(uiHealth.status, 200, 'The genuine product frontend must be ready.');
    assert.equal(system.databaseRole, 'ledger_runtime');
    await waitForApplicationServices(compose, ledgerRoot, APPLICATION_SERVICES, 180_000);

    const running = new Set((await command('docker', [
      ...compose,
      'ps', '--status', 'running', '--services'
    ], { cwd: ledgerRoot })).split(/\s+/).filter(Boolean));
    for (const service of REQUIRED_SERVICES) {
      assert(running.has(service), `LedgerGuard service ${service} must be running for ${manager}.`);
    }

    const runEnvironment = {
      ...process.env,
      FORGEQA_SOURCE_SHA: sourceSha,
      LEDGERGUARD_SOURCE_SHA: LEDGERGUARD_SHA,
      LEDGERGUARD_BASE_URL: baseUrl,
      LEDGERGUARD_UI_URL: uiUrl,
      LEDGERGUARD_ROOT: ledgerRoot,
      LEDGERGUARD_ENV_FILE: environment.runtimeEnv,
      LEDGER_OWNER_PASSWORD: environment.secrets.owner,
      LEDGER_DEMO_PASSWORD: environment.secrets.demo,
      POSTGRES_DB: 'ledgerguard'
    };
    const result = await nodeResult([
      resolved.cli,
      'run', '--suite', 'release', '--json'
    ], {
      cwd: consumer,
      env: runEnvironment,
      timeoutMs: 12 * 60_000
    });

    const retained = await retainConsumerRun({
      manager,
      consumer,
      evidenceDirectory: evidence,
      result,
      sanitize
    });
    const summary = retained.summary;
    const report = JSON.parse(await readFile(join(retained.destination, 'report.json'), 'utf8'));
    const reconciliation = Number(await sqlScalar(
      compose,
      ledgerRoot,
      environment.secrets.owner,
      "SELECT count(*) FROM ledger.account_balances b JOIN ledger.accounts a ON a.id=b.account_id "
      + "WHERE b.posted_minor::numeric<>(SELECT coalesce(sum(CASE WHEN a.kind='WALLET_LIABILITY' "
      + "THEN CASE WHEN e.side='CREDIT' THEN e.amount_minor::numeric ELSE -e.amount_minor::numeric END "
      + "ELSE CASE WHEN e.side='DEBIT' THEN e.amount_minor::numeric ELSE -e.amount_minor::numeric END END),0) "
      + "FROM ledger.journal_entries e WHERE e.account_id=a.id) "
      + "OR b.reserved_minor::numeric<>(SELECT coalesce(sum(h.amount_minor::numeric),0) "
      + "FROM ledger.holds h WHERE h.account_id=a.id AND h.state='ACTIVE');"
    ));

    identities = report.attempts
      .map(attempt => `${attempt.logicalTestId}:${attempt.project}:${attempt.environment}`)
      .sort();
    const passed = result.timedOut !== true
      && result.code === 0
      && summary.exitCode === 0
      && report.gate.outcome === 'pass'
      && report.missingExecutions.length === 0
      && report.unexpectedExecutions.length === 0
      && report.duplicateExecutions.length === 0
      && report.attempts.every(attempt => attempt.retry === 0 && attempt.outcome === 'passed')
      && reconciliation === 0;

    record = {
      manager,
      status: passed ? 'PASS' : 'FAIL',
      independentConsumer: true,
      distribution,
      version,
      packageChecksums,
      versions: resolved.versions,
      isolatedComposeProject: environment.project,
      forgeqaSourceSha: sourceSha,
      ledgerguardSourceSha: LEDGERGUARD_SHA,
      tests: summary.tests,
      attempts: summary.attempts,
      commandExitCode: result.code,
      summaryExitCode: summary.exitCode,
      gate: summary.gate,
      runId: summary.runId,
      reconciliationDiscrepancies: reconciliation
    };
    assert.equal(result.timedOut, false, `${manager} Deadpan execution timed out.`);
    assert.equal(result.code, summary.exitCode, `${manager} process and Deadpan summary exit codes differ.`);
    assert.equal(summary.exitCode, 0);
    assert.equal(summary.tests, 24);
    assert.equal(summary.attempts, 24);
    const projects = Object.fromEntries(['ledgerguard-api', 'ledgerguard-chromium', 'ledgerguard-firefox', 'ledgerguard-webkit'].map(project => [project, report.attempts.filter(attempt => attempt.project === project).length]));
    assert.deepEqual(projects, { 'ledgerguard-api': 12, 'ledgerguard-chromium': 4, 'ledgerguard-firefox': 4, 'ledgerguard-webkit': 4 });
    for (const attempt of report.attempts.filter(attempt => attempt.project !== 'ledgerguard-api')) {
      assert(attempt.artifacts.some(artifact => artifact.type === 'screenshot' && artifact.state === 'captured'), 'Each genuine UI journey must retain a captured screenshot.');
    }
    record.projects = projects;
    record.uiClaimed = true;
    assert.equal(report.gate.outcome, 'pass');
    assert.equal(report.missingExecutions.length, 0);
    assert.equal(report.unexpectedExecutions.length, 0);
    assert.equal(report.duplicateExecutions.length, 0);
    assert(report.attempts.every(attempt => attempt.retry === 0 && attempt.outcome === 'passed'));
    assert.equal(reconciliation, 0, `LedgerGuard must reconcile after the ${manager} consumer.`);
  } catch (failure) {
    runFailure = failure;
  } finally {
    const cleanupFailure = await finalizeManagerEnvironment({
      manager,
      environment,
      managerEvidence,
      compose
    });
    if (cleanupFailure !== undefined) {
      runFailure = mergeFailures(runFailure, cleanupFailure, `${manager} environment cleanup failed`);
    }
    if (record !== undefined) {
      record.cleanupStatus = cleanupFailure === undefined ? 'PASS' : 'FAIL';
      if (runFailure !== undefined) record.status = 'FAIL';
      await writeFile(join(evidence, `${manager}.json`), `${JSON.stringify(record, null, 2)}\n`);
    }
    if (runFailure !== undefined) {
      await mkdir(managerEvidence, { recursive: true });
      await writeFile(join(managerEvidence, 'acceptance-failure.json'), `${JSON.stringify({
        schemaVersion: 1,
        status: 'FAIL',
        manager,
        failedAt: new Date().toISOString(),
        forgeqaSourceSha: sourceSha,
        ledgerguardSourceSha: LEDGERGUARD_SHA,
        message: sanitize(failureMessage(runFailure))
      }, null, 2)}\n`);
    }
  }

  if (runFailure !== undefined) throw runFailure;
  assert(record !== undefined);
  assert(identities !== undefined);
  return { record, identities };
}

async function createManagerEnvironment(manager) {
  const secrets = {
    postgres: randomBytes(32).toString('hex'),
    owner: randomBytes(32).toString('hex'),
    runtime: randomBytes(32).toString('hex'),
    rabbit: randomBytes(32).toString('hex'),
    auth: randomBytes(64).toString('base64'),
    demo: `Fq!${randomBytes(24).toString('base64url')}Aa9`
  };
  for (const secret of Object.values(secrets)) redactions.add(secret);
  const project = `forgeqa-ledger-${manager}-${randomBytes(4).toString('hex')}`;
  return {
    manager,
    project,
    secrets,
    httpPort: await freePort(),
    uiPort: await freePort(),
    rabbitPort: await freePort(),
    runtimeEnv: join(temporary, `${project}.env`)
  };
}

async function finalizeManagerEnvironment({ manager, environment, managerEvidence, compose }) {
  let cleanupFailure;
  await mkdir(managerEvidence, { recursive: true });
  await writeFile(join(managerEvidence, 'environment.json'), `${JSON.stringify({
    schemaVersion: 1,
    manager,
    composeProject: environment.project,
    httpPort: environment.httpPort,
    uiPort: environment.uiPort,
    rabbitManagementPort: environment.rabbitPort,
    requiredServices: REQUIRED_SERVICES,
    isolated: true
  }, null, 2)}\n`);

  try {
    const status = await command('docker', [...compose, 'ps', '--all', '--format', 'json'], {
      cwd: ledgerRoot,
      timeoutMs: 60_000,
      allowFailure: true
    });
    await writeFile(join(managerEvidence, 'services.jsonl'), sanitize(status), 'utf8');
  } catch (failure) {
    await writeFile(join(managerEvidence, 'status-capture-failure.txt'), sanitize(failureMessage(failure)), 'utf8');
  }

  try {
    const logs = await command('docker', [...compose, 'logs', '--no-color', '--timestamps', '--tail', '2500'], {
      cwd: ledgerRoot,
      timeoutMs: 2 * 60_000,
      allowFailure: true
    });
    await writeFile(join(managerEvidence, 'services.log'), sanitize(logs), 'utf8');
  } catch (failure) {
    await writeFile(join(managerEvidence, 'log-capture-failure.txt'), sanitize(failureMessage(failure)), 'utf8');
  }

  try {
    await command('docker', [...compose, 'down', '--volumes', '--remove-orphans', '--timeout', '30'], {
      cwd: ledgerRoot,
      timeoutMs: 4 * 60_000
    });
  } catch (failure) {
    cleanupFailure = failure;
  }

  try {
    const containers = (await command('docker', [
      'ps', '-aq', '--filter', `label=com.docker.compose.project=${environment.project}`
    ], { allowFailure: true })).trim();
    const volumes = (await command('docker', [
      'volume', 'ls', '-q', '--filter', `label=com.docker.compose.project=${environment.project}`
    ], { allowFailure: true })).trim();
    const networks = (await command('docker', [
      'network', 'ls', '-q', '--filter', `label=com.docker.compose.project=${environment.project}`
    ], { allowFailure: true })).trim();
    assert.equal(containers, '', `LedgerGuard acceptance leaked containers for ${manager}.`);
    assert.equal(volumes, '', `LedgerGuard acceptance leaked volumes for ${manager}.`);
    assert.equal(networks, '', `LedgerGuard acceptance leaked networks for ${manager}.`);
    await writeFile(join(managerEvidence, 'cleanup.json'), `${JSON.stringify({
      containers: 0,
      volumes: 0,
      networks: 0,
      project: environment.project
    }, null, 2)}\n`);
  } catch (failure) {
    cleanupFailure = mergeFailures(cleanupFailure, failure, `${manager} leak verification failed`);
    await writeFile(join(managerEvidence, 'cleanup-failure.txt'), sanitize(failureMessage(failure)), 'utf8');
  }

  return cleanupFailure;
}

async function writeFailure(failure) {
  await writeFile(join(evidence, 'failure.json'), `${JSON.stringify({
    schemaVersion: 1,
    status: 'FAIL',
    startedAt,
    failedAt: new Date().toISOString(),
    forgeqaSourceSha: sourceSha,
    ledgerguardSourceSha: LEDGERGUARD_SHA,
    message: sanitize(failureMessage(failure))
  }, null, 2)}\n`);
}

function composeArguments(envFile, checkout) {
  return [
    'compose', '--ansi', 'never', '--env-file', envFile,
    '-f', join(checkout, 'compose.yaml'),
    '-f', join(checkout, 'compose.p07.yaml')
  ];
}

function runtimeEnvironment(environment) {
  return [
    `COMPOSE_PROJECT_NAME=${environment.project}`,
    'POSTGRES_DB=ledgerguard',
    `POSTGRES_SUPERUSER_PASSWORD=${environment.secrets.postgres}`,
    `LEDGER_OWNER_PASSWORD=${environment.secrets.owner}`,
    `LEDGER_RUNTIME_PASSWORD=${environment.secrets.runtime}`,
    'RABBITMQ_DEFAULT_USER=ledgerguard',
    `RABBITMQ_DEFAULT_PASS=${environment.secrets.rabbit}`,
    'RABBITMQ_DEFAULT_VHOST=/ledgerguard',
    `LEDGER_AUTH_KEY=${environment.secrets.auth}`,
    `LEDGER_DEMO_PASSWORD=${environment.secrets.demo}`,
    `LEDGER_HTTP_PORT=${environment.httpPort}`,
    `LEDGER_UI_PORT=${environment.uiPort}`,
    `LEDGER_RABBIT_MANAGEMENT_PORT=${environment.rabbitPort}`,
    ''
  ].join('\n');
}

async function sqlScalar(compose, cwd, ownerPassword, query) {
  return (await command('docker', [
    ...compose,
    'exec', '-T', '-e', 'PGPASSWORD',
    'postgres', 'psql', '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1',
    '-U', 'ledger_owner', '-d', 'ledgerguard', '-c', query
  ], {
    cwd,
    env: { ...process.env, PGPASSWORD: ownerPassword },
    timeoutMs: 60_000
  })).trim();
}

async function waitForReadiness(baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = 'not attempted';
  while (Date.now() < deadline) {
    try {
      const healthResponse = await fetch(`${baseUrl}/actuator/health/readiness`, {
        signal: AbortSignal.timeout(5_000)
      });
      const systemResponse = await fetch(`${baseUrl}/api/v1/system`, {
        signal: AbortSignal.timeout(5_000)
      });
      const health = await healthResponse.json();
      const system = await systemResponse.json();
      if (
        healthResponse.ok
        && systemResponse.ok
        && health.status === 'UP'
        && system.databaseRole === 'ledger_runtime'
      ) return system;
      last = JSON.stringify({ health, system });
    } catch (failure) {
      last = failureMessage(failure);
    }
    await delay(1_000);
  }
  throw new Error(`LedgerGuard did not become ready: ${last}`);
}

async function waitForApplicationServices(compose, cwd, services, timeoutMs) {
  const pending = new Set(services);
  const last = new Map();
  const deadline = Date.now() + timeoutMs;
  while (pending.size > 0 && Date.now() < deadline) {
    for (const service of pending) {
      const logs = await command('docker', [
        ...compose,
        'logs', '--no-color', '--tail', '300', service
      ], { cwd, timeoutMs: 30_000, allowFailure: true });
      last.set(service, logs.slice(-4_000));
      if (logs.includes('Started LedgerGuardApplication')) pending.delete(service);
    }
    if (pending.size > 0) await delay(500);
  }
  if (pending.size > 0) {
    const details = [...pending].map(service => `${service}: ${last.get(service) ?? 'no logs'}`).join('\n');
    throw new Error(`LedgerGuard application services did not finish startup: ${[...pending].join(', ')}\n${details}`);
  }
}

async function freePort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Could not allocate an acceptance port.');
  }
  await new Promise((resolvePromise, reject) => {
    server.close(error => error ? reject(error) : resolvePromise());
  });
  return address.port;
}

function delay(milliseconds) {
  return new Promise(resolvePromise => setTimeout(resolvePromise, milliseconds));
}

async function nodeResult(args, options = {}) {
  return commandResult(process.execPath, args, options);
}

async function command(executable, args, options = {}) {
  const result = await commandResult(executable, args, options);
  if (result.timedOut) {
    throw new Error(`Command exceeded ${options.timeoutMs ?? 5 * 60_000}ms: ${executable} ${args.slice(0, 4).join(' ')}`);
  }
  if (result.code !== 0 && options.allowFailure !== true) {
    throw new Error(`Command failed (${result.code}): ${executable} ${args.slice(0, 4).join(' ')}\n${result.stdout}\n${result.stderr}`);
  }
  return `${result.stdout}${options.allowFailure === true ? result.stderr : ''}`;
}

function commandResult(executable, args, options = {}) {
  const {
    cwd = root,
    env = process.env,
    timeoutMs = 5 * 60_000
  } = options;
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let killTimer;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 5_000);
    }, timeoutMs);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', error => {
      clearTimeout(timer);
      if (killTimer !== undefined) clearTimeout(killTimer);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (killTimer !== undefined) clearTimeout(killTimer);
      resolvePromise({ code, signal, timedOut, stdout, stderr });
    });
  });
}

function mergeFailures(current, next, context) {
  if (current === undefined) return next;
  return new Error(`${failureMessage(current)}\n${context}: ${failureMessage(next)}`);
}

function failureMessage(failure) {
  return failure instanceof Error ? failure.message : String(failure);
}

function sanitize(value) {
  let result = String(value);
  for (const secret of [...redactions].sort((left, right) => right.length - left.length)) {
    result = result.split(secret).join('[REDACTED]');
  }
  return result;
}
