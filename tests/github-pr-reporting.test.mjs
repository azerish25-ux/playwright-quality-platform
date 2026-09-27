import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  GitHubApi,
  REPORT_FILE,
  REPORT_KIND,
  REPORT_MARKER,
  ReportingError,
  SkipPublication,
  artifactName,
  assertFreshPullRequest,
  assertTrustedWorkflowUnchanged,
  findNewerRun,
  parseCommentMetadata,
  publishComment,
  readValidatedReport,
  renderComment,
  resolvePullRequestContext,
  runPublisher,
  selectManagedComments,
  summarizeRequiredJobs,
  validateArtifactMetadata,
  validateReportAgainstJobs,
  validateReportDocument,
  validateWorkflowRunEvent,
} from '../scripts/publish-pr-report.mjs';

const repository = 'azerish25-ux/playwright-quality-platform';
const headSha = '1'.repeat(40);
const baseSha = '2'.repeat(40);
const testedSha = '3'.repeat(40);
const createdAt = '2026-09-27T14:00:00Z';
const updatedAt = '2026-09-27T14:05:00Z';

function eventFixture(overrides = {}) {
  return {
    action: 'completed',
    repository: { full_name: repository },
    workflow_run: {
      id: 1000,
      run_attempt: 1,
      workflow_id: 77,
      name: 'CI',
      path: '.github/workflows/ci.yml',
      event: 'pull_request',
      conclusion: 'success',
      head_sha: headSha,
      head_branch: 'feature/reporting',
      created_at: createdAt,
      updated_at: updatedAt,
      repository: { full_name: repository },
      head_repository: { full_name: 'contributor/playwright-quality-platform' },
      pull_requests: [],
      ...overrides,
    },
  };
}

function contextFixture(overrides = {}) {
  return {
    repository,
    workflowName: 'CI',
    workflowPath: '.github/workflows/ci.yml',
    workflowId: 77,
    runId: 1000,
    runAttempt: 1,
    runCreatedAt: createdAt,
    runUpdatedAt: updatedAt,
    workflowConclusion: 'success',
    sourceSha: headSha,
    headBranch: 'feature/reporting',
    testedSha,
    prNumber: 12,
    headSha,
    baseSha,
    headRepository: 'contributor/playwright-quality-platform',
    artifactName: artifactName(1000, 1),
    runUrl: `https://github.com/${repository}/actions/runs/1000/attempts/1`,
    ...overrides,
  };
}

function reportFixture(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: REPORT_KIND,
    repository,
    workflow: 'CI',
    workflowPath: '.github/workflows/ci.yml',
    runId: 1000,
    runAttempt: 1,
    pullRequestNumber: 12,
    pullRequestHeadSha: headSha,
    pullRequestBaseSha: baseSha,
    sourceHeadSha: headSha,
    testedSha,
    aggregate: { verify: 'success', consumer: 'success', teamboard: 'success', action: 'success', gateStep: 'success' },
    generatedAt: '2026-09-27T14:04:00Z',
    ...overrides,
  };
}

let nextJobId = 1;
const job = (name, conclusion = 'success') => ({ id: nextJobId++, name, conclusion });
function jobsFixture(conclusion = 'success') {
  return [
    ...['ubuntu-latest, 22', 'ubuntu-latest, 24', 'windows-latest, 22', 'windows-latest, 24', 'macos-latest, 22', 'macos-latest, 24'].map((axis) => job(`verify (${axis})`, conclusion)),
    ...['ubuntu-latest', 'windows-latest', 'macos-latest'].map((os) => job(`consumer (${os})`, conclusion)),
    job('teamboard', conclusion), job('action', conclusion), job('forgeqa-quality', conclusion),
  ];
}

const response = (status, body, headers = {}) => new Response(body === undefined ? null : JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', ...headers },
});

async function artifactDirectory(document = reportFixture()) {
  const directory = await mkdtemp(join(tmpdir(), 'forgeqa-pr-report-'));
  await writeFile(join(directory, REPORT_FILE), `${JSON.stringify(document)}\n`, 'utf8');
  return directory;
}

function pullFixture() {
  return {
    number: 12,
    state: 'open',
    merge_commit_sha: testedSha,
    head: { sha: headSha, ref: 'feature/reporting', repo: { full_name: 'contributor/playwright-quality-platform' } },
    base: { sha: baseSha, repo: { full_name: repository } },
  };
}

