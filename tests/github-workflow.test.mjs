import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = async (path) => (await readFile(resolve(root, path), 'utf8')).replace(/\r\n/g, '\n');

test('the public action ref carries its exact callable Node runtime', async () => {
  const action = await read('action.yml');
  assert.match(action, /using:\s*node24/);
  const match = action.match(/main:\s*([^\s]+)/);
  assert.ok(match, 'action.yml declares a main entrypoint');
  await access(resolve(root, match[1]));
  const runtime = await read(match[1]);
  assert.match(runtime, /export async function executeAction/);
  assert.match(runtime, /evidence-directory escapes the workspace/);
});

test('the reusable workflow pins every ForgeQA action invocation and never masks shard failures', async () => {
  const workflow = await read('.github/workflows/forgeqa-reusable.yml');
  const references = [...workflow.matchAll(/uses:\s*azerish25-ux\/playwright-quality-platform@([^\s]+)/g)].map((match) => match[1]);
  assert.equal(references.length, 3);
  for (const reference of references) assert.match(reference, /^[0-9a-f]{40}$/);
  assert.equal(new Set(references).size, 1, 'plan, shard and merge use one immutable action payload');
  assert.doesNotMatch(workflow, /continue-on-error:\s*true/);
  assert.match(workflow, /name:\s*forgeqa-quality/);
  assert.match(workflow, /if:\s*always\(\)/);
  assert.match(workflow, /pattern:\s*forgeqa-shard-/);
  assert.match(workflow, /persist-credentials:\s*false/g);
});

test('the source workflow keeps action and hardening acceptance in the required aggregate gate', async () => {
  const workflow = await read('.github/workflows/ci.yml');
  assert.match(workflow, /\n  ledgerguard:\n/);
  assert.match(workflow, /\n  hardening:\n/);
  assert.match(workflow, /\n  action:\n/);
  assert.match(workflow, /uses:\s*\.\//);
  assert.match(workflow, /needs:\s*\[verify, consumer, teamboard, ledgerguard, hardening, action\]/);
  assert.match(workflow, /LEDGERGUARD_RESULT/);
  assert.match(workflow, /HARDENING_RESULT/);
  assert.match(workflow, /ACTION_RESULT/);
  assert.match(workflow, /npm run hardening/);
  assert.match(workflow, /hardening-evidence-\$\{\{ github\.sha \}\}/);
});

test('pull-request CI always emits one run-bound data-only reporting artifact', async () => {
  const workflow = await read('.github/workflows/ci.yml');
  assert.match(workflow, /id:\s*enforce/);
  assert.match(workflow, /schemaVersion:\s*3/);
  assert.match(workflow, /kind:\s*'forgeqa-pr-report'/);
  assert.match(workflow, /workflowPath:\s*'\.github\/workflows\/ci\.yml'/);
  assert.match(workflow, /sourceHeadSha:\s*required\('REPORT_HEAD_SHA'\)/);
  assert.match(workflow, /ledgerguard:\s*required\('REPORT_LEDGERGUARD_RESULT'\)/);
  assert.match(workflow, /hardening:\s*required\('REPORT_HARDENING_RESULT'\)/);
  assert.match(workflow, /if:\s*always\(\) && github\.event_name == 'pull_request'/g);
  assert.match(workflow, /name:\s*forgeqa-pr-report-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);
  assert.match(workflow, /if-no-files-found:\s*error/);
});

test('the privileged PR publisher runs trusted code only and treats PR artifacts as data', async () => {
  const workflow = await read('.github/workflows/forgeqa-pr-report.yml');
  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /workflows:\s*\[CI\]/);
  assert.doesNotMatch(workflow, /pull_request_target/);
  assert.match(workflow, /actions:\s*read/);
  assert.match(workflow, /issues:\s*write/);
  assert.match(workflow, /pull-requests:\s*write/);
  assert.doesNotMatch(workflow, /pull-requests:\s*read/);
  assert.match(workflow, /ref:\s*\$\{\{ github\.event\.repository\.default_branch \}\}/);
  assert.match(workflow, /path:\s*trusted-source/);
  assert.match(workflow, /persist-credentials:\s*false/);
  assert.doesNotMatch(workflow, /ref:\s*\$\{\{ github\.event\.workflow_run\.head_sha/);
  assert.doesNotMatch(workflow, /repository:\s*\$\{\{ github\.event\.workflow_run\.head_repository/);
  assert.match(workflow, /path:\s*\$\{\{ runner\.temp \}\}\/forgeqa-pr-report/);
  assert.match(workflow, /node trusted-source\/scripts\/publish-pr-report\.mjs --authorize-download/);
  assert.match(workflow, /steps\.authorize\.outputs\.download-approved == 'true'/);
  assert.match(workflow, /name:\s*\$\{\{ steps\.authorize\.outputs\.artifact-name \}\}/);
  assert.match(workflow, /node trusted-source\/scripts\/publish-pr-report\.mjs/);
  assert.doesNotMatch(workflow, /continue-on-error:\s*true/);
  assert.match(workflow, /FORGEQA_DOWNLOAD_OUTCOME:\s*\$\{\{ steps\.download\.outcome \}\}/);
});
