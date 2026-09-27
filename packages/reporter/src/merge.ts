import { IntegrityError, RESULT_SCHEMA_VERSION, type MergedRunResult, type SelectionManifest, type ShardResult } from '@azerish25-ux/forgeqa-core';
function sameRevision(a:ShardResult,b:ShardResult):boolean{return a.revision.repository===b.revision.repository&&a.revision.testedCommit===b.revision.testedCommit;}
export function mergeShardResults(shards:ShardResult[], manifest:SelectionManifest):MergedRunResult{
  if(manifest.schemaVersion!==RESULT_SCHEMA_VERSION)throw new IntegrityError('Unsupported manifest schema.');
  if(!shards.length)throw new IntegrityError('No shard reports were provided.');
  const first=shards[0]!; const expectedTotal=first.shardTotal;
  if(expectedTotal<1)throw new IntegrityError('Invalid shard total.');
  const byIndex=new Map<number,ShardResult>(); const shardIds=new Set<string>();
  for(const shard of shards){
    if(!shard.finalizedAt || !shard.journalSha256)throw new IntegrityError('Shard lacks finalization evidence.');
    if(shard.schemaVersion!==RESULT_SCHEMA_VERSION)throw new IntegrityError(`Unsupported shard schema ${shard.schemaVersion}.`);
    if(shard.runId!==manifest.runId||shard.selectionHash!==manifest.selectionHash||shard.configHash!==manifest.configHash)throw new IntegrityError(`Shard ${shard.shardId} is incompatible with the expected manifest.`);
    if(shard.shardTotal!==expectedTotal||!sameRevision(first,shard))throw new IntegrityError(`Shard ${shard.shardId} has conflicting run dimensions.`);
    if(byIndex.has(shard.shardIndex)||shardIds.has(shard.shardId))throw new IntegrityError(`Duplicate shard ${shard.shardIndex}/${expectedTotal}.`);
    if(shard.shardIndex<1||shard.shardIndex>expectedTotal)throw new IntegrityError(`Shard index ${shard.shardIndex} is out of range.`);
    byIndex.set(shard.shardIndex,shard); shardIds.add(shard.shardId);
  }
  const missingShardIndexes=[] as number[]; for(let index=1;index<=expectedTotal;index+=1)if(!byIndex.has(index))missingShardIndexes.push(index);
  if(missingShardIndexes.length)throw new IntegrityError(`Missing required shards: ${missingShardIndexes.join(', ')}.`);
  const attempts=shards.flatMap((shard)=>shard.attempts);
  const seenAttempts=new Set<string>(); const duplicateExecutions:string[]=[];
  for(const attempt of attempts){if(seenAttempts.has(attempt.attemptId))throw new IntegrityError(`Duplicate attempt id ${attempt.attemptId}.`);seenAttempts.add(attempt.attemptId);}
  const expected=new Set(manifest.expected.map((entry)=>entry.executionId)); const actual=new Set(attempts.map((entry)=>entry.executionId));
  const missingExecutions=[...expected].filter((id)=>!actual.has(id)).sort(); const unexpectedExecutions=[...actual].filter((id)=>!expected.has(id)).sort();
  const counts=new Map<string,number>(); for(const attempt of attempts.filter((entry)=>entry.retry===0))counts.set(attempt.executionId,(counts.get(attempt.executionId)??0)+1);
  for(const [id,count] of counts)if(count>1)duplicateExecutions.push(id);
  const complete=shards.every((shard)=>shard.completion==='complete')&&!missingExecutions.length&&!unexpectedExecutions.length&&!duplicateExecutions.length;
  return {schemaVersion:RESULT_SCHEMA_VERSION,runId:first.runId,completion:complete?'complete':'incomplete',selectionHash:first.selectionHash,configHash:first.configHash,revision:first.revision,attempts:attempts.sort((a,b)=>a.startedAt.localeCompare(b.startedAt)||a.retry-b.retry||a.executionId.localeCompare(b.executionId)||a.attemptId.localeCompare(b.attemptId)),missingExecutions,unexpectedExecutions,duplicateExecutions,shardIds:[...shardIds].sort()};
}
