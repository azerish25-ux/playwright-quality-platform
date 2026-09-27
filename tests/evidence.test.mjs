import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { RESULT_SCHEMA_VERSION, sha256 } from '@azerish25-ux/forgeqa-core';
import { ResultJournal, mergeShardEvidence, reconcileNativeJson, validateShardEvidence } from '@azerish25-ux/forgeqa-reporter';

const revision={repository:'repo',sourceCommit:'source',testedCommit:'tested'};
async function fixture(t){
  const root=await mkdtemp(join(tmpdir(),'forgeqa-evidence-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(resolve(root,'attachments'),{recursive:true});
  const artifactPath=resolve(root,'attachments','diagnostic.txt');
  await writeFile(artifactPath,'redacted diagnostic\n');
  const bytes=await readFile(artifactPath);
  const attempt={schemaVersion:RESULT_SCHEMA_VERSION,attemptId:'attempt-1',executionId:'execution-1',logicalTestId:'test-1',retry:0,outcome:'passed',startedAt:'2026-01-01T00:00:00Z',durationMs:4,project:'api',artifacts:[{path:'attachments/diagnostic.txt',type:'log',state:'captured',size:bytes.length,sha256:sha256(bytes)}]};
  const shard={schemaVersion:RESULT_SCHEMA_VERSION,runId:'run-1',shardId:'shard-1',shardIndex:1,shardTotal:1,selectionHash:'selection',configHash:'config',completion:'complete',revision,attempts:[attempt]};
  const journal=new ResultJournal(resolve(root,'attempts.ndjson'));
  const {attempts:ignoredAttempts,completion:ignoredCompletion,...header}=shard;
  await journal.start(header);
  await journal.attempt(attempt);
  await journal.finalize(shard);
  const finalBytes=await readFile(journal.finalPath);
  await writeFile(resolve(root,'shard-complete.json'),JSON.stringify({schemaVersion:1,runId:shard.runId,shardId:shard.shardId,shardIndex:1,shardTotal:1,selectionHash:shard.selectionHash,configHash:shard.configHash,completion:'complete',report:'attempts.ndjson.final.json',reportSha256:sha256(finalBytes)},null,2)+'\n');
  await mkdir(resolve(root,'blob-report'));
  await writeFile(resolve(root,'blob-report','report-1.zip'),Buffer.from('PK\u0003\u0004forgeqa synthetic blob'));
  return {root,artifactPath,journal,attempt,shard};
}

test('distributed evidence validates, copies, rewrites paths, and reconciles native results',async t=>{
  const value=await fixture(t);
  const evidence=await validateShardEvidence(value.journal.finalPath);
  assert.equal(evidence.nativeBlob.size>0,true);
  const run={schemaVersion:RESULT_SCHEMA_VERSION,runId:'run-1',completion:'complete',selectionHash:'selection',configHash:'config',revision,attempts:[value.attempt],missingExecutions:[],unexpectedExecutions:[],duplicateExecutions:[],shardIds:['shard-1']};
  const output=resolve(value.root,'merged');
  const merged=await mergeShardEvidence([evidence],output,run);
  assert.equal(merged.manifest.counts.captured,1);
  assert.match(run.attempts[0].artifacts[0].path,/^artifacts\/shard-1-of-1\//);
  assert.equal((await readFile(resolve(output,run.attempts[0].artifacts[0].path),'utf8')),'redacted diagnostic\n');
  const reconciliation=reconcileNativeJson(run,{suites:[{specs:[{tests:[{projectName:'api',expectedStatus:'passed',results:[{status:'passed',retry:0}]}]}]}]});
  assert.equal(reconciliation.status,'MATCHED');
  assert.equal(reconciliation.nativeAttempts,1);
});

test('post-finalization artifact changes fail evidence integrity',async t=>{
  const value=await fixture(t);
  await writeFile(value.artifactPath,'tampered\n');
  await assert.rejects(()=>validateShardEvidence(value.journal.finalPath),/checksum changed after capture/);
});

test('native and canonical outcome disagreement fails closed',()=>{
  const attempt={schemaVersion:RESULT_SCHEMA_VERSION,attemptId:'attempt-1',executionId:'execution-1',logicalTestId:'test-1',retry:0,outcome:'failed',startedAt:'2026-01-01T00:00:00Z',durationMs:4,project:'api'};
  const run={schemaVersion:RESULT_SCHEMA_VERSION,runId:'run-1',completion:'complete',selectionHash:'selection',configHash:'config',revision,attempts:[attempt],missingExecutions:[],unexpectedExecutions:[],duplicateExecutions:[],shardIds:['shard-1']};
  assert.throws(()=>reconcileNativeJson(run,{suites:[{specs:[{tests:[{projectName:'api',expectedStatus:'passed',results:[{status:'passed'}]}]}]}]}),/disagrees/);
});
