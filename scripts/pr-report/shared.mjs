import { isAbsolute, relative, sep } from 'node:path';

export const REPORT_SCHEMA_VERSION = 1;
export const REPORT_KIND = 'forgeqa-pr-report';
export const REPORT_FILE = 'forgeqa-pr-report.json';
export const REPORT_MARKER = '<!-- forgeqa-quality-report:v1 -->';
export const META_PREFIX = '<!-- forgeqa-quality-meta:';
export const DEFAULT_BOT_LOGIN = 'github-actions[bot]';
export const MAX_ARCHIVE_BYTES = 512 * 1024;
export const MAX_EXTRACTED_BYTES = 256 * 1024;
export const MAX_REPORT_BYTES = 64 * 1024;
export const MAX_FILES = 4;
export const MAX_ENTRIES = 16;
export const MAX_DEPTH = 4;
export const MAX_PAGES = 10;
export const REQUIRED_LANES = Object.freeze({ verify: 6, consumer: 3, teamboard: 1, action: 1, 'forgeqa-quality': 1 });
export const ALLOWED_RESULTS = new Set(['success', 'failure', 'cancelled', 'skipped']);
export const ALLOWED_CONCLUSIONS = new Set([
  'success',
  'failure',
  'cancelled',
  'timed_out',
  'action_required',
  'neutral',
  'skipped',
  'stale',
  'startup_failure',
]);
export const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);
export const SHA_RE = /^[0-9a-f]{40}$/;

export class ReportingError extends Error {
  constructor(message, { status, cause } = {}) {
    super(message, { cause });
    this.name = 'ReportingError';
    this.status = status;
  }
}

export class SkipPublication extends Error {
  constructor(message) {
    super(message);
    this.name = 'SkipPublication';
  }
}

export function assert(condition, message) {
  if (!condition) throw new ReportingError(message);
}

export function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function exactKeys(value, keys, label) {
  assert(isObject(value), `${label} must be an object.`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  assert(actual.length === expected.length && actual.every((key, index) => key === expected[index]), `${label} has unexpected fields.`);
}

export function integer(value, label, min = 1) {
  assert(Number.isSafeInteger(value) && value >= min, `${label} must be an integer greater than or equal to ${min}.`);
  return value;
}

export function text(value, label, max = 256) {
  assert(typeof value === 'string' && value.length > 0 && value.length <= max && !value.includes('\0'), `${label} is invalid.`);
  return value;
}

export function sha(value, label) {
  assert(typeof value === 'string' && SHA_RE.test(value), `${label} must be a lowercase 40-character SHA.`);
  return value;
}

export function isoDate(value, label) {
  text(value, label, 64);
  const parsed = Date.parse(value);
  assert(Number.isFinite(parsed), `${label} must be an ISO timestamp.`);
  return parsed;
}

export function safeRepository(value) {
  text(value, 'repository', 200);
  assert(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value), 'repository is invalid.');
  return value;
}

