import assert from 'node:assert/strict';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

const root = process.cwd();
const consumer = resolve(root, 'examples/ledgerguard-integration/consumer');
const cli = resolve(root, 'packages/cli/dist/cli.js');
const evidence = resolve(root, 'evidence/ledgerguard-workspace');
const pinned = '9478663f97f9dc65d0c85117f244e1b8b80c37cb';

if (process.env.LEDGERGUARD_SOURCE_SHA !== pinned) {
  throw new Error(`LedgerGuard source mismatch: expected ${pinned}, observed ${process.env.LEDGERGUARD_SOURCE_SHA ?? 'missing'}.`);
}

async function run() {
  return await new Promise((done, reject) => {
    const child = spawn(process.execPath, [cli, 'run', '--suite', 'release', '--json'], {
      cwd: consumer,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('LedgerGuard workspace acceptance exceeded eight minutes.'));
    }, 8 * 60_000);
    child.stdout.on('data', (value) => { stdout += value; });
    child.stderr.on('data', (value) => { stderr += value; });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`LedgerGuard ForgeQA run failed (${code}).\n${stdout}\n${stderr}`));
      else done(stdout);
    });
  });
}

await rm(evidence, { recursive: true, force: true });
await mkdir(evidence, { recursive: true });
const summary = JSON.parse(await run());
assert.equal(summary.exitCode, 0);
assert.equal(summary.tests, 9);
assert.equal(summary.attempts, 9);
assert.equal(summary.gate.outcome, 'pass');
const runDir = resolve(consumer, summary.runDir);
const report = JSON.parse(await readFile(resolve(runDir, 'report.json'), 'utf8'));
assert.equal(report.gate.outcome, 'pass');
assert.equal(report.missingExecutions.length, 0);
assert.equal(report.unexpectedExecutions.length, 0);
assert.equal(report.duplicateExecutions.length, 0);
assert(report.attempts.every((attempt) => attempt.retry === 0 && attempt.outcome === 'passed'));
await cp(runDir, resolve(evidence, 'run'), { recursive: true });
await writeFile(resolve(root, 'evidence/ledgerguard-workspace.json'), `${JSON.stringify({
  schemaVersion: 1,
  forgeqaSourceSha: process.env.FORGEQA_SOURCE_SHA ?? 'local',
  ledgerguardSourceSha: pinned,
  independentApplication: true,
  interface: 'public-http-api',
  tests: summary.tests,
  attempts: summary.attempts,
  gate: summary.gate.outcome,
  runDir,
}, null, 2)}\n`);
console.log(JSON.stringify({ consumer: 'ledgerguard', tests: summary.tests, gate: summary.gate.outcome }));