function routeFetch({ evidence = true, changedWorkflow = false, permissionDenied = false } = {}) {
  let postedBody = '';
  const calls = [];
  const fetchImpl = async (url, init = { method: 'GET' }) => {
    const parsed = new URL(url);
    calls.push([init.method, parsed.pathname]);
    if (parsed.pathname.endsWith(`/commits/${headSha}/pulls`)) return response(200, [pullFixture()]);
    if (parsed.pathname.endsWith('/pulls/12')) return response(200, pullFixture());
    if (parsed.pathname.endsWith('/actions/workflows/77/runs')) return response(200, { workflow_runs: [{ id: 1000, run_attempt: 1, created_at: createdAt, head_branch: 'feature/reporting', head_repository: { full_name: 'contributor/playwright-quality-platform' }, pull_requests: [] }] });
    if (parsed.pathname.endsWith('/pulls/12/files')) return response(200, [{ filename: changedWorkflow ? '.github/workflows/ci.yml' : 'src/app.ts' }]);
    if (parsed.pathname.endsWith('/actions/runs/1000/artifacts')) return response(200, { artifacts: evidence ? [{ id: 50, name: artifactName(1000, 1), expired: false, size_in_bytes: 300, expires_at: '2099-01-01T00:00:00Z', workflow_run: { id: 1000 } }] : [] });
    if (parsed.pathname.endsWith('/actions/runs/1000/attempts/1/jobs')) return response(200, { jobs: jobsFixture() });
    if (parsed.pathname.endsWith('/issues/12/comments') && init.method === 'GET') return response(200, []);
    if (parsed.pathname.endsWith('/issues/12/comments') && init.method === 'POST') {
      if (permissionDenied) return response(403, { message: 'Resource not accessible by integration' });
      postedBody = JSON.parse(init.body).body;
      return response(201, { id: 500, body: postedBody });
    }
    assert.fail(`unexpected request ${init.method} ${parsed.pathname}`);
  };
  return { fetchImpl, calls, postedBody: () => postedBody };
}

test('workflow_run validation accepts fork metadata and rejects substituted trust roots', () => {
  const context = validateWorkflowRunEvent(eventFixture(), repository);
  assert.equal(context.headRepository, 'contributor/playwright-quality-platform');
  assert.equal(context.pullRequestReference, undefined);
  assert.equal(context.artifactName, 'forgeqa-pr-report-1000-1');
  assert.throws(() => validateWorkflowRunEvent(eventFixture({ path: '.github/workflows/evil.yml' }), repository), /workflow path/);
  const substituted = eventFixture();
  substituted.workflow_run.repository.full_name = 'attacker/repository';
  assert.throws(() => validateWorkflowRunEvent(substituted, repository), /base repository/);
});

test('missing workflow_run PR references resolve only through the exact tested commit', async () => {
  const api = { listPullRequestsForCommit: async () => [pullFixture()] };
  const context = await resolvePullRequestContext(api, validateWorkflowRunEvent(eventFixture(), repository));
  assert.equal(context.prNumber, 12);
  assert.equal(context.headSha, headSha);
  await assert.rejects(resolvePullRequestContext({ listPullRequestsForCommit: async () => [pullFixture(), { ...pullFixture(), number: 13 }] }, validateWorkflowRunEvent(eventFixture(), repository)), /exactly one/);
});

test('report schema, lane inventory, and GitHub conclusions must agree exactly', () => {
  const jobs = summarizeRequiredJobs(jobsFixture());
  assert.equal(validateReportDocument(reportFixture(), contextFixture()).runId, 1000);
  assert.doesNotThrow(() => validateReportAgainstJobs(reportFixture(), jobs));
  assert.throws(() => validateReportDocument({ ...reportFixture(), injected: true }, contextFixture()), /unexpected fields/);
  assert.throws(() => validateReportDocument(reportFixture({ runId: 1001 }), contextFixture()), /run id/);
  assert.throws(() => summarizeRequiredJobs(jobsFixture().slice(1)), /expected 6/);
  assert.throws(() => validateReportAgainstJobs(reportFixture({ aggregate: { verify: 'failure', consumer: 'success', teamboard: 'success', action: 'success', gateStep: 'failure' } }), jobs), /contradicts/);
});

