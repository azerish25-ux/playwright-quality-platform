import test from 'node:test';
import assert from 'node:assert/strict';
import { renderComment } from '../scripts/pr-report/comments.mjs';
import { summarizeRequiredJobs, validateReportAgainstJobs } from '../scripts/pr-report/jobs.mjs';
import { validateReportDocument } from '../scripts/pr-report/evidence.mjs';

const head = '1'.repeat(40);
const base = '2'.repeat(40);
const tested = '3'.repeat(40);
const context = {
  repository: 'azerish25-ux/playwright-quality-platform',
  workflowName: 'CI',
  workflowPath: '.github/workflows/ci.yml',
  runId: 2000,
  runAttempt: 1,
  runCreatedAt: '2026-09-27T15:00:00Z',
  runUpdatedAt: '2026-09-27T15:10:00Z',
  workflowConclusion: 'success',
  sourceSha: head,
  headSha: head,
  baseSha: base,
  testedSha: tested,
  prNumber: 20,
  artifactName: 'forgeqa-pr-report-2000-1',
  runUrl: 'https://github.com/azerish25-ux/playwright-quality-platform/actions/runs/2000/attempts/1',
};
const report = {
  schemaVersion: 2,
  kind: 'forgeqa-pr-report',
  repository: context.repository,
  workflow: 'CI',
  workflowPath: '.github/workflows/ci.yml',
  runId: 2000,
  runAttempt: 1,
  pullRequestNumber: 20,
  pullRequestHeadSha: head,
  pullRequestBaseSha: base,
  sourceHeadSha: head,
  testedSha: tested,
  aggregate: {
    verify: 'success', consumer: 'success', teamboard: 'success', ledgerguard: 'success', action: 'success', gateStep: 'success',
  },
  generatedAt: '2026-09-27T15:05:00Z',
};
let id = 0;
const job = (name) => ({ id: ++id, name, conclusion: 'success' });
const jobs = [
  ...['ubuntu-latest, 22', 'ubuntu-latest, 24', 'windows-latest, 22', 'windows-latest, 24', 'macos-latest, 22', 'macos-latest, 24'].map((axis) => job(`verify (${axis})`)),
  ...['ubuntu-latest', 'windows-latest', 'macos-latest'].map((os) => job(`consumer (${os})`)),
  job('teamboard'), job('ledgerguard'), job('action'), job('forgeqa-quality'),
];

test('schema v2 binds the LedgerGuard lane into evidence, job inventory and comments', () => {
  const summarized = summarizeRequiredJobs(jobs);
  assert.equal(summarized.ledgerguard, 'success');
  assert.doesNotThrow(() => validateReportDocument(report, context));
  assert.doesNotThrow(() => validateReportAgainstJobs(report, summarized));
  assert.match(renderComment({ context, jobs: summarized, evidence: { sha256: 'a'.repeat(64), bytes: 100 } }), /\| ledgerguard \| SUCCESS \|/);
});

test('schema v2 fails closed when LedgerGuard evidence or job inventory is absent', () => {
  const summarized = summarizeRequiredJobs(jobs);
  const missingAggregate = { ...report, aggregate: { ...report.aggregate } };
  delete missingAggregate.aggregate.ledgerguard;
  assert.throws(() => validateReportDocument(missingAggregate, context), /unexpected fields/);
  const legacySummary = summarizeRequiredJobs(jobs.filter((item) => item.name !== 'ledgerguard'));
  assert.throws(() => validateReportAgainstJobs(report, legacySummary), /ledgerguard result contradicts/);
  assert.throws(() => validateReportAgainstJobs({ ...report, aggregate: { ...report.aggregate, ledgerguard: 'failure', gateStep: 'failure' } }, summarized), /contradicts/);
});
