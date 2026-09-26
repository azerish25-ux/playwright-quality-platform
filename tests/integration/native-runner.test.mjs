import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm, readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
const root=fileURLToPath(new URL('../../',import.meta.url));
const cli=resolve(root,'packages/cli/dist/cli.js');
const native=resolve(root,'node_modules/@playwright/test/cli.js');
async function invoke(binary,args,cwd,extra={}) {return new Promise((res,rej)=>{const p=spawn(process.execPath,[binary,...args],{cwd,env:{...process.env,CI:'1',...extra},shell:false});let out='',err='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);p.on('error',rej);p.on('close',code=>res({code,out,err}));});}
async function consumer(t,body,{retries=0,config='',extra=''}={}) {
  await mkdir(resolve(root,'.tmp'),{recursive:true});
  const dir=await mkdtemp(resolve(root,'.tmp','native Ω '));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  await writeFile(join(dir,'package.json'),JSON.stringify({name:'native-consumer',private:true,type:'module'}));
  await writeFile(join(dir,'forgeqa.config.ts'),`import {defineForgeConfig} from '@azerish25-ux/forgeqa-core'; export default defineForgeConfig({project:'native-consumer',environments:{local:{baseUrl:'http://127.0.0.1:31999'}},browsers:[],retries:${retries},${config}});`);
  await writeFile(join(dir,'playwright.config.ts'),`import {defineForgePlaywrightConfig} from '@azerish25-ux/forgeqa-playwright';import forge from './forgeqa.config';export default defineForgePlaywrightConfig(forge,{testDir:'.',testMatch:'sample.spec.ts',projects:[{name:'api'}],${extra}});`);
  await writeFile(join(dir,'sample.spec.ts'),`import {test as base,expect} from '@playwright/test';import {createForgeTest,forgeId} from '@azerish25-ux/forgeqa-playwright';import fs from 'node:fs';import path from 'node:path';const test=createForgeTest(base);${body}`);
  return dir;
}
async function run(dir,args=[]) {const result=await invoke(cli,['run','--json',...args],dir);try{return {...result,value:JSON.parse(result.out)};}catch{assert.fail(`Non-JSON output: ${result.out}\n${result.err}`);}}
async function report(result) {return JSON.parse(await readFile(join(result.value.runDir,'report.json'),'utf8'));}

test('real native discovery, callable fixture extension, attempts and artifact checksums',async t=>{
 const dir=await consumer(t,`test('worker context',{tag:'@smoke',annotation:forgeId('native.worker')},async({forge},info)=>{expect(forge.namespace).toMatch(/^fq-/);expect(info.project.name).toBe('api');});`);
 const plan=await invoke(cli,['plan','--json'],dir);assert.equal(plan.code,0,plan.out+plan.err);assert.equal(JSON.parse(plan.out).manifest.expected.length,1);
 const result=await run(dir);assert.equal(result.code,0,result.out+result.err);assert.equal(result.value.tests,1);assert.equal(result.value.attempts,1);
 const data=await report(result);assert.equal(data.gate.outcome,'pass');assert.equal(data.attempts[0].logicalTestId,'native.worker');assert.equal(data.attempts[0].artifacts.find(a=>a.type==='trace').state,'inapplicable');
 const blobs=await readdir(join(result.value.runDir,'blob-report'));assert.ok(blobs.some(p=>p.endsWith('.zip')));
});

test('real failure is not converted to success by report generation',async t=>{
 const dir=await consumer(t,`test('failure',{tag:'@smoke'},async()=>{expect(1).toBe(2);});`);
 const result=await run(dir);assert.equal(result.code,1,result.out+result.err);const data=await report(result);assert.equal(data.attempts[0].outcome,'failed');assert.equal(data.gate.outcome,'fail');
});

test('retry recovery retains both attempts and fails CLI and native entrypoints',async t=>{
 const dir=await consumer(t,`test('retry recovery',{tag:'@smoke'},async({},info)=>{expect(info.retry).toBe(1);});`,{retries:1});
 const result=await run(dir);assert.equal(result.code,1,result.out+result.err);const data=await report(result);assert.deepEqual(data.attempts.map(a=>a.outcome),['failed','passed']);assert.ok(data.gate.violations.some(v=>v.id==='test.retry-recovered'));assert.equal(result.value.tests,1);
 const direct=await invoke(native,['test','--config','playwright.config.ts'],dir);assert.notEqual(direct.code,0,direct.out+direct.err);
});

test('empty selections, unknown options and invalid config fail before execution',async t=>{
 const dir=await consumer(t,`test('release only',{tag:'@release'},async()=>{});`);
 const result=await run(dir);assert.equal(result.code,2,result.out+result.err);
 const unknown=await run(dir,['--workerss','2']);assert.equal(unknown.code,2);assert.match(unknown.out,/Unknown option/);
 await writeFile(join(dir,'forgeqa.config.ts'),`export default {project:'bad',environments:{local:{baseUrl:'http://localhost'}},workers:0};`);
 const invalid=await run(dir);assert.equal(invalid.code,2,invalid.out+invalid.err);
});

test('duplicate explicit IDs and focused tests fail discovery',async t=>{
 const dir=await consumer(t,`test('one',{tag:'@smoke',annotation:forgeId('same.id')},async()=>{});test('two',{tag:'@smoke',annotation:forgeId('same.id')},async()=>{});`);
 const duplicate=await run(dir);assert.equal(duplicate.code,2,duplicate.out+duplicate.err);
 await writeFile(join(dir,'sample.spec.ts'),`import {test} from '@playwright/test';test.only('focused',{tag:'@smoke'},async()=>{});`);
 const focused=await run(dir);assert.equal(focused.code,2,focused.out+focused.err);
});

test('reporter write failure cannot yield a finalized green result',async t=>{
 const dir=await consumer(t,`test('break reporter output',{tag:'@smoke'},async({},info)=>{fs.mkdirSync(path.join(info.config.metadata.forgeqa.runDir,'report.json'));});`);
 const result=await run(dir);assert.equal(result.code,3,result.out+result.err);assert.ok(result.value.failures.some(f=>f.code==='FORGEQA_INTEGRITY'));
});

test('discovery drift cannot overwrite or bypass the pre-execution manifest',async t=>{
 const dir=await consumer(t,`test('always',{tag:'@smoke'},async()=>{});if(JSON.parse(fs.readFileSync(process.env.FORGEQA_RUN_REQUEST,'utf8')).mode==='run')test('unplanned',{tag:'@smoke'},async()=>{});`);
 const result=await run(dir);assert.equal(result.code,3,result.out+result.err);
});

test('expected failures remain explicit; unexpected passes and skips fail policy',async t=>{
 const dir=await consumer(t,`test('expected',{tag:'@smoke'},async()=>{test.fail();expect(1).toBe(2);});test('unexpected',{tag:'@smoke'},async()=>{test.fail();expect(1).toBe(1);});test.skip('missing coverage',{tag:'@smoke'},async()=>{});`);
 const result=await run(dir);assert.equal(result.code,1,result.out+result.err);const data=await report(result);assert.deepEqual(new Set(data.attempts.map(a=>a.outcome)),new Set(['expected-failure','unexpected-pass','skipped']));assert.ok(data.gate.violations.some(v=>v.id==='test.skip-budget'));
});

test('suite inheritance uses native tags, not a printed plan',async t=>{
 const dir=await consumer(t,`for(const tag of ['@smoke','@regression','@release'])test(tag,{tag},async()=>{});`);
 const regression=await run(dir,['--suite','regression']);assert.equal(regression.code,0,regression.out+regression.err);assert.equal(regression.value.tests,2);
 const release=await run(dir,['--suite','release']);assert.equal(release.code,0,release.out+release.err);assert.equal(release.value.tests,3);
});

test('invalid and expired quarantine stays blocking',async t=>{
 const dir=await consumer(t,`test('owned',{tag:'@smoke',annotation:forgeId('owned.test')},async()=>{});`);
 await mkdir(join(dir,'.forgeqa'));await writeFile(join(dir,'.forgeqa/quarantine.json'),JSON.stringify([{schemaVersion:1,testId:'owned.test',owner:'',reason:'synthetic',issue:'test-case',createdAt:'2020-01-01',expiresAt:'2020-01-02'}]));
 const result=await run(dir);assert.equal(result.code,1,result.out+result.err);const data=await report(result);assert.ok(data.gate.violations.some(v=>v.id==='quarantine.expired'));assert.ok(data.gate.violations.some(v=>v.id==='quarantine.invalid'));
});
