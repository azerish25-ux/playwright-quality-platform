import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { RESULT_SCHEMA_VERSION, sha256 } from '@azerish25-ux/forgeqa-core';
import { ResultJournal, mergeShardEvidence, reconcileNativeJson, validateShardEvidence } from '@azerish25-ux/forgeqa-reporter';

const revision={repository:'repo',sourceCommit:'source',testedCommit:'tested'};
const inventory=[{executionId:'execution-1',logicalTestId:'test-1',project:'api',environment:'local',shardIndex:1,shardTotal:1,title:'case 1',relativePath:'sample.spec.ts',repetition:0}];
function runWith(attempts){return {schemaVersion:RESULT_SCHEMA_VERSION,runId:'run-1',completion:'complete',selectionHash:'selection',configHash:'config',revision,attempts,missingExecutions:[],unexpectedExecutions:[],duplicateExecutions:[],shardIds:['shard-1'],inventory};}
function nativeWith({title='case 1',status='passed',expectedStatus='passed',retry=0}={}){return {suites:[{file:'sample.spec.ts',specs:[{title,tests:[{projectName:'api',expectedStatus,results:[{status,retry}]}]}]}]};}
async function fixture(t,{artifactRelative='attachments/diagnostic.txt',duplicate=false,blobCount=1}={}){
  const root=await mkdtemp(join(tmpdir(),'forgeqa-evidence-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const artifactPath=resolve(root,artifactRelative);
  if(!artifactPath.startsWith(root))t.after(()=>rm(artifactPath,{force:true}));
  await mkdir(dirname(artifactPath),{recursive:true});
  await writeFile(artifactPath,'redacted diagnostic\n');
  const bytes=await readFile(artifactPath);
  const artifact={path:artifactRelative.replace(/\\/g,'/'),type:'log',state:'captured',size:bytes.length,sha256:sha256(bytes)};
  const attempt={schemaVersion:RESULT_SCHEMA_VERSION,attemptId:'attempt-1',executionId:'execution-1',logicalTestId:'test-1',retry:0,outcome:'passed',startedAt:'2026-01-01T00:00:00Z',durationMs:4,project:'api',artifacts:duplicate?[artifact,{...artifact,type:'attachment'}]:[artifact]};
  const shard={schemaVersion:RESULT_SCHEMA_VERSION,runId:'run-1',shardId:'shard-1',shardIndex:1,shardTotal:1,selectionHash:'selection',configHash:'config',completion:'complete',revision,attempts:[attempt]};
  const journal=new ResultJournal(resolve(root,'attempts.ndjson'));
  const {attempts:ignoredAttempts,completion:ignoredCompletion,...header}=shard;
  await journal.start(header);
  await journal.attempt(attempt);
  await journal.finalize(shard);
  const finalBytes=await readFile(journal.finalPath);
  await writeFile(resolve(root,'shard-complete.json'),JSON.stringify({schemaVersion:1,runId:shard.runId,shardId:shard.shardId,shardIndex:1,shardTotal:1,selectionHash:shard.selectionHash,configHash:shard.configHash,completion:'complete',report:'attempts.ndjson.final.json',reportSha256:sha256(finalBytes)},null,2)+'\n');
  await mkdir(resolve(root,'blob-report'));
  for(let index=0;index<blobCount;index+=1)await writeFile(resolve(root,'blob-report',`report-${index+1}.zip`),Buffer.from(`PK\u0003\u0004forgeqa synthetic blob ${index}`));
  return {root,artifactPath,journal,attempt,shard};
}

test('distributed evidence validates, copies, rewrites paths, and reconciles exact native identity',async t=>{
  const value=await fixture(t);
  const evidence=await validateShardEvidence(value.journal.finalPath);
  assert.equal(evidence.nativeBlob.size>0,true);
  const run=runWith([value.attempt]);
  const output=resolve(value.root,'merged');
  const merged=await mergeShardEvidence([evidence],output,run);
  assert.equal(merged.manifest.counts.captured,1);
  assert.match(run.attempts[0].artifacts[0].path,/^artifacts\/shard-1-of-1\//);
  assert.equal((await readFile(resolve(output,run.attempts[0].artifacts[0].path),'utf8')),'redacted diagnostic\n');
  const reconciliation=reconcileNativeJson(run,nativeWith());
  assert.equal(reconciliation.status,'MATCHED');
  assert.equal(reconciliation.nativeAttempts,1);
});

test('post-finalization artifact changes fail evidence integrity',async t=>{
  const value=await fixture(t);
  await writeFile(value.artifactPath,'redacted diagnostiX\n');
  await assert.rejects(()=>validateShardEvidence(value.journal.finalPath),/checksum changed after capture/);
});

test('missing captured artifacts fail evidence integrity',async t=>{
  const value=await fixture(t);
  await rm(value.artifactPath,{force:true});
  await assert.rejects(()=>validateShardEvidence(value.journal.finalPath),/ENOENT|no such file/i);
});

test('captured artifact paths cannot escape the shard root',async t=>{
  const marker=`../forgeqa-escape-${randomUUID()}`;
  const value=await fixture(t,{artifactRelative:marker});
  await assert.rejects(()=>validateShardEvidence(value.journal.finalPath),/escapes its owned root/);
});

test('duplicate captured paths are rejected',async t=>{
  const value=await fixture(t,{duplicate:true});
  await assert.rejects(()=>validateShardEvidence(value.journal.finalPath),/duplicate captured artifact path/);
});

test('exactly one native blob report is required',async t=>{
  const value=await fixture(t,{blobCount:2});
  await assert.rejects(()=>validateShardEvidence(value.journal.finalPath),/exactly one Playwright blob report/);
});

test('symbolic-link artifacts are rejected',async t=>{
  if(process.platform==='win32')return t.skip('Windows symlink permissions are environment-dependent.');
  const value=await fixture(t);
  const target=`${value.artifactPath}.target`;
  await rename(value.artifactPath,target);
  await symlink(target,value.artifactPath);
  await assert.rejects(()=>validateShardEvidence(value.journal.finalPath),/not a regular owned file/);
});

test('native and canonical outcome disagreement fails closed',()=>{
  const attempt={schemaVersion:RESULT_SCHEMA_VERSION,attemptId:'attempt-1',executionId:'execution-1',logicalTestId:'test-1',retry:0,outcome:'failed',startedAt:'2026-01-01T00:00:00Z',durationMs:4,project:'api'};
  assert.throws(()=>reconcileNativeJson(runWith([attempt]),nativeWith()),/disagrees/);
});

test('same-count native identity substitution fails closed',()=>{
  const attempt={schemaVersion:RESULT_SCHEMA_VERSION,attemptId:'attempt-1',executionId:'execution-1',logicalTestId:'test-1',retry:0,outcome:'passed',startedAt:'2026-01-01T00:00:00Z',durationMs:4,project:'api'};
  assert.throws(()=>reconcileNativeJson(runWith([attempt]),nativeWith({title:'different test'})),/disagrees/);
});
