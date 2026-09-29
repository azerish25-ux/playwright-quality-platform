import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createTimingContext, TimingRecorder, validateExecutionTiming, readExecutionTiming, readTimingContext, timingUnion } from '../packages/core/dist/timing.js';
const owner = { sourceSha: 'a'.repeat(40), runId: 'test-run', shardIndex: 1, shardTotal: 2 };
const clockId = randomUUID();
function records() {
  const base = { schemaVersion: 1, kind: 'forgeqa-timing-record', identity: owner, clockId, completion: 'complete', completedMs: 100 };
  return [
    { ...base, component: 'application', spans: [{ name: 'applicationReadiness', startMs: 0, endMs: 20 }, { name: 'applicationShutdown', startMs: 70, endMs: 85 }], counters: {} },
    { ...base, component: 'reporter', spans: [{ name: 'testWindow', startMs: 25, endMs: 70 }, { name: 'forgeqaFinalization', startMs: 85, endMs: 90 }, { name: 'allReportersFinalization', startMs: 85, endMs: 95 }], counters: { attempts: 2, attemptWorkMs: 90 } }
  ];
}
test('timing keeps nested reporters and parallel attempt work out of additive wall time', () => {
  const profile = validateExecutionTiming(records(), owner, 110);
  assert.equal(profile.stages.forgeqaFinalization, 5);
  assert.equal(profile.stages.allReportersFinalization, 10);
  assert.equal(profile.observedPhaseUnionMs, 90);
  assert.equal(profile.unattributedCliMs, 20);
  assert.equal(profile.attemptWorkMs, 90);
  assert.equal(profile.stages.testWindow, 45);
  assert.equal(profile.attempts, 2);
  assert.equal(timingUnion([...records()[1].spans].reverse()), 55);
});
for (const [name, mutate] of [
  ['wrong source', r => { r[0].identity = { ...owner, sourceSha: 'b'.repeat(40) }; }],
  ['wrong run', r => { r[0].identity = { ...owner, runId: 'other' }; }],
  ['wrong shard', r => { r[0].identity = { ...owner, shardIndex: 2 }; }],
  ['duplicate component', r => { r[1] = r[0]; }],
  ['missing component', r => r.pop()],
  ['cross-host clocks', r => { r[0].clockId = randomUUID(); }],
  ['future schema', r => { r[0].schemaVersion = 2; }],
  ['incomplete finalization', r => { r[0].completion = 'incomplete'; }],
  ['null finalization', r => { r[0].completedMs = null; }],
  ['missing stage', r => r[0].spans.pop()],
  ['duplicate stage', r => r[0].spans.push(r[0].spans[0])],
  ['unknown stage', r => { r[0].spans[0].name = 'invented'; }],
  ['negative time', r => { r[0].spans[0].startMs = -1; }],
  ['non-finite time', r => { r[0].spans[0].endMs = Infinity; }],
  ['reversed span', r => { r[0].spans[0].endMs = -1; }],
  ['outside finalization', r => { r[0].spans[0].endMs = 105; }],
  ['outside CLI envelope', r => { r[0].completedMs = 111; }],
  ['missing attempt count', r => { delete r[1].counters.attempts; }],
  ['null attempt work', r => { r[1].counters.attemptWorkMs = null; }],
  ['fractional attempt count', r => { r[1].counters.attempts = 1.5; }],
  ['reversed finalization ordering', r => { r[1].spans[1].startMs = 80; }],
  ['tests after finalization', r => { r[1].spans[0].endMs = 88; }]
]) test(`timing rejects ${name}`, () => {
  const input = structuredClone(records()); mutate(input);
  assert.throws(() => validateExecutionTiming(input, owner, 110), /FORGEQA_TIMING/);
});
test('union is order independent, accounts for overlap and rejects invalid intervals', () => {
  const spans = [{name:'a',startMs:5,endMs:10},{name:'b',startMs:7,endMs:20},{name:'c',startMs:25,endMs:30}];
  assert.equal(timingUnion(spans), 20);
  assert.equal(timingUnion([...spans].reverse()),20);
  assert.throws(() => timingUnion([{name:'a',startMs:10,endMs:5}]),/Invalid interval/);
});
test('exclusive, private recorder leaves interrupted acquisition incomplete and refuses collision', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forgeqa timing Ω '));
  try {
    const path = createTimingContext(join(dir, 'timing'), owner);
    const recorder = new TimingRecorder(path, 'application');
    assert.equal(readTimingContext(path).identity.runId,owner.runId);
    assert.equal(JSON.parse(readFileSync(join(dirname(path), 'application.json'))).completion,'incomplete');
    assert.throws(() => new TimingRecorder(path, 'application'), /EEXIST/);
    assert.throws(() => new TimingRecorder(path, '../../escape'), /Unknown timing component/);
    assert.throws(() => new TimingRecorder(path, 'reporter', {...owner,runId:'other'}), /different source/);
    assert.throws(() => readExecutionTiming(dirname(path), owner, 10000));
    const start = recorder.now();
    recorder.span('applicationReadiness',start);
    assert.throws(() => recorder.span('applicationReadiness',start),/duplicate/);
    recorder.span('applicationShutdown',recorder.now());
    recorder.finish(true);
    assert.throws(() => recorder.span('applicationShutdown',start), /finalized/);
    assert.throws(() => recorder.finish(true), /already finalized/);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
test('real child termination retains incomplete evidence; host-local clock works across processes', () => {
  const dir = mkdtempSync(join(tmpdir(),'forgeqa timing child '));
  try {
    const path = createTimingContext(join(dir,'timing'),owner);
    const module = new URL('../packages/core/dist/timing.js',import.meta.url).href;
    const result = spawnSync(process.execPath,['--input-type=module','-e',`import {TimingRecorder} from ${JSON.stringify(module)}; const r=new TimingRecorder(process.argv[1],'application'); r.span('applicationReadiness',r.now()); process.kill(process.pid,'SIGKILL');`,path],{encoding:'utf8',timeout:10000});
    assert.notEqual(result.status,0);
    const record=JSON.parse(readFileSync(join(dirname(path),'application.json')));
    assert.equal(record.completion,'incomplete');
    assert(record.spans[0].startMs>=0 && record.spans[0].endMs<10000);
    assert.throws(()=>readExecutionTiming(dirname(path),owner,10000));
  } finally {rmSync(dir,{recursive:true,force:true});}
});
test('invalid, oversized and symlinked records fail closed', () => {
  const dir=mkdtempSync(join(tmpdir(),'forgeqa timing guards '));
  try {
    const path=createTimingContext(join(dir,'timing'),owner);
    const original=readFileSync(path);
    writeFileSync(path,' '.repeat(65537));
    assert.throws(()=>readTimingContext(path),/oversized/);
    writeFileSync(path,original);
    const rec=new TimingRecorder(path,'application');
    assert.throws(()=>rec.counter('attempts',0.5),/Invalid/);
    assert.throws(()=>rec.span('applicationReadiness',-1),/invalid timing span/);
    if(process.platform!=='win32') {
      const target=join(dir,'target.json'); writeFileSync(target,'{}');
      symlinkSync(target,join(dirname(path),'reporter.json'));
      assert.throws(()=>readExecutionTiming(dirname(path),owner,10000),/Invalid or oversized/);
      assert.equal(readFileSync(target,'utf8'),'{}');
    }
  } finally {rmSync(dir,{recursive:true,force:true});}
});
test('file-backed completed evidence revalidates its source, clock and exact stage data',()=>{
  const dir=mkdtempSync(join(tmpdir(),'forgeqa timing complete '));
  try{
    const start=process.hrtime.bigint();
    const path=createTimingContext(join(dir,'timing'),owner);
    const app=new TimingRecorder(path,'application');
    app.span('applicationReadiness',app.now());
    const reporter=new TimingRecorder(path,'reporter');
    reporter.span('testWindow',reporter.now());
    app.span('applicationShutdown',app.now());app.finish(true);
    const final=reporter.now();reporter.span('forgeqaFinalization',final);
    reporter.span('allReportersFinalization',final);
    reporter.counter('attempts',1);reporter.counter('attemptWorkMs',1);reporter.finish(true);
    const elapsed=Number(process.hrtime.bigint()-start)/1e6;
    const result=readExecutionTiming(dirname(path),owner,elapsed);
    assert.equal(result.attempts,1);assert(result.unattributedCliMs>=0);
    assert.throws(()=>readExecutionTiming(dirname(path),{...owner,runId:'wrong'},elapsed),/identity mismatch/);
    const context=JSON.parse(readFileSync(path));context.clockId=randomUUID();writeFileSync(path,JSON.stringify(context));
    assert.throws(()=>readExecutionTiming(dirname(path),owner,elapsed),/do not belong/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