test('artifact extraction accepts one bounded regular JSON file and rejects extras, links, and oversize', async (t) => {
  const directory = await artifactDirectory();
  assert.match((await readValidatedReport(directory, contextFixture())).sha256, /^[0-9a-f]{64}$/);
  await writeFile(join(directory, 'extra.txt'), 'unexpected', 'utf8');
  await assert.rejects(readValidatedReport(directory, contextFixture()), /exactly one/);
  const large = await mkdtemp(join(tmpdir(), 'forgeqa-pr-report-large-'));
  await writeFile(join(large, REPORT_FILE), ' '.repeat(70 * 1024), 'utf8');
  await assert.rejects(readValidatedReport(large, contextFixture()), /size limit/);
  if (process.platform !== 'win32') {
    const linked = await mkdtemp(join(tmpdir(), 'forgeqa-pr-report-link-'));
    const target = join(linked, 'target.json');
    await writeFile(target, JSON.stringify(reportFixture()), 'utf8');
    await symlink(target, join(linked, REPORT_FILE));
    await assert.rejects(readValidatedReport(linked, contextFixture()), /symbolic link|exactly one/);
  } else t.diagnostic('symbolic-link assertion is POSIX-specific');
});

test('artifact metadata and trusted workflow provenance fail closed', () => {
  const context = contextFixture();
  const valid = { id: 5, name: context.artifactName, expired: false, size_in_bytes: 100, expires_at: '2099-01-01T00:00:00Z', workflow_run: { id: 1000 } };
  assert.equal(validateArtifactMetadata([valid], context).id, 5);
  assert.throws(() => validateArtifactMetadata([valid, { ...valid, id: 6 }], context), /exactly one/);
  assert.throws(() => validateArtifactMetadata([{ ...valid, expired: true }], context), /expired/);
  assert.doesNotThrow(() => assertTrustedWorkflowUnchanged([{ filename: 'src/app.ts' }], context.workflowPath));
  assert.throws(() => assertTrustedWorkflowUnchanged([{ filename: context.workflowPath }], context.workflowPath), /cannot be published/);
});

test('freshness blocks closed, changed, or superseded pull requests', async () => {
  const context = contextFixture();
  const api = {
    getPullRequest: async () => pullFixture(),
    listWorkflowRuns: async () => [{ id: 1000, run_attempt: 1, created_at: createdAt, head_branch: context.headBranch, head_repository: { full_name: context.headRepository }, pull_requests: [] }],
  };
  assert.equal((await assertFreshPullRequest(api, context)).testedSha, testedSha);
  api.getPullRequest = async () => ({ ...pullFixture(), head: { ...pullFixture().head, sha: '4'.repeat(40) } });
  await assert.rejects(assertFreshPullRequest(api, context), SkipPublication);
  assert.ok(findNewerRun([{ id: 1001, run_attempt: 1, created_at: '2026-09-27T14:01:00Z', pull_requests: [{ number: 12 }] }], context));
});

