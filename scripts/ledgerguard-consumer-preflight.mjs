import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  LEDGERGUARD_PACKAGE_DIRECTORIES,
  prepareLedgerGuardConsumers
} from './ledgerguard-consumer-preparation.mjs';

const execFileAsync = promisify(execFile);
const root = process.cwd();
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run LedgerGuard consumer preflight through npm run test:ledgerguard:consumer.');

const evidence = resolve('evidence/ledgerguard-preflight');
const temporary = await mkdtemp(join(tmpdir(), 'ForgeQA LedgerGuard preflight '));
const startedAt = new Date().toISOString();
let sourceSha = process.env.FORGEQA_SOURCE_SHA ?? 'unknown';

await rm(evidence, { recursive: true, force: true });
await mkdir(evidence, { recursive: true });

try {
  if (sourceSha === 'unknown') {
    const result = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root });
    sourceSha = result.stdout.trim();
  }

  const consumers = await prepareLedgerGuardConsumers({
    root,
    npm,
    temporary,
    evidenceDirectory: evidence
  });
  const record = {
    schemaVersion: 1,
    status: 'PASS',
    startedAt,
    completedAt: new Date().toISOString(),
    forgeqaSourceSha: sourceSha,
    managers: consumers.map(({ manager }) => manager),
    packageCount: LEDGERGUARD_PACKAGE_DIRECTORIES.length,
    independentConsumers: true,
    strictTypeScript: true
  };
  await writeFile(join(evidence, 'preflight.json'), `${JSON.stringify(record, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(record)}\n`);
} catch (failure) {
  const record = {
    schemaVersion: 1,
    status: 'FAIL',
    startedAt,
    failedAt: new Date().toISOString(),
    forgeqaSourceSha: sourceSha,
    message: failure instanceof Error ? failure.message : String(failure)
  };
  await writeFile(join(evidence, 'failure.json'), `${JSON.stringify(record, null, 2)}\n`);
  throw failure;
} finally {
  await rm(temporary, { recursive: true, force: true });
}
