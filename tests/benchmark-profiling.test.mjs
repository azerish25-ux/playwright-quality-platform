import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { validateExecutionTiming } from '../packages/core/dist/timing.js';
import { checkedProfile, profilesForRecord, summarizeProfiles } from '../benchmarks/lib/profiling.mjs';
import { summarizeControlled, controlledSchedule } from '../benchmarks/lib/controlled.mjs';
function profile(shardIndex=1,shardTotal=1,runId='synthetic') {
  const identity={sourceSha:'a'.repeat(40),runId,shardIndex,shardTotal};
  const base={schemaVersion:1,kind:'forgeqa-timing-record',completion:'complete',completedMs:100,clockId:randomUUID(),identity};
  const records=[
    {...base,component:'application',spans:[{name:'applicationReadiness',startMs:0,endMs:10},{name:'applicationShutdown',startMs:60,endMs:70}],counters:{}},
    {...base,component:'reporter',spans:[{name:'testWindow',startMs:10,endMs:60},{name:'forgeqaFinalization',startMs:70,endMs:80},{name:'allReportersFinalization',startMs:70,endMs:90}],counters:{attempts:2,attemptWorkMs:90}}
  ];
  return validateExecutionTiming(records,identity,110);
}
function record(){return{sourceSha:'a'.repeat(40),runId:'synthetic',shards:2,attempts:4,durations:{testWallMs:110,testAggregateMs:220},timingVersion:1,lifecycle:{profiles:[profile(1,2),profile(2,2)]}};}
test('distributed profiling preserves different host clocks rather than subtracting them',()=>{
  const result=profilesForRecord(record());
  assert.equal(result.length,2);
  assert.notEqual(result[0].clockId,result[1].clockId);
  assert.equal(summarizeProfiles(result).stages.testWindow.median,50);
});
for(const [label,mutate] of [
  ['duplicate shard',r=>{r.lifecycle.profiles[1]=r.lifecycle.profiles[0];}],
  ['missing shard',r=>r.lifecycle.profiles.pop()],
  ['wrong attempt inventory',r=>{r.attempts=5;}],
  ['wrong run',r=>{r.runId='other';}],
  ['future profile version',r=>{r.lifecycle.profiles[0].schemaVersion=2;}],
  ['changed derived duration',r=>{r.lifecycle.profiles[0].stages.testWindow=1;}],
  ['changed residual',r=>{r.lifecycle.profiles[0].unattributedCliMs=0;}],
  ['wrong parent envelope',r=>{r.durations.testAggregateMs=300;}],
  ['missing parent envelope',r=>{delete r.durations;}],
  ['absent timing',r=>{delete r.lifecycle;}]
])test(`distributed profiling rejects ${label}`,()=>{const r=record();mutate(r);assert.throws(()=>profilesForRecord(r));});
test('checked profiles reject tampered raw observations and missing evidence',()=>{
  const p=profile();
  assert.deepEqual(checkedProfile(p,p.identity,110),p);
  p.records[0].completion='incomplete';
  assert.throws(()=>checkedProfile(p,p.identity,110),/Incomplete/);
  assert.throws(()=>summarizeProfiles([]),/No validated/);
});
function localRecords(){return controlledSchedule(1).map(c=>({status:'PASS',warmupStatus:'PASS',mergeStatus:0,condition:c.id,workers:c.workers,repetition:c.repetition,sourceSha:'a'.repeat(40),protocolDigest:'b'.repeat(64),runnerSession:'single-host',hardware:{cpuModel:'synthetic',cpuCount:4,totalMemoryBytes:1000},identities:['one','two'],runId:'synthetic',runMs:110,mergeMs:5,criticalPathMs:115,lifecycle:profile()}));}
test('controlled profile acceptance retains historical reading without promoting distributed scope',()=>{
  const data=localRecords();
  const summary=summarizeControlled(data,1,{requireTiming:true});
  assert.equal(summary.lifecycle.status,'PASS');
  assert.equal(summary.fullBenchmarkAcceptance,false);
  assert.equal(summary.localComparisonAccepted,false);
  assert(summary.conditions.every(c=>c.speedup===null));
  assert(!summary.limitations.some(s=>s.includes('granular lifecycle acceptance remains incomplete')));
  const legacy=data.map(({lifecycle,...record})=>record);
  assert.equal(summarizeControlled(legacy,1).status,'PASS');
  assert.throws(()=>summarizeControlled(legacy,1,{requireTiming:true}),/Missing/);
  delete data[0].lifecycle;
  assert.throws(()=>summarizeControlled(data,1),/Missing/);
});
