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

test('the source workflow keeps action acceptance in the required aggregate gate', async () => {
  const workflow = await read('.github/workflows/ci.yml');
  assert.match(workflow, /\n  action:\n/);
  assert.match(workflow, /uses:\s*\.\//);
  assert.match(workflow, /needs:\s*\[verify, consumer, teamboard, action\]/);
  assert.match(workflow, /ACTION_RESULT/);
});
