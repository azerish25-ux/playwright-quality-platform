import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RecoveryJournal } from '@azerish25-ux/forgeqa-core';
import { recoveryCommand, parseRecovery } from '../packages/cli/dist/recovery-command.js';
const parsed = entries => ({ command: ['recovery'], options: new Map(entries), positionals: [] });
async function capture(t, entries) {
  let output = ''; const write = process.stdout.write; const code = process.exitCode;
  process.stdout.write = text => { output += text; return true; };
  try { await recoveryCommand(parsed(entries)); return { output, code: process.exitCode }; }
  finally { process.stdout.write = write; process.exitCode = code; }
}
async function root(t) { const path = await mkdtemp(join(await realpath(tmpdir()), 'recovery command Ω ')); t.after(() => rm(path, { recursive: true, force: true })); return path; }
test('recovery command emits parseable dry-run JSON and explicit apply output', async t => {
  const path = await root(t), journal = await RecoveryJournal.create({ runId: 'run', consumer: 'cli', namespace: 'cli' }, { root: path });
  await journal.createDirectory(); await journal.close();
  const planned = await capture(t, [['root', path], ['json', true]]); assert.equal(JSON.parse(planned.output).dryRun, true);
  const applied = await capture(t, [['root', path], ['apply', true]]); assert.match(applied.output, /1 resources reclaimed/);
});
test('recovery command refuses contradictory and unrelated arguments', async () => {
  for (const argv of [['--apply=false'], ['--apply', '--apply'], ['--root'], ['--unknown'], ['-x']]) assert.throws(() => parseRecovery(argv));
  assert.deepEqual(parseRecovery(['--root=example', '--json']).options, new Map([['root','example'], ['json',true]]));
  assert.deepEqual(parseRecovery(['extra']).positionals, ['extra']);
  for (const entries of [[['apply', true], ['dry-run', true]], [['workers', '2']], [['adapter-module', 'unsafe.ts']]]) await assert.rejects(recoveryCommand(parsed(entries)));
  await assert.rejects(recoveryCommand({ ...parsed([]), positionals: ['unexpected'] }));
});
test('recovery requires an explicit trusted adapter module and exits 3 for unknown resources', async t => {
  const path = await root(t), journal = await RecoveryJournal.create({ runId: 'run', consumer: 'cli', namespace: 'cli' }, { root: path });
  await journal.reserve({ adapter: 'cli-test-v1', target: 'lab', key: 'owned' }); await journal.close();
  const refused = await capture(t, [['root', path], ['apply', true], ['json', true]]);
  assert.equal(refused.code, 3); assert.equal(JSON.parse(refused.output).incomplete, true);
  const module = join(path, 'trusted adapter Ω.mjs');
  await writeFile(module, "export const recoveryAdapters=[{id:'cli-test-v1',target:'lab',async reclaim(record,owner,signal){signal.throwIfAborted();if(record.ownerId!==owner.id)throw new Error('foreign');}}];", { mode: 0o600 });
  const result = await capture(t, [['root', path], ['apply', true], ['json', true], ['adapter-module', module], ['consumer', 'cli'], ['namespace', 'cli'], ['max-owners', '5'], ['timeout-ms', '100'], ['budget-ms', '1000']]);
  assert.equal(JSON.parse(result.output).reclaimed, 1);
  const invalid = join(path, 'invalid.mjs'); await writeFile(invalid, 'export const recoveryAdapters={};');
  await assert.rejects(recoveryCommand(parsed([['adapter-module', invalid]])), /array/);
});
