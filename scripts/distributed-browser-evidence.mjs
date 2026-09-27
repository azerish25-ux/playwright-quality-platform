import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = resolve(root, 'packages/cli/dist/cli.js');
function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
async function invoke(args, cwd) {
  return await new Promise((done, reject) => {
    const child = spawn(process.execPath, [cli, ...args, '--json'], {
      cwd,
      env: { ...process.env, CI: '1' },
      shell: false,
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => { out += chunk.toString(); });
    child.stderr.on('data', (chunk) => { err += chunk.toString(); });
    child.once('error', reject);
    child.once('close', (code) => {
      let value;
      try { value = JSON.parse(out); }
      catch {
        reject(new Error(`Non-JSON ForgeQA output (${code}): ${out}\n${err}`));
        return;
      }
      done({ code, value, out, err });
    });
  });
}

await mkdir(resolve(root, '.tmp'), { recursive: true });
const directory = await mkdtemp(resolve(root, '.tmp', 'browser-evidence-'));
try {
  await writeFile(join(directory, 'package.json'), JSON.stringify({
    name: 'browser-evidence-consumer',
    private: true,
    type: 'module',
  }));
  await writeFile(join(directory, 'forgeqa.config.ts'), "import {defineForgeConfig} from '@azerish25-ux/forgeqa-core';export default defineForgeConfig({project:'browser-evidence-consumer',environments:{local:{baseUrl:'http://127.0.0.1:31999'}},browsers:['chromium'],workers:1,retries:1,artifactPolicy:{trace:'retain-on-failure',screenshot:'only-on-failure',video:'off'},qualityGates:{failOnRetryRecovered:true}});");
  await writeFile(join(directory, 'playwright.config.ts'), "import {defineForgePlaywrightConfig} from '@azerish25-ux/forgeqa-playwright';import forge from './forgeqa.config';export default defineForgePlaywrightConfig(forge,{testDir:'.',testMatch:'browser.spec.ts',fullyParallel:true,projects:[{name:'chromium',use:{browserName:'chromium'}}]});");
  await writeFile(join(directory, 'browser.spec.ts'), `import {test as base,expect} from '@playwright/test';
import {createForgeTest,forgeId} from '@azerish25-ux/forgeqa-playwright';
const test=createForgeTest(base);
for(let index=1;index<=4;index+=1)test('browser case '+index,{tag:'@smoke',annotation:forgeId('browser.evidence.'+index)},async({page},testInfo)=>{
  await page.setContent('<main><h1>ForgeQA browser evidence '+index+'</h1></main>');
  await expect(page.getByRole('heading')).toContainText(String(index));
  if(index===2&&testInfo.retry===0){
    await testInfo.attach('screenshot',{body:await page.screenshot(),contentType:'image/png'});
    expect('first-attempt').toBe('retry-pass');
  }
});`);

  const plan = await invoke(['plan', '--shard', '1/2'], directory);
  assert.equal(plan.code, 0, plan.out + plan.err);
  assert.equal(plan.value.manifest.expected.length, 4);
  const first = await invoke(['run', '--shard', '1/2', '--manifest', plan.value.manifestPath], directory);
  const second = await invoke(['run', '--shard', '2/2', '--manifest', plan.value.manifestPath], directory);
  assert.ok([0, 1].includes(first.code), first.out + first.err);
  assert.ok([0, 1].includes(second.code), second.out + second.err);
  assert.ok(first.value.shardReport);
  assert.ok(second.value.shardReport);
  assert.ok(first.code === 1 || second.code === 1, 'The deterministic retry-recovered case must make one shard nonzero.');

  const output = join(directory, 'merged-browser-evidence');
  const merged = await invoke([
    'report', 'merge', '--manifest', plan.value.manifestPath, '--output', output,
    first.value.shardReport, second.value.shardReport,
  ], directory);
  assert.equal(merged.code, 1, merged.out + merged.err);
  assert.equal(merged.value.completion, 'complete');
  assert.equal(merged.value.gate.outcome, 'fail');
  assert.ok(merged.value.gate.violations.some((violation) => violation.id === 'test.retry-recovered'));
  assert.equal(merged.value.evidence.reconciliation.status, 'MATCHED');

  const report = JSON.parse(await readFile(join(output, 'report.json'), 'utf8'));
  assert.equal(new Set(report.attempts.map((attempt) => attempt.executionId)).size, 4);
  assert.equal(report.attempts.length, 5);
  const failedAttempt = report.attempts.find((attempt) => attempt.retry === 0 && attempt.outcome === 'failed');
  assert.ok(failedAttempt, 'Expected the deterministic first attempt to remain failed evidence.');
  const captured = (failedAttempt.artifacts ?? []).filter((artifact) => artifact.state === 'captured');
  for (const kind of ['trace', 'screenshot']) {
    const artifact = captured.find((candidate) => candidate.type === kind);
    assert.ok(artifact, `Expected captured ${kind} evidence on the failed attempt.`);
    const bytes = await readFile(join(output, artifact.path));
    assert.equal(bytes.length, artifact.size);
    assert.equal(digest(bytes), artifact.sha256);
  }
  const complete = JSON.parse(await readFile(join(output, 'complete.json'), 'utf8'));
  assert.equal(complete.reconciliation.status, 'MATCHED');
  await access(join(output, 'playwright-report', 'index.html'));
  await access(join(output, 'artifact-manifest.json'));
  process.stdout.write(`${JSON.stringify({
    status: 'PASS',
    runId: report.runId,
    attempts: report.attempts.length,
    captured: captureKinds(captured),
  })}\n`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
function captureKinds(artifacts) {
  return Object.fromEntries([...new Set(artifacts.map((item) => item.type))]
    .sort()
    .map((type) => [type, artifacts.filter((item) => item.type === type).length]));
}
