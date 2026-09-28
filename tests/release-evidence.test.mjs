import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPOSITORY, REQUIRED_WORKFLOWS, selectWorkflowRun, verifyWorkflowJobs, createGitHubReader, readCollection, waitForSourceAcceptance, verifyCandidateDirectory } from '../scripts/release-evidence.mjs';
import { RELEASE_PACKAGES, artifactDigests } from '../scripts/release-state.mjs';

const sha = 'a'.repeat(40), ci = '.github/workflows/ci.yml', docs = '.github/workflows/docs.yml';
const run = (path = ci, id = 101) => ({ id, path, head_sha: sha, head_branch: 'main', event: 'push', run_attempt: 1, status: 'completed', conclusion: 'success', repository: { full_name: REPOSITORY }, head_repository: { full_name: REPOSITORY } });
const jobsFor = workflow => REQUIRED_WORKFLOWS[workflow.path].map((name, i) => ({ id: workflow.id * 100 + i, name, run_id: workflow.id, run_attempt: workflow.run_attempt, head_sha: workflow.head_sha, head_branch: 'main', status: 'completed', conclusion: 'success' }));
const collection = (field, records) => ({ total_count: records.length, [field]: records });
function reader(runs) {
  return async path => {
    const id = /\/runs\/(\d+)\/jobs/.exec(path)?.[1];
    return id ? collection('jobs', jobsFor(runs.find(value => value.id === Number(id)))) : collection('workflow_runs', structuredClone(runs));
  };
}
async function candidate(t) {
  const directory = await mkdtemp(join(tmpdir(), 'forgeqa-source-gate-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, 'tarballs'));
  const manifest = { schemaVersion: 2, kind: 'forgeqa-release-candidate', sourceSha: sha, version: '0.1.0', channel: 'forgeqa-candidate', status: 'staged', publication: 'NOT_ATTEMPTED', entries: [] };
  for (const [i, name] of RELEASE_PACKAGES.entries()) {
    const bytes = Buffer.from(`Synthetic artifact ${name}; not an npm package.`), filename = `package-${i}.tgz`;
    manifest.entries.push({ name, version: manifest.version, filename, status: 'staged', ...artifactDigests(bytes) });
    await writeFile(join(directory, 'tarballs', filename), bytes);
  }
  await writeFile(join(directory, 'release-manifest.json'), JSON.stringify(manifest));
  return { directory, manifest };
}

test('accepts all fourteen CI jobs and the independent Documentation job at the exact source', async () => {
  const receipts = await waitForSourceAcceptance(sha, reader([run(), run(docs, 102)]), { attempts: 1 });
  assert.equal(receipts.length, 2); assert.equal(receipts[0].jobs.length, 14); assert.equal(receipts[1].jobs.length, 1);
  assert.ok(receipts.every(receipt => receipt.sourceSha === sha && receipt.status === 'PASS'));
});

test('every required job is mandatory even when the aggregate claims success', () => {
  const workflow = run(), jobs = jobsFor(workflow);
  for (let index = 0; index < jobs.length; index++) assert.throws(() => verifyWorkflowJobs(workflow, jobs.filter((_, i) => i !== index)), /jobs/);
});

test('failed, skipped, cancelled, pending and wrong-attempt jobs cannot pass', () => {
  for (const patch of [{ conclusion: 'failure' }, { conclusion: 'skipped' }, { conclusion: 'cancelled' }, { status: 'in_progress' }, { run_attempt: 2 }, { run_id: 999 }, { head_sha: 'b'.repeat(40) }, { head_branch: 'other' }]) {
    const workflow = run(), jobs = jobsFor(workflow); Object.assign(jobs[0], patch);
    assert.throws(() => verifyWorkflowJobs(workflow, jobs), /not accepted/);
  }
});

test('duplicate identities and duplicate job names are rejected', () => {
  const workflow = run();
  const jobs = jobsFor(workflow); jobs[1].id = jobs[0].id;
  assert.throws(() => verifyWorkflowJobs(workflow, jobs), /duplicate/);
  jobs[1].id++; jobs[1].name = jobs[0].name;
  assert.throws(() => verifyWorkflowJobs(workflow, jobs), /duplicate/);
});

test('newest failed run cannot fall back to an older green run', async () => {
  for (const conclusion of ['failure', 'cancelled', 'skipped', 'timed_out', 'neutral']) {
    const current = { ...run(ci, 103), conclusion };
    assert.equal(selectWorkflowRun([run(), current], ci, sha).id, 103);
    await assert.rejects(waitForSourceAcceptance(sha, reader([run(), current, run(docs, 102)]), { attempts: 1 }), /workflow failed/);
  }
});

test('foreign repositories are rejected and PRs, other branches and other SHAs cannot count', () => {
  for (const field of ['repository', 'head_repository']) assert.throws(() => selectWorkflowRun([{ ...run(), [field]: { full_name: 'other/project' } }], ci, sha), /Untrusted/);
  for (const patch of [{ event: 'pull_request' }, { head_branch: 'feature' }, { head_sha: 'b'.repeat(40) }, { path: docs }]) assert.equal(selectWorkflowRun([{ ...run(), ...patch }], ci, sha), null);
  assert.throws(() => selectWorkflowRun([run(), run()], ci, sha), /Duplicate/);
});

test('complete pagination includes later pages instead of accepting a truncated inventory', async () => {
  const values = Array.from({ length: 101 }, (_, i) => ({ id: i + 1 })), seen = [];
  const result = await readCollection(async path => {
    seen.push(path); const page = Number(new URL(`https://example.test${path}`).searchParams.get('page'));
    return { total_count: values.length, jobs: values.slice((page - 1) * 100, page * 100) };
  }, '/actions/runs/101/jobs?filter=latest', 'jobs');
  assert.equal(result.length, 101); assert.equal(seen.length, 2); assert.match(seen[1], /page=2$/);
});

test('incomplete, duplicate, growing and oversized inventories fail closed', async () => {
  for (const payload of [{ total_count: 2, jobs: [] }, { total_count: 2, jobs: [{ id: 1 }, { id: 1 }] }, { total_count: 1001, jobs: [] }, { total_count: '0', jobs: [] }]) await assert.rejects(readCollection(async () => payload, '/actions/runs/101/jobs', 'jobs'));
  let count = 0;
  await assert.rejects(readCollection(async () => ({ total_count: ++count === 1 ? 2 : 3, jobs: [{ id: count }] }), '/actions/runs/101/jobs', 'jobs'), /changed/);
});

test('missing acceptance is polled with a finite budget, not silently treated as passing', async () => {
  let sleeps = 0, reads = 0;
  const accepted = [run(), run(docs, 102)], ready = reader(accepted);
  const result = await waitForSourceAcceptance(sha, async path => ++reads === 1 ? collection('workflow_runs', []) : ready(path), { attempts: 2, intervalMs: 0, sleep: async () => { sleeps++; } });
  assert.equal(result.length, 2); assert.equal(sleeps, 1);
  await assert.rejects(waitForSourceAcceptance(sha, async () => collection('workflow_runs', []), { attempts: 1 }), /unfinished/);
  await assert.rejects(waitForSourceAcceptance(sha, ready, { attempts: 0 }), /budget/);
});

test('a rerun started during job inspection invalidates the earlier green snapshot', async () => {
  let inventories = 0;
  const accepted = [run(), run(docs, 102)], ready = reader(accepted);
  await assert.rejects(waitForSourceAcceptance(sha, async path => {
    if (!path.includes('/jobs') && ++inventories === 2) return collection('workflow_runs', [{ ...run(), run_attempt: 2, status: 'in_progress', conclusion: null }, accepted[1]]);
    return ready(path);
  }, { attempts: 1 }), /unfinished/);
});

test('API reader restricts origin, disallows redirects and never exposes HTTP error bodies', async () => {
  const token = 'synthetic-token-canary'; let requests = 0;
  const read = createGitHubReader(token, async (url, options) => {
    requests++; assert.equal(new URL(url).origin, 'https://api.github.com'); assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, `Bearer ${token}`); assert.ok(options.signal instanceof AbortSignal);
    return new Response(JSON.stringify({ total_count: 0, workflow_runs: [] }), { status: 200 });
  });
  await read('/actions/runs?head_sha=' + sha);
  for (const path of ['https://evil.test/', '//evil.test/', '/actions/runs/../secrets']) await assert.rejects(read(path), /Unsupported/);
  assert.equal(requests, 1);
  for (const status of [302, 401, 403, 404, 429, 500]) {
    await assert.rejects(createGitHubReader(token, async () => new Response(token, { status }))('/actions/runs?event=push'), error => error.message.includes(`HTTP ${status}`) && !error.message.includes(token));
  }
  assert.throws(() => createGitHubReader(''), /token/);
});

test('API reader rejects malformed and oversized responses', async () => {
  for (const body of ['not json', 'x'.repeat(4 * 1024 * 1024 + 1)]) await assert.rejects(createGitHubReader('synthetic', async () => new Response(body))('/actions/runs?event=push'));
});

test('candidate binding verifies every complete tarball and the exact manifest digest', async t => {
  const { directory, manifest } = await candidate(t), binding = await verifyCandidateDirectory(directory, sha);
  assert.equal(binding.packageCount, 8); assert.match(binding.manifestSha256, /^[a-f0-9]{64}$/);
  await assert.rejects(verifyCandidateDirectory(directory, 'b'.repeat(40)), /mismatch/);
  const path = join(directory, 'tarballs', manifest.entries.at(-1).filename), bytes = await readFile(path);
  bytes[0] ^= 1; await writeFile(path, bytes);
  await assert.rejects(verifyCandidateDirectory(directory, sha), /mismatch/);
});

test('extra candidate files and already-published manifests cannot become staged acceptance', async t => {
  const { directory, manifest } = await candidate(t);
  const extra = join(directory, 'tarballs', 'extra.tgz'); await writeFile(extra, 'unexpected');
  await assert.rejects(verifyCandidateDirectory(directory, sha), /inventory/);
  await rm(extra); manifest.publication = 'PUBLISHED'; await writeFile(join(directory, 'release-manifest.json'), JSON.stringify(manifest));
  await assert.rejects(verifyCandidateDirectory(directory, sha), /staging/);
});

test('CLI writes a failure receipt and emits no token when invoked outside trusted main', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'forgeqa-gate-cli-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const child = spawnSync(process.execPath, [resolve('scripts/release-evidence.mjs')], { cwd: directory, env: { ...process.env, GITHUB_TOKEN: 'synthetic-secret-canary', GITHUB_REPOSITORY: 'wrong/repository' }, encoding: 'utf8', timeout: 10000 });
  assert.equal(child.status, 1); assert.doesNotMatch(child.stdout + child.stderr, /synthetic-secret-canary/);
  const receipt = JSON.parse(await readFile(join(directory, 'evidence/release-candidate/source-acceptance.json'), 'utf8'));
  assert.equal(receipt.status, 'FAIL'); assert.equal(receipt.publicationAuthorized, false);
});
