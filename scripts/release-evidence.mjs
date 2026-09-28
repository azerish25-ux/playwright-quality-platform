import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, lstat, rename, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { assertArtifact, validateReleaseManifest } from './release-state.mjs';

export const REPOSITORY = 'azerish25-ux/playwright-quality-platform';
export const REQUIRED_WORKFLOWS = Object.freeze({
  '.github/workflows/ci.yml': Object.freeze([
    ...['ubuntu-latest', 'windows-latest', 'macos-latest'].flatMap(os => [22, 24].map(node => `verify (${os}, ${node})`)),
    ...['ubuntu-latest', 'windows-latest', 'macos-latest'].map(os => `consumer (${os})`),
    'teamboard', 'ledgerguard', 'hardening', 'action', 'forgeqa-quality'
  ]),
  '.github/workflows/docs.yml': Object.freeze(['docs-quality'])
});
const positiveInteger = value => Number.isSafeInteger(value) && value > 0;
function assertSource(sourceSha) {
  if (typeof sourceSha !== 'string' || !/^[a-f0-9]{40}$/.test(sourceSha)) throw new Error('Invalid acceptance source SHA.');
}

/** Select the newest push, never an older green run or a PR/foreign-repository run. */
export function selectWorkflowRun(runs, path, sourceSha) {
  assertSource(sourceSha);
  if (!Object.hasOwn(REQUIRED_WORKFLOWS, path) || !Array.isArray(runs)) throw new Error('Invalid workflow inventory.');
  const candidates = runs.filter(run => run.path === path && run.head_sha === sourceSha && run.event === 'push' && run.head_branch === 'main');
  for (const run of candidates) {
    if (!positiveInteger(run.id) || !positiveInteger(run.run_attempt) || run.repository?.full_name !== REPOSITORY || run.head_repository?.full_name !== REPOSITORY) throw new Error('Untrusted workflow identity.');
  }
  if (new Set(candidates.map(run => run.id)).size !== candidates.length) throw new Error('Duplicate workflow run.');
  return candidates.sort((a, b) => b.id - a.id)[0] ?? null;
}

export function verifyWorkflowJobs(run, jobs) {
  const expected = REQUIRED_WORKFLOWS[run?.path];
  if (!expected || run.status !== 'completed' || run.conclusion !== 'success' || !Array.isArray(jobs)) throw new Error('Workflow acceptance is not successful.');
  if (jobs.length !== expected.length || new Set(jobs.map(job => job.id)).size !== jobs.length) throw new Error('Missing, duplicate or unexpected workflow jobs.');
  for (const name of expected) {
    const matches = jobs.filter(job => job.name === name);
    if (matches.length !== 1) throw new Error(`Missing or duplicate required job: ${name}`);
    const job = matches[0];
    if (!positiveInteger(job.id) || job.run_id !== run.id || job.run_attempt !== run.run_attempt || job.head_sha !== run.head_sha || job.head_branch !== 'main' || job.status !== 'completed' || job.conclusion !== 'success') throw new Error(`Required job is not accepted for this attempt: ${name}`);
  }
  return {
    workflow: run.path, runId: run.id, runAttempt: run.run_attempt, sourceSha: run.head_sha,
    status: 'PASS', url: `https://github.com/${REPOSITORY}/actions/runs/${run.id}`,
    jobs: jobs.map(job => ({ id: job.id, name: job.name, conclusion: job.conclusion })).sort((a, b) => a.name.localeCompare(b.name))
  };
}

