import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Writable } from 'node:stream';
import { createHash } from 'node:crypto';
import config from '../release.config.mjs';
import { execute } from './release-process.mjs';

export const SOURCE_REPOSITORY = 'https://github.com/azerish25-ux/playwright-quality-platform.git';
export const jsonDigest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const git = async (root, args, env) => (await execute('git', args, { cwd: root, env })).trim();

export async function sourceIdentity(root, expectedSha) {
  const sourceSha = await git(root, ['rev-parse', 'HEAD']);
  if (!/^[a-f0-9]{40}$/.test(sourceSha) || (expectedSha !== undefined && sourceSha !== expectedSha)) throw new Error('Release source SHA does not match the checkout.');
  if (await git(root, ['rev-parse', '--is-shallow-repository']) !== 'false') throw new Error('Semantic version analysis requires complete Git history and fetched release tags.');
  if (await git(root, ['symbolic-ref', '--short', 'HEAD']) !== 'main') throw new Error('Releases must be prepared from main.');
  if (await git(root, ['status', '--porcelain', '--untracked-files=normal'])) throw new Error('Release source must be clean, including untracked source files.');
  return { sourceSha, sourceTree: await git(root, ['rev-parse', 'HEAD^{tree}']) };
}

/** Use real history/tags, but a disposable local remote: semantic-release performs
 * push-permission probes even in dry-run mode. No production remote is written.
 * No historical tag or version baseline is invented in the source repository.
 */
export async function calculateRelease(root, { expectedSha } = {}) {
  root = resolve(root);
  const identity = await sourceIdentity(root, expectedSha);
  const temporary = await mkdtemp(join(tmpdir(), 'forgeqa-semantic-'));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(?:GITHUB_|GIT_|CI$|GITLAB_|BUILDKITE_|JENKINS_|TRAVIS_|CIRCLE_|ACTIONS_)/i.test(key) && !/(?:TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(key)));
  Object.assign(env, { CI: 'false', GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' });
  try {
    const mirror = join(temporary, 'history.git'), work = join(temporary, 'analysis');
    await execute('git', ['clone', '--mirror', '--no-hardlinks', root, mirror], { env });
    await execute('git', ['clone', '--no-hardlinks', '--branch', 'main', mirror, work], { env });
    const { default: semanticRelease } = await import('semantic-release');
    const sink = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
    const result = await semanticRelease({ ...config, repositoryUrl: pathToFileURL(mirror).href,
      plugins: [[fileURLToPath(import.meta.resolve('@semantic-release/commit-analyzer')), { preset: 'conventionalcommits' }]]
    }, { cwd: work, env, stdout: sink, stderr: sink });
    let notes = '';
    if (result) {
      const { generateNotes } = await import('@semantic-release/release-notes-generator');
      notes = await generateNotes({ preset: 'conventionalcommits', writerOpts: { finalizeContext: context => ({ ...context, date: 'unreleased' }) } },
        { ...result, cwd: root, env, options: { repositoryUrl: SOURCE_REPOSITORY }, logger: { log() {} } });
      if (result.nextRelease.gitHead !== identity.sourceSha) throw new Error('Semantic analysis changed the selected source.');
    }
    const plan = { schemaVersion: 1, kind: 'forgeqa-semantic-release-plan', ...identity,
      status: result ? 'PLANNED' : 'NO_RELEASE',
      version: result?.nextRelease?.version ?? null, releaseType: result?.nextRelease?.type ?? null,
      tag: result?.nextRelease?.gitTag ?? null,
      lastRelease: result?.lastRelease ?? {}, commits: result?.commits?.map(commit => commit.hash) ?? [], notes };
    if (JSON.stringify(await sourceIdentity(root, identity.sourceSha)) !== JSON.stringify(identity)) throw new Error('Release source changed during analysis.');
    return { ...plan, planSha256: jsonDigest(plan) };
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

export function validatePlan(plan) {
  const { planSha256, ...content } = plan ?? {};
  if (content.schemaVersion !== 1 || content.kind !== 'forgeqa-semantic-release-plan' || content.status !== 'PLANNED' ||
    !/^[a-f0-9]{40}$/.test(content.sourceSha ?? '') || !/^[a-f0-9]{40}$/.test(content.sourceTree ?? '') ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(content.version ?? '') ||
    !['patch', 'minor', 'major'].includes(content.releaseType) || content.tag !== `v${content.version}` ||
    !Array.isArray(content.commits) || content.commits.length === 0 || content.commits.some(sha => !/^[a-f0-9]{40}$/.test(sha)) ||
    typeof content.notes !== 'string' || planSha256 !== jsonDigest(content)) throw new Error('Invalid or tampered semantic release plan.');
  return plan;
}
