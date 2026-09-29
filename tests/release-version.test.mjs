import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execute } from '../scripts/release-process.mjs';
import { calculateRelease, validatePlan } from '../scripts/release-version.mjs';

async function fixture(messages, previous) {
  const root = await mkdtemp(join(tmpdir(), 'Deadpan semantic Ω '));
  const git = args => execute('git', args, { cwd: root });
  await git(['init', '-b', 'main']);
  await git(['config', 'user.name', 'Deadpan test fixture']);
  await git(['config', 'user.email', 'fixture@example.invalid']);
  await writeFile(join(root, 'package.json'), '{"name":"semantic-fixture","private":true}\n');
  await git(['add', '.']); await git(['commit', '-m', 'chore: initial fixture']);
  if (previous) await git(['tag', `v${previous}`]);
  for (const message of messages) await git(['commit', '--allow-empty', '-m', message]);
  return { root, git, dispose: () => rm(root, { recursive: true, force: true }) };
}

for (const [label, messages, previous, version] of [
  ['first release uses semantic-release, not source package versions', ['feat: first capability'], undefined, '1.0.0'],
  ['fix increments a real previous patch', ['fix: repair cleanup'], '1.2.3', '1.2.4'],
  ['feature increments the shared minor', ['feat: add adapter'], '1.2.3', '1.3.0'],
  ['breaking footer increments major', ['feat: new contract\n\nBREAKING CHANGE: old adapter signatures removed'], '1.2.3', '2.0.0'],
  ['breaking bang increments major', ['feat!: incompatible contract'], '1.2.3', '2.0.0'],
  ['documentation-only history does not release', ['docs: explain configuration'], '1.2.3', null],
  ['documentation-only initial repository does not release', ['docs: introduction'], undefined, null]
]) test(`semantic coordinator: ${label}`, async () => {
  const f = await fixture(messages, previous);
  try {
    const before = await f.git(['show-ref']);
    const plan = await calculateRelease(f.root);
    assert.equal(plan.version, version);
    assert.equal(await f.git(['show-ref']), before, 'Analysis must not create source tags or move refs.');
    assert.equal((await f.git(['status', '--porcelain'])).trim(), '');
    if (version) {
      validatePlan(plan);
      assert.equal(plan.tag, `v${version}`);
      assert.match(plan.notes, /unreleased/);
      assert.throws(() => validatePlan({ ...plan, version: '99.0.0' }), /tampered/);
    } else assert.equal(plan.status, 'NO_RELEASE');
  } finally { await f.dispose(); }
});

test('semantic coordinator rejects dirty source, wrong source and wrong branches', async () => {
  const f = await fixture(['feat: release']);
  try {
    await assert.rejects(calculateRelease(f.root, { expectedSha: 'a'.repeat(40) }), /SHA/);
    await writeFile(join(f.root, 'untracked.ts'), 'export const changed = true;');
    await assert.rejects(calculateRelease(f.root), /clean/);
    await rm(join(f.root, 'untracked.ts'));
    await f.git(['checkout', '-b', 'fixture-only-branch']);
    await assert.rejects(calculateRelease(f.root), /main/);
  } finally { await f.dispose(); }
});