/** Read only official API URLs. Never follow server-supplied pagination URLs. */
export function createGitHubReader(token, fetchImpl = fetch) {
  if (typeof token !== 'string' || !token.trim() || /[\r\n]/.test(token)) throw new Error('A read-only GitHub token is required for source acceptance.');
  return async path => {
    if (typeof path !== 'string' || !/^\/actions\/runs(?:\?|\/\d+(?:\/jobs\?)?$)/.test(path.split('?', 1)[0] + (path.includes('?') ? '?' : ''))) throw new Error('Unsupported acceptance API path.');
    const response = await fetchImpl(`https://api.github.com/repos/${REPOSITORY}${path}`, {
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' },
      redirect: 'error', signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error(`GitHub acceptance read failed (HTTP ${response.status}).`);
    const chunks = []; let length = 0;
    if (!response.body) throw new Error('Missing GitHub response body.');
    for await (const chunk of response.body) {
      length += chunk.length;
      if (length > 4 * 1024 * 1024) throw new Error('GitHub acceptance response exceeds the size bound.');
      chunks.push(Buffer.from(chunk));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  };
}

export async function readCollection(read, path, field) {
  const records = []; let total;
  for (let page = 1; page <= 10; page++) {
    const payload = await read(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    if (!Number.isSafeInteger(payload?.total_count) || payload.total_count < 0 || payload.total_count > 1000 || !Array.isArray(payload[field]) || payload[field].length > 100) throw new Error('Invalid or oversized GitHub inventory.');
    total ??= payload.total_count;
    if (total !== payload.total_count) throw new Error('GitHub inventory changed during pagination.');
    records.push(...payload[field]);
    if (new Set(records.map(record => record.id)).size !== records.length || records.some(record => !positiveInteger(record.id))) throw new Error('Duplicate or malformed GitHub inventory.');
    if (records.length === total) return records;
    if (records.length > total || payload[field].length === 0) throw new Error('Incomplete GitHub inventory.');
  }
  throw new Error('GitHub pagination bound exceeded.');
}

export async function waitForSourceAcceptance(sourceSha, read, { attempts = 60, intervalMs = 20000, sleep = delay } = {}) {
  assertSource(sourceSha);
  if (!positiveInteger(attempts) || attempts > 60 || !Number.isSafeInteger(intervalMs) || intervalMs < 0 || intervalMs > 20000) throw new Error('Invalid acceptance polling budget.');
  for (let attempt = 0; attempt < attempts; attempt++) {
    const runs = await readCollection(read, `/actions/runs?head_sha=${sourceSha}&event=push`, 'workflow_runs');
    const selected = Object.keys(REQUIRED_WORKFLOWS).map(path => selectWorkflowRun(runs, path, sourceSha));
    for (const run of selected) if (run?.status === 'completed' && run.conclusion !== 'success') throw new Error(`Exact-source workflow failed: ${run.path} (${run.conclusion}).`);
    if (selected.every(run => run?.status === 'completed' && run.conclusion === 'success')) {
      const receipts = [];
      for (const run of selected) {
        const jobs = await readCollection(read, `/actions/runs/${run.id}/jobs?filter=latest`, 'jobs');
        receipts.push(verifyWorkflowJobs(run, jobs));
      }
      // A rerun can invalidate conclusions while jobs are being paged. Re-read the
      // inventory instead of accepting an earlier successful attempt's job list.
      const refreshed = await readCollection(read, `/actions/runs?head_sha=${sourceSha}&event=push`, 'workflow_runs');
      if (selected.every(run => {
        const current = selectWorkflowRun(refreshed, run.path, sourceSha);
        return current?.id === run.id && current.run_attempt === run.run_attempt && current.status === 'completed' && current.conclusion === 'success';
      })) return receipts;
    }
    if (attempt + 1 < attempts) await sleep(intervalMs);
  }
  throw new Error('Exact-source CI and Documentation acceptance is missing or unfinished within the polling budget.');
}

export async function verifyCandidateDirectory(directory, sourceSha) {
  assertSource(sourceSha);
  const manifestPath = join(directory, 'release-manifest.json');
  const info = await lstat(manifestPath);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024) throw new Error('Invalid candidate manifest file.');
  const bytes = await readFile(manifestPath);
  const manifest = validateReleaseManifest(JSON.parse(bytes));
  if (manifest.sourceSha !== sourceSha || manifest.status !== 'staged' || manifest.publication !== 'NOT_ATTEMPTED' || manifest.entries.some(entry => entry.status !== 'staged')) throw new Error('Candidate source or staging state mismatch.');
  const tarballs = join(directory, 'tarballs'), tarballInfo = await lstat(tarballs);
  if (!tarballInfo.isDirectory() || tarballInfo.isSymbolicLink()) throw new Error('Invalid tarball directory.');
  const entries = await readdir(tarballs, { withFileTypes: true });
  if (entries.length !== manifest.entries.length || entries.some(entry => !entry.isFile() || !manifest.entries.some(accepted => accepted.filename === entry.name))) throw new Error('Candidate tarball inventory mismatch.');
  for (const entry of manifest.entries) {
    const file = join(tarballs, entry.filename), stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== entry.size) throw new Error('Candidate tarball file mismatch.');
    assertArtifact(entry, await readFile(file));
  }
  return { sourceSha, version: manifest.version, manifestSha256: createHash('sha256').update(bytes).digest('hex'), packageCount: manifest.entries.length };
}

async function writeReceipt(path, receipt) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx', mode: 0o600 }); await rename(temporary, path); }
  finally { await rm(temporary, { force: true }); }
}

export async function main() {
  const directory = resolve('evidence/release-candidate');
  await mkdir(directory, { recursive: true });
  const path = join(directory, 'source-acceptance.json');
  const receipt = { schemaVersion: 1, kind: 'forgeqa-candidate-source-acceptance', status: 'NOT_RUN', publicationAuthorized: false, observedAt: new Date().toISOString() };
  await writeReceipt(path, receipt);
  try {
    const sourceSha = process.env.FORGEQA_SOURCE_SHA;
    if (process.argv.length !== 2 || process.env.GITHUB_REPOSITORY !== REPOSITORY || process.env.GITHUB_REF !== 'refs/heads/main' || process.env.GITHUB_SHA !== sourceSha || !['push', 'workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME)) throw new Error('Source acceptance requires the trusted main checkout.');
    const candidate = await verifyCandidateDirectory(directory, sourceSha);
    const workflows = await waitForSourceAcceptance(sourceSha, createGitHubReader(process.env.GITHUB_TOKEN));
    const final = await verifyCandidateDirectory(directory, sourceSha);
    if (candidate.manifestSha256 !== final.manifestSha256) throw new Error('Candidate changed during source acceptance.');
    Object.assign(receipt, candidate, { status: 'PASS', observedAt: new Date().toISOString(), workflows });
    await writeReceipt(path, receipt);
    console.log(JSON.stringify(receipt, null, 2));
  } catch (error) {
    receipt.status = 'FAIL';
    // Do not retain arbitrary fetch/adapter errors that could contain secrets.
    receipt.reason = 'Candidate/source acceptance failed; no publication authorized.';
    await writeReceipt(path, receipt);
    throw error;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await main(); }
  catch { console.error('Release candidate source acceptance failed; inspect workflow conclusions and retained source-acceptance.json.'); process.exitCode = 1; }
}
