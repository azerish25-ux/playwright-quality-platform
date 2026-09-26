import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeShardResults, toHtmlReport, toJUnit } from '@azerish25-ux/forgeqa-reporter';
import { RESULT_SCHEMA_VERSION } from '@azerish25-ux/forgeqa-core';
const revision={repository:'repo',sourceCommit:'a',testedCommit:'b'};
function shard(index,total,attempts,extra={}){return {schemaVersion:RESULT_SCHEMA_VERSION,runId:'run',shardId:`s${index}`,shardIndex:index,shardTotal:total,selectionHash:'sel',configHash:'cfg',completion:'complete',revision,attempts,finalizedAt:'2026-01-01T00:00:00Z',journalSha256:'x',...extra};}
function attempt(id,executionId,testId,outcome='passed',retry=0){return {schemaVersion:RESULT_SCHEMA_VERSION,attemptId:id,executionId,logicalTestId:testId,retry,outcome,startedAt:'2026-01-01T00:00:00Z',durationMs:2};}
const manifest={schemaVersion:RESULT_SCHEMA_VERSION,runId:'run',selectionHash:'sel',configHash:'cfg',expected:[{executionId:'e1',logicalTestId:'<script>alert(1)</script>',project:'chromium',environment:'local',shardIndex:1,shardTotal:2},{executionId:'e2',logicalTestId:'t2',project:'chromium',environment:'local',shardIndex:2,shardTotal:2}]};

test('compatible shards merge once and preserve attempts',()=>{const merged=mergeShardResults([shard(2,2,[attempt('a2','e2','t2')]),shard(1,2,[attempt('a1','e1','t1','failed',0),attempt('a1r','e1','t1','passed',1)])],manifest);assert.equal(merged.completion,'complete');assert.equal(merged.attempts.length,3);});

test('missing, duplicate and incompatible shards fail integrity',()=>{assert.throws(()=>mergeShardResults([shard(1,2,[attempt('a','e1','t1')])],manifest),/Missing required shards/);assert.throws(()=>mergeShardResults([shard(1,2,[attempt('a','e1','t1')]),shard(1,2,[attempt('b','e2','t2')])],manifest),/Duplicate shard/);assert.throws(()=>mergeShardResults([shard(1,2,[attempt('a','e1','t1')]),shard(2,2,[attempt('b','e2','t2')],{configHash:'other'})],manifest),/incompatible/);});

test('HTML and JUnit escape hostile test content',()=>{const merged=mergeShardResults([shard(1,2,[attempt('a','e1','<script>alert(1)</script>')]),shard(2,2,[attempt('b','e2','t2')])],manifest);const html=toHtmlReport(merged);const xml=toJUnit(merged);assert.doesNotMatch(html,/<script>alert\(1\)<\/script>/);assert.match(html,/&lt;script&gt;/);assert.match(xml,/&lt;script&gt;/);});
