import {
  ALLOWED_CONCLUSIONS,
  REQUIRED_LANES,
  ReportingError,
  SkipPublication,
  assert,
  isObject,
  sha,
  worstConclusion,
} from './shared.mjs';

function laneKey(name) {
  if (name === 'teamboard' || name === 'ledgerguard' || name === 'action' || name === 'forgeqa-quality') return name;
  if (name === 'verify' || name.startsWith('verify (')) return 'verify';
  if (name === 'consumer' || name.startsWith('consumer (')) return 'consumer';
  return undefined;
}

export function summarizeRequiredJobs(jobs) {
  assert(Array.isArray(jobs), 'Workflow jobs must be an array.');
  const grouped = new Map(Object.keys(REQUIRED_LANES).map((name) => [name, []]));
  for (const job of jobs) {
    if (!isObject(job) || typeof job.name !== 'string') continue;
    const key = laneKey(job.name);
    if (key) grouped.get(key).push(job);
  }
  const summary = {};
  for (const [name, expectedCount] of Object.entries(REQUIRED_LANES)) {
    const laneJobs = grouped.get(name);
    if (name === 'ledgerguard' && laneJobs.length === 0) continue;
    assert(laneJobs.length === expectedCount, `Required lane ${name} expected ${expectedCount} job(s), observed ${laneJobs.length}.`);
    const conclusions = laneJobs.map((job) => {
      assert(typeof job.conclusion === 'string' && ALLOWED_CONCLUSIONS.has(job.conclusion), `Required lane ${name} has an incomplete or unsupported conclusion.`);
      return job.conclusion;
    });
    summary[name] = conclusions.every((value) => value === 'success') ? 'success' : worstConclusion(conclusions);
  }
  return Object.freeze(summary);
}

function needsResult(value) {
  if (value === 'success') return 'success';
  if (value === 'cancelled') return 'cancelled';
  if (value === 'skipped' || value === 'neutral') return 'skipped';
  return 'failure';
}

export function validateReportAgainstJobs(report, jobs) {
  assert(isObject(report) && isObject(report.aggregate), 'Validated report is missing aggregate results.');
  assert(isObject(jobs), 'Required-job summary is missing.');
  const lanes = Object.hasOwn(report.aggregate, 'ledgerguard')
    ? ['verify', 'consumer', 'teamboard', 'ledgerguard', 'action']
    : ['verify', 'consumer', 'teamboard', 'action'];
  for (const name of lanes) {
    assert(report.aggregate[name] === needsResult(jobs[name]), `Report ${name} result contradicts GitHub job conclusions.`);
  }
  assert(report.aggregate.gateStep === (jobs['forgeqa-quality'] === 'success' ? 'success' : 'failure'), 'Report aggregate gate contradicts the forgeqa-quality job conclusion.');
}

function runMatchesPullRequest(run, context) {
  const numbers = Array.isArray(run?.pull_requests)
    ? run.pull_requests.map((pr) => pr?.number).filter(Number.isSafeInteger)
    : [];
  if (numbers.includes(context.prNumber)) return true;
  return run?.head_branch === context.headBranch && run?.head_repository?.full_name === context.headRepository;
}

export function findNewerRun(runs, context) {
  const currentCreated = Date.parse(context.runCreatedAt);
  for (const run of runs) {
    if (!runMatchesPullRequest(run, context)) continue;
    if (run.id === context.runId && Number.isSafeInteger(run.run_attempt) && run.run_attempt > context.runAttempt) return run;
    const created = Date.parse(run.created_at);
    if (run.id !== context.runId && Number.isFinite(created) && (created > currentCreated || (created === currentCreated && run.id > context.runId))) return run;
  }
  return undefined;
}

export async function assertFreshPullRequest(api, context) {
  const pull = await api.getPullRequest(context.prNumber);
  assert(isObject(pull), 'Pull request response is malformed.');
  if (pull.state !== 'open') throw new SkipPublication(`Pull request #${context.prNumber} is no longer open.`);
  assert(isObject(pull.head) && isObject(pull.base), 'Pull request response is missing head/base metadata.');
  const currentHead = sha(pull.head.sha, 'current pull request head SHA');
  const currentBase = sha(pull.base.sha, 'current pull request base SHA');
  const currentMerge = sha(pull.merge_commit_sha, 'current pull request merge SHA');
  if (currentHead !== context.headSha) throw new SkipPublication(`Workflow run ${context.runId} is stale for pull request #${context.prNumber}.`);
  if (context.baseSha && currentBase !== context.baseSha) throw new SkipPublication(`Pull request #${context.prNumber} base changed after workflow run ${context.runId}.`);
  if (context.testedSha && currentMerge !== context.testedSha) throw new SkipPublication(`Pull request #${context.prNumber} merge ref changed after workflow run ${context.runId}.`);
  if (context.headRepository && isObject(pull.head.repo)) {
    assert(pull.head.repo.full_name === context.headRepository, 'Current pull request head repository differs from the originating run.');
  }
  const newer = findNewerRun(await api.listWorkflowRuns(context.workflowId), context);
  if (newer) throw new SkipPublication(`A newer CI run (${newer.id}) exists for pull request #${context.prNumber}.`);
  return Object.freeze({ pull, testedSha: currentMerge });
}
