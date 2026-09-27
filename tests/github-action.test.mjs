import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  classifyOutcome,
  executeAction,
  parseActionInputs,
  resolveWorkingDirectory,
  validateReadinessUrl,
} from '../packages/github-action/dist/main.js';

async function workspace(t) {
  const root = await mkdtemp(join(tmpdir(), 'forgeqa-action-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'consumer', private: true, type: 'module' }));
  await writeFile(join(root, 'forgeqa.config.ts'), 'export default {};\n');
  await writeFile(join(root, 'playwright.config.ts'), 'export default {};\n');
  const cli = join(root, 'fake-cli.mjs');
  await writeFile(cli, `
import {appendFile, mkdir, readFile, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
const args=process.argv.slice(2);
const option=(name)=>{const i=args.indexOf(name);return i<0?'':args[i+1]??''};
const command=args[0]+(args[0]==='report'?' '+args[1]:'');
const output=option('--output');
const shard=option('--shard')||'1/1';
const [index,total]=shard.split('/').map(Number);
await appendFile(resolve('fake-cli-log.ndjson'),JSON.stringify({command,args,hasGitHubToken:Boolean(process.env.GITHUB_TOKEN),hasNodeAuth:Boolean(process.env.NODE_AUTH_TOKEN)})+'\\n');
if(command==='plan'){
  const runDir=join(output,'plan-run');await mkdir(runDir,{recursive:true});
  const manifestPath=join(runDir,'manifest.json');
  await writeFile(manifestPath,JSON.stringify({schemaVersion:1,runId:'fake-run',configHash:'fake-config',selectionHash:'fake-selection',expected:Array.from({length:total},(_,i)=>({executionId:'e'+(i+1),logicalTestId:'t'+(i+1),project:'api',environment:'local',shardIndex:i+1,shardTotal:total}))}));
  console.log(JSON.stringify({runId:'fake-run',runDir,manifestPath,tests:total,attempts:0}));
}else if(command==='run'){
  const runDir=join(output,'run-'+index,'shard-'+index+'-of-'+total);await mkdir(runDir,{recursive:true});
  const shardReport=join(runDir,'attempts.ndjson.final.json');
  const quality=String(process.env.FAKE_QUALITY_SHARD||'')===String(index);
  await writeFile(shardReport,JSON.stringify({schemaVersion:1,runId:'fake-run',shardIndex:index,shardTotal:total,quality}));
  console.log(JSON.stringify({runId:'fake-run',runDir,manifestPath:option('--manifest'),shardReport,shardIndex:index,shardCount:total,tests:1,attempts:1}));
  if(quality)process.exitCode=1;
}else if(command==='report merge'){
  await mkdir(output,{recursive:true});
  const reports=args.filter(value=>value.endsWith('attempts.ndjson.final.json'));
  const values=await Promise.all(reports.map(async path=>JSON.parse(await readFile(path,'utf8'))));
  const quality=values.some(value=>value.quality);
  const attempts=values.flatMap(value=>quality&&value.shardIndex===1?[{executionId:'e1',retry:0,outcome:'failed'},{executionId:'e1',retry:1,outcome:'passed'}]:[{executionId:'e'+value.shardIndex,retry:0,outcome:'passed'}]);
  await writeFile(join(output,'report.json'),JSON.stringify({attempts}));
  await writeFile(join(output,'index.html'),'<h1>ForgeQA</h1>');
  console.log(JSON.stringify({runId:'fake-run',output,tests:values.length,attempts:attempts.length}));
  if(quality)process.exitCode=1;
}else{
  console.error('unexpected command',command);process.exitCode=3;
}
`);
  return { root, cli };
}

function environment(root, extra = {}) {
  return {
    ...process.env,
    GITHUB_WORKSPACE: root,
    GITHUB_RUN_ID: '12345',
    GITHUB_RUN_ATTEMPT: '2',
    GITHUB_REPOSITORY: 'example/consumer',
    GITHUB_SERVER_URL: 'https://github.example',
    GITHUB_TOKEN: 'canary-github-token',
    NODE_AUTH_TOKEN: 'canary-registry-token',
    INPUT_CLI_PATH: 'fake-cli.mjs',
    INPUT_INSTALL_DEPENDENCIES: 'false',
    INPUT_BROWSER_INSTALL: 'none',
    INPUT_REPORTING_MODE: 'none',
    INPUT_OUTPUT_DIRECTORY: '.forgeqa/action',
    ...extra,
  };
}

test('input validation distinguishes local shards from explicit matrix shards', () => {
  const local = parseActionInputs({ INPUT_SHARD_COUNT: '4', INPUT_INSTALL_DEPENDENCIES: 'false' });
  assert.equal(local.shardCount, 4);
  assert.equal(local.shardIndex, undefined);
  assert.throws(() => parseActionInputs({
    INPUT_SHARD_COUNT: '4', INPUT_SHARD_INDEX: '2', INPUT_INSTALL_DEPENDENCIES: 'false',
  }), /requires a manifest/);
  assert.throws(() => parseActionInputs({
    INPUT_APPLICATION_COMMAND: 'npm start', INPUT_INSTALL_DEPENDENCIES: 'false',
  }), /requires readiness-url/);
  assert.equal(classifyOutcome(0), 'success');
  assert.equal(classifyOutcome(1), 'quality-failure');
  assert.equal(classifyOutcome(3), 'infrastructure-failure');
  assert.equal(classifyOutcome(130), 'interrupted');
});

test('workspace and readiness validation reject escape and credential-bearing URLs', async (t) => {
  const { root } = await workspace(t);
  assert.equal(await resolveWorkingDirectory(root, '.'), root);
  await assert.rejects(resolveWorkingDirectory(root, '..'), /escapes GITHUB_WORKSPACE/);
  assert.throws(() => validateReadinessUrl('file:///tmp/ready'), /HTTP or HTTPS/);
  assert.throws(() => validateReadinessUrl('https://user:password@example.test/ready'), /must not contain credentials/);
});

test('local shard mode plans once, enforces a worker budget, merges evidence and strips credentials', async (t) => {
  const { root } = await workspace(t);
  const outputs = join(root, 'github-output.txt');
  const result = await executeAction(environment(root, {
    GITHUB_OUTPUT: outputs,
    INPUT_SHARD_COUNT: '2',
    INPUT_WORKERS: '4',
    INPUT_MAX_LOCAL_SHARDS: '2',
  }));
  assert.equal(result.exitCode, 0, result.error);
  assert.equal(result.outcome, 'success');
  assert.equal(result.runId, 'fake-run');
  assert.equal(result.testCount, 2);
  assert.equal(result.attemptCount, 2);
  assert.equal(result.flakyCount, 0);
  assert.match(result.reportPath, /merged[\\/]index\.html$/);
  const invocations = (await readFile(join(root, 'fake-cli-log.ndjson'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(invocations.map(value => value.command).sort(), ['plan', 'report merge', 'run', 'run'].sort());
  for (const invocation of invocations) {
    assert.equal(invocation.hasGitHubToken, false);
    assert.equal(invocation.hasNodeAuth, false);
  }
  const shardRuns = invocations.filter(value => value.command === 'run');
  assert.ok(shardRuns.every(value => value.args.includes('2')), 'two workers are allocated to each of two local shards');
  const protocol = await readFile(outputs, 'utf8');
  assert.match(protocol, /outcome<<FORGEQA_/);
  assert.match(protocol, /artifact-name<<FORGEQA_/);
  assert.match(protocol, /forgeqa-12345-2-run/);
});

test('quality failure remains nonzero after all local shard evidence is merged', async (t) => {
  const { root } = await workspace(t);
  const result = await executeAction(environment(root, {
    INPUT_SHARD_COUNT: '2',
    INPUT_WORKERS: '2',
    FAKE_QUALITY_SHARD: '1',
  }));
  assert.equal(result.exitCode, 1, result.error);
  assert.equal(result.outcome, 'quality-failure');
  assert.equal(result.flakyCount, 1);
  assert.equal(result.testCount, 2);
  assert.equal(result.attemptCount, 3);
});

test('merge mode rejects symbolic-link evidence before invoking report code', async (t) => {
  if (process.platform === 'win32') return;
  const { root } = await workspace(t);
  const manifest = join(root, 'manifest.json');
  await writeFile(manifest, '{}');
  const evidence = join(root, 'evidence');
  await mkdir(evidence);
  const outside = join(root, 'outside.json');
  await writeFile(outside, JSON.stringify({ shardIndex: 1, shardTotal: 1 }));
  await symlink(outside, join(evidence, 'attempts.ndjson.final.json'));
  const result = await executeAction(environment(root, {
    INPUT_MODE: 'merge',
    INPUT_MANIFEST: 'manifest.json',
    INPUT_EVIDENCE_DIRECTORY: 'evidence',
    INPUT_SHARD_COUNT: '1',
  }));
  assert.equal(result.exitCode, 3);
  assert.match(result.error, /symbolic link/);
});