export function within(root, candidate) {
  const path = relative(root, candidate);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

export function worstConclusion(values) {
  const ranks = { success: 0, skipped: 1, neutral: 1, cancelled: 2, timed_out: 3, action_required: 3, stale: 3, startup_failure: 3, failure: 4 };
  return [...values].sort((left, right) => (ranks[right] ?? 5) - (ranks[left] ?? 5))[0] ?? 'failure';
}

export function artifactName(runId, runAttempt) {
  return `forgeqa-pr-report-${integer(runId, 'run id')}-${integer(runAttempt, 'run attempt')}`;
}

function optionalPullReference(run) {
  assert(Array.isArray(run.pull_requests), 'Originating run pull_requests must be an array.');
  assert(run.pull_requests.length <= 1, 'Originating run identifies more than one pull request.');
  return run.pull_requests[0];
}

export function validateWorkflowRunEvent(event, expectedRepository, expectedWorkflowName = 'CI', expectedWorkflowPath = '.github/workflows/ci.yml') {
  assert(isObject(event), 'GITHUB_EVENT_PATH must contain an object.');
  const repository = safeRepository(expectedRepository);
  assert(event.action === 'completed', 'Only completed workflow_run events are accepted.');
  assert(isObject(event.repository) && event.repository.full_name === repository, 'Event repository does not match GITHUB_REPOSITORY.');
  const run = event.workflow_run;
  assert(isObject(run), 'workflow_run payload is missing.');
  assert(run.name === expectedWorkflowName, 'Unexpected originating workflow name.');
  assert(run.path === expectedWorkflowPath, 'Unexpected originating workflow path.');
  assert(run.event === 'pull_request', 'Only pull_request workflow runs can publish PR reports.');
  assert(isObject(run.repository) && run.repository.full_name === repository, 'Originating run repository is not the base repository.');
  integer(run.id, 'workflow run id');
  integer(run.run_attempt, 'workflow run attempt');
  integer(run.workflow_id, 'workflow id');
  const sourceSha = sha(run.head_sha, 'workflow source head SHA');
  assert(ALLOWED_CONCLUSIONS.has(run.conclusion), 'Workflow conclusion is missing or unsupported.');
  isoDate(run.created_at, 'workflow created_at');
  isoDate(run.updated_at, 'workflow updated_at');
  const headBranch = text(run.head_branch, 'workflow head branch', 256);
  const runHeadRepository = isObject(run.head_repository) && run.head_repository.full_name
    ? safeRepository(run.head_repository.full_name)
    : undefined;
  assert(runHeadRepository, 'Originating workflow run is missing its head repository.');
  const reference = optionalPullReference(run);
  let pullRequestReference;
  if (reference) {
    integer(reference.number, 'pull request number');
    assert(isObject(reference.head), 'Originating run is missing pull request head metadata.');
    assert(isObject(reference.base), 'Originating run is missing pull request base metadata.');
    const headRepository = isObject(reference.head.repo) && reference.head.repo.full_name
      ? safeRepository(reference.head.repo.full_name)
      : runHeadRepository;
    assert(runHeadRepository === headRepository, 'Originating head repository is inconsistent with the pull request reference.');
    pullRequestReference = Object.freeze({
      number: reference.number,
      headSha: sha(reference.head.sha, 'pull request head SHA'),
      baseSha: sha(reference.base.sha, 'pull request base SHA'),
      headRepository,
    });
  }
  return Object.freeze({
    repository,
    workflowName: expectedWorkflowName,
    workflowPath: expectedWorkflowPath,
    workflowId: run.workflow_id,
    runId: run.id,
    runAttempt: run.run_attempt,
    runCreatedAt: run.created_at,
    runUpdatedAt: run.updated_at,
    workflowConclusion: run.conclusion,
    sourceSha,
    headBranch,
    headRepository: runHeadRepository,
    pullRequestReference,
    artifactName: artifactName(run.id, run.run_attempt),
    runUrl: `https://github.com/${repository}/actions/runs/${run.id}/attempts/${run.run_attempt}`,
  });
}

export async function resolvePullRequestContext(api, context) {
  let reference = context.pullRequestReference;
  if (!reference) {
    const pulls = await api.listPullRequestsForCommit(context.sourceSha);
    const candidates = pulls.filter((pull) => {
      if (!isObject(pull) || !Number.isSafeInteger(pull.number) || !isObject(pull.head) || !isObject(pull.base)) return false;
      if (pull.base.repo?.full_name !== context.repository) return false;
      if (pull.head.repo?.full_name !== context.headRepository) return false;
      return pull.head.ref === context.headBranch;
    });
    const open = candidates.filter((pull) => pull.state === 'open');
    const selected = open.length === 1 ? open[0] : candidates.length === 1 ? candidates[0] : undefined;
    assert(selected, 'Could not resolve exactly one pull request for the originating workflow run.');
    reference = { number: selected.number, headSha: context.sourceSha, headRepository: context.headRepository };
  }
  if (context.pullRequestReference) {
    assert(reference.headSha === context.sourceSha, 'Originating workflow source SHA does not match the pull request reference head SHA.');
  }
  return Object.freeze({
    ...context,
    prNumber: reference.number,
    headSha: context.sourceSha,
    ...(context.pullRequestReference ? { baseSha: reference.baseSha } : {}),
    headRepository: reference.headRepository ?? context.headRepository,
  });
}