test('comment rendering sanitizes mentions and exposes stable machine metadata', () => {
  const body = renderComment({ context: contextFixture(), jobs: summarizeRequiredJobs(jobsFixture()), evidence: { sha256: 'a'.repeat(64), bytes: 100 } });
  assert.match(body, new RegExp(REPORT_MARKER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(parseCommentMetadata(body).runId, 1000);
  assert.doesNotMatch(body, /@everyone/);
});

test('idempotent comment publication ignores attacker markers and removes duplicate bot comments', async () => {
  const old = renderComment({ context: contextFixture({ runId: 999 }), jobs: summarizeRequiredJobs(jobsFixture()), evidenceError: 'old' });
  const attacker = { id: 1, user: { login: 'attacker' }, body: REPORT_MARKER };
  const primary = { id: 2, user: { login: 'github-actions[bot]' }, body: old };
  const duplicate = { id: 3, user: { login: 'github-actions[bot]' }, body: old };
  assert.deepEqual(selectManagedComments([attacker, duplicate, primary]).map((comment) => comment.id), [2, 3]);
  const mutations = [];
  const api = {
    listComments: async () => [attacker, duplicate, primary],
    updateComment: async (id, body) => (mutations.push(['update', id]), { id, body }),
    deleteComment: async (id) => mutations.push(['delete', id]),
  };
  await publishComment(api, contextFixture(), 'new body');
  assert.deepEqual(mutations, [['update', 2], ['delete', 3]]);
});

test('a newer bot comment cannot be overwritten by an older completion', async () => {
  const newer = renderComment({ context: contextFixture({ runId: 1001 }), jobs: summarizeRequiredJobs(jobsFixture()), evidenceError: 'newer' });
  const api = { listComments: async () => [{ id: 9, user: { login: 'github-actions[bot]' }, body: newer }] };
  await assert.rejects(publishComment(api, contextFixture(), 'older'), SkipPublication);
});

test('GitHub API pagination and bounded rate-limit retry are enforced', async () => {
  let requests = 0;
  const fetchImpl = async (url) => {
    requests += 1;
    if (requests === 1) return response(429, { message: 'slow down' }, { 'retry-after': '0' });
    const page = Number(new URL(url).searchParams.get('page'));
    return response(200, page === 1 ? Array.from({ length: 100 }, (_, index) => ({ id: index + 1 })) : []);
  };
  const api = new GitHubApi({ token: 'token-value', repository, fetchImpl, sleep: async () => {} });
  assert.equal((await api.listComments(12)).length, 100);
  assert.equal(requests, 3);
});

test('authorization validates PR freshness, workflow files, and run-bound artifact before extraction', async () => {
  const root = await mkdtemp(join(tmpdir(), 'forgeqa-authorize-'));
  const eventPath = join(root, 'event.json');
  await writeFile(eventPath, JSON.stringify(eventFixture()), 'utf8');
  const routes = routeFetch();
  const result = await runPublisher({ env: { GITHUB_EVENT_PATH: eventPath, GITHUB_REPOSITORY: repository, GITHUB_TOKEN: 'token-value' }, fetchImpl: routes.fetchImpl, sleep: async () => {}, authorizeDownload: true });
  assert.equal(result.status, 'authorized');
  assert.equal(result.artifact.id, 50);
});

test('full publication rechecks freshness and posts validated evidence once', async () => {
  const directory = await artifactDirectory();
  const root = await mkdtemp(join(tmpdir(), 'forgeqa-publish-'));
  const eventPath = join(root, 'event.json');
  await writeFile(eventPath, JSON.stringify(eventFixture()), 'utf8');
  const routes = routeFetch();
  const result = await runPublisher({
    env: { GITHUB_EVENT_PATH: eventPath, GITHUB_REPOSITORY: repository, GITHUB_TOKEN: 'token-value', FORGEQA_EVIDENCE_DIRECTORY: directory, FORGEQA_DOWNLOAD_OUTCOME: 'success' },
    fetchImpl: routes.fetchImpl,
    sleep: async () => {},
  });
  assert.equal(result.status, 'published');
  assert.equal(routes.calls.filter(([, path]) => path.endsWith('/pulls/12')).length, 2);
  assert.match(routes.postedBody(), /trusted default-branch publisher/);
});

test('missing evidence, changed workflow, and comment permission denial remain failures', async () => {
  const root = await mkdtemp(join(tmpdir(), 'forgeqa-failures-'));
  const eventPath = join(root, 'event.json');
  await writeFile(eventPath, JSON.stringify(eventFixture()), 'utf8');
  const missing = routeFetch({ evidence: false });
  await assert.rejects(runPublisher({
    env: { GITHUB_EVENT_PATH: eventPath, GITHUB_REPOSITORY: repository, GITHUB_TOKEN: 'token-value', FORGEQA_EVIDENCE_DIRECTORY: join(root, 'missing'), FORGEQA_DOWNLOAD_OUTCOME: 'failure' },
    fetchImpl: missing.fetchImpl,
    sleep: async () => {},
  }), /infrastructure failures/);
  assert.match(missing.postedBody(), /REPORTING INFRASTRUCTURE FAILURE/);

  const changed = routeFetch({ changedWorkflow: true });
  await assert.rejects(runPublisher({
    env: { GITHUB_EVENT_PATH: eventPath, GITHUB_REPOSITORY: repository, GITHUB_TOKEN: 'token-value', FORGEQA_EVIDENCE_DIRECTORY: join(root, 'missing'), FORGEQA_DOWNLOAD_OUTCOME: 'skipped' },
    fetchImpl: changed.fetchImpl,
    sleep: async () => {},
  }), /infrastructure failures/);
  assert.match(changed.postedBody(), /trusted originating workflow/);

  const denied = routeFetch({ permissionDenied: true });
  const api = new GitHubApi({ token: 'token-value', repository, fetchImpl: denied.fetchImpl, sleep: async () => {} });
  api.listComments = async () => [];
  await assert.rejects(publishComment(api, contextFixture(), REPORT_MARKER), (error) => error instanceof ReportingError && error.status === 403);
});
