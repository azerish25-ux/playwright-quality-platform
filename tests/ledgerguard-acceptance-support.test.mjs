import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { retainConsumerRun } from '../scripts/ledgerguard-acceptance-support.mjs';

test('failed LedgerGuard consumer runs retain complete sanitized evidence before rejection', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'forgeqa-retain-failure '));
  try {
    const consumer = join(temporary, 'consumer with spaces');
    const runDirectory = join(consumer, 'forgeqa-results', 'run-failed');
    const evidenceDirectory = join(temporary, 'evidence');
    await mkdir(runDirectory, { recursive: true });
    await writeFile(join(runDirectory, 'report.json'), '{"gate":{"outcome":"fail"}}\n');
    await writeFile(join(runDirectory, 'attempts.ndjson'), '{"outcome":"failed"}\n');

    const result = {
      code: 1,
      signal: null,
      timedOut: false,
      stdout: `${JSON.stringify({ runDir: runDirectory, exitCode: 1, runId: 'failed-run' })}\n`,
      stderr: 'diagnostic secret-value\n'
    };
    const retained = await retainConsumerRun({
      manager: 'pnpm',
      consumer,
      evidenceDirectory,
      result,
      sanitize: value => value.replaceAll('secret-value', '[REDACTED]')
    });

    assert.equal(retained.summary.exitCode, 1);
    assert.equal(await readFile(join(evidenceDirectory, 'pnpm', 'report.json'), 'utf8'), '{"gate":{"outcome":"fail"}}\n');
    assert.equal(await readFile(join(evidenceDirectory, 'pnpm', 'attempts.ndjson'), 'utf8'), '{"outcome":"failed"}\n');
    assert.match(
      await readFile(join(evidenceDirectory, 'pnpm', 'command.stderr.txt'), 'utf8'),
      /\[REDACTED\]/
    );
    const command = JSON.parse(await readFile(join(evidenceDirectory, 'pnpm', 'command.json'), 'utf8'));
    assert.deepEqual(command, { exitCode: 1, signal: null, timedOut: false });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('LedgerGuard evidence retention refuses a run directory outside the owned consumer results root', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'forgeqa-retain-boundary '));
  try {
    const consumer = join(temporary, 'consumer');
    const outside = join(temporary, 'outside-run');
    const evidenceDirectory = join(temporary, 'evidence');
    await mkdir(outside, { recursive: true });
    await assert.rejects(
      retainConsumerRun({
        manager: 'npm',
        consumer,
        evidenceDirectory,
        result: {
          code: 1,
          signal: null,
          timedOut: false,
          stdout: JSON.stringify({ runDir: outside, exitCode: 1 }),
          stderr: 'outside boundary'
        }
      }),
      /escaped its owned results root/
    );
    assert.equal(
      await readFile(join(evidenceDirectory, 'npm', 'command.stderr.txt'), 'utf8'),
      'outside boundary'
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
