import { appendFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { publishComment, markdownEscape, renderComment } from './pr-report/comments.mjs';
import { assertTrustedWorkflowUnchanged, readValidatedReport, validateArtifactMetadata } from './pr-report/evidence.mjs';
import { GitHubApi } from './pr-report/github-api.mjs';
import { assertFreshPullRequest, summarizeRequiredJobs, validateReportAgainstJobs } from './pr-report/jobs.mjs';
import {
  DEFAULT_BOT_LOGIN,
  ReportingError,
  SkipPublication,
  assert,
  resolvePullRequestContext,
  safeRepository,
  text,
  validateWorkflowRunEvent,
} from './pr-report/shared.mjs';

export {
  DEFAULT_BOT_LOGIN,
  REPORT_FILE,
  REPORT_KIND,
  REPORT_MARKER,
  ReportingError,
  SkipPublication,
  artifactName,
  resolvePullRequestContext,
  validateWorkflowRunEvent,
} from './pr-report/shared.mjs';
export {
  assertTrustedWorkflowUnchanged,
  readValidatedReport,
  validateArtifactMetadata,
  validateReportDocument,
} from './pr-report/evidence.mjs';
export { GitHubApi } from './pr-report/github-api.mjs';
export {
  assertFreshPullRequest,
  findNewerRun,
  summarizeRequiredJobs,
  validateReportAgainstJobs,
} from './pr-report/jobs.mjs';
export {
  parseCommentMetadata,
  publishComment,
  renderComment,
  selectManagedComments,
} from './pr-report/comments.mjs';

async function appendSummary(path, lines) {
  if (!path) return;
  await appendFile(path, `${lines.join('\n')}\n`, 'utf8');
}

export async function runPublisher({ env = process.env, fetchImpl = globalThis.fetch, sleep, preflight = false, authorizeDownload = false } = {}) {
  const eventPath = text(env.GITHUB_EVENT_PATH, 'GITHUB_EVENT_PATH', 4096);
  const repository = safeRepository(env.GITHUB_REPOSITORY);
  const workflowName = env.FORGEQA_EXPECTED_WORKFLOW || 'CI';
  const workflowPath = env.FORGEQA_EXPECTED_WORKFLOW_PATH || '.github/workflows/ci.yml';
  const event = JSON.parse(await readFile(eventPath, 'utf8'));
  const eventContext = validateWorkflowRunEvent(event, repository, workflowName, workflowPath);
  if (preflight) return { status: 'preflight', context: eventContext };

  const token = text(env.GITHUB_TOKEN, 'GITHUB_TOKEN', 4096);
  const api = new GitHubApi({ token, repository, fetchImpl, ...(sleep ? { sleep } : {}) });
  const resolvedContext = await resolvePullRequestContext(api, eventContext);
  const freshness = await assertFreshPullRequest(api, resolvedContext);
  const context = Object.freeze({
    ...resolvedContext,
    baseSha: freshness.pull.base.sha,
    testedSha: freshness.testedSha,
  });

  if (authorizeDownload) {
    assertTrustedWorkflowUnchanged(await api.listPullRequestFiles(context.prNumber), context.workflowPath);
    const artifact = validateArtifactMetadata(await api.listArtifacts(context.runId), context);
    return { status: 'authorized', context, artifact };
  }

  let workflowTrustError;
  try {
    assertTrustedWorkflowUnchanged(await api.listPullRequestFiles(context.prNumber), context.workflowPath);
  } catch (error) {
    workflowTrustError = error instanceof Error ? error.message : String(error);
  }

  let evidence;
  let evidenceError;
  try {
    assert(!workflowTrustError, workflowTrustError);
    assert(env.FORGEQA_DOWNLOAD_OUTCOME === 'success', 'The report artifact download did not succeed.');
    const artifact = validateArtifactMetadata(await api.listArtifacts(context.runId), context);
    const validated = await readValidatedReport(text(env.FORGEQA_EVIDENCE_DIRECTORY, 'FORGEQA_EVIDENCE_DIRECTORY', 4096), context);
    evidence = Object.freeze({ ...validated, expiresAt: artifact.expires_at });
  } catch (error) {
    evidenceError = error instanceof Error ? error.message : String(error);
  }

  let jobs;
  let jobsError;
  try {
    jobs = summarizeRequiredJobs(await api.listJobs(context.runId, context.runAttempt));
    if (jobs['forgeqa-quality'] !== context.workflowConclusion) {
      throw new ReportingError('Aggregate job conclusion does not match the workflow conclusion.');
    }
  } catch (error) {
    jobsError = error instanceof Error ? error.message : String(error);
  }

  if (evidence && jobs) {
    try {
      validateReportAgainstJobs(evidence.document, jobs);
    } catch (error) {
      evidenceError = error instanceof Error ? error.message : String(error);
      evidence = undefined;
    }
  }

  const problems = [workflowTrustError, evidenceError, jobsError].filter(Boolean);
  const body = renderComment({ context, jobs, evidence, evidenceError: problems.join(' ') || undefined });
  await assertFreshPullRequest(api, context);
  await publishComment(api, context, body, env.FORGEQA_BOT_LOGIN || DEFAULT_BOT_LOGIN);

  await appendSummary(env.GITHUB_STEP_SUMMARY, [
    '## Deadpan PR report publication',
    '',
    `- Pull request: #${context.prNumber}`,
    `- Run: ${context.runId} attempt ${context.runAttempt}`,
    '- Comment: published or updated idempotently',
    `- Evidence: ${evidence ? `validated (${evidence.sha256})` : 'invalid or unavailable'}`,
    ...(problems.length ? ['', ...problems.map((problem) => `> ${markdownEscape(problem)}`)] : []),
  ]);
  if (problems.length) throw new ReportingError(`PR comment published with reporting infrastructure failures: ${problems.join(' ')}`);
  return { status: 'published', context, evidence, jobs };
}

async function writeOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  await appendFile(process.env.GITHUB_OUTPUT, `${name}=${value}\n`, 'utf8');
}

async function main() {
  const preflight = process.argv.includes('--preflight');
  const authorizeDownload = process.argv.includes('--authorize-download');
  try {
    const result = await runPublisher({ preflight, authorizeDownload });
    if (authorizeDownload) {
      await writeOutput('download-approved', 'true');
      await writeOutput('artifact-name', result.context.artifactName);
      console.log(`Authorized bounded report artifact for workflow run ${result.context.runId}.`);
    } else if (preflight) {
      console.log(`Validated trusted workflow_run ${result.context.runId}.`);
    } else {
      console.log(`Published Deadpan report for PR #${result.context.prNumber}.`);
    }
  } catch (error) {
    if (error instanceof SkipPublication) {
      if (authorizeDownload) await writeOutput('download-approved', 'false');
      console.log(error.message);
      await appendSummary(process.env.GITHUB_STEP_SUMMARY, ['## Deadpan PR report publication', '', `- Skipped: ${markdownEscape(error.message)}`]);
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    await appendSummary(process.env.GITHUB_STEP_SUMMARY, ['## Deadpan PR report publication', '', `- Failed: ${markdownEscape(message)}`]);
    process.exitCode = 3;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
