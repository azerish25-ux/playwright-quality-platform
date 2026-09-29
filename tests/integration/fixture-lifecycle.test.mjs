import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile, stat, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
async function invoke(dir){return new Promise((resolveResult,reject)=>{
  const processChild=spawn(process.execPath,[join(root,'packages/cli/dist/cli.js'),'run','--suite','release','--json'],{cwd:dir,env:{...process.env,CI:'1'},stdio:['ignore','pipe','pipe']});
  let out='',err='';const timer=setTimeout(()=>{processChild.kill();reject(new Error('Fixture child suite exceeded its execution budget.'));},90_000);
  processChild.stdout.on('data',data=>out+=data);processChild.stderr.on('data',data=>err+=data);
  processChild.once('error',error=>{clearTimeout(timer);reject(error);});processChild.once('close',code=>{clearTimeout(timer);resolveResult({code,out,err});});
});}
async function consumer(t,body,retries=0){
  await mkdir(join(root,'.tmp'),{recursive:true});const dir=await mkdtemp(join(root,'.tmp','fixture lifecycle Ω '));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  await writeFile(join(dir,'package.json'),' {"name":"fixture-lifecycle-consumer","private":true,"type":"module"}');
  await writeFile(join(dir,'forgeqa.config.ts'),`import {defineForgeConfig} from '@azerish25-ux/forgeqa-core';export default defineForgeConfig({project:'fixture-lifecycle-consumer',environments:{local:{baseUrl:'http://127.0.0.1:31999'}},browsers:[],retries:${retries},workers:1});`);
  await writeFile(join(dir,'playwright.config.ts'),`import {defineForgePlaywrightConfig} from '@azerish25-ux/forgeqa-playwright';import forge from './forgeqa.config';export default defineForgePlaywrightConfig(forge,{testDir:'.',testMatch:'lifecycle.spec.ts',projects:[{name:'api'}]});`);
  await writeFile(join(dir,'lifecycle.spec.ts'),`import {test as base,expect} from '@playwright/test';import {createForgeTest,forgeId} from '@azerish25-ux/forgeqa-playwright';import {appendFileSync} from 'node:fs';const test=createForgeTest(base);${body}`);
  return dir;
}

test('native failed-worker restart changes ownership and tears down both attempts without browser allocation',async t=>{
  const dir=await consumer(t,`test('recoverable worker failure',{tag:'@release',annotation:forgeId('lifecycle.restart')},async({forge,forgeScope,forgeFiles},info)=>{
    await forgeFiles.write('private.txt','test-only-private-state');
    const record={namespace:forge.namespace,scope:forgeScope.namespace,workerIndex:info.workerIndex,retry:info.retry,directory:forgeFiles.directory};
    appendFileSync('acquired.ndjson',JSON.stringify(record)+'\\n');
    forgeScope.defer({id:'receipt',cleanup:async()=>{appendFileSync('cleaned.ndjson',JSON.stringify({namespace:forge.namespace,retry:info.retry})+'\\n');}});
    expect(info.retry).toBe(1);
  });`,1);
  const execution=await invoke(dir);assert.equal(execution.code,1,execution.out+execution.err);
  const summary=JSON.parse(execution.out);assert.equal(summary.tests,1);assert.equal(summary.attempts,2);
  const report=JSON.parse(await readFile(join(summary.runDir,'report.json'),'utf8'));
  assert.deepEqual(report.attempts.map(a=>a.outcome),['failed','passed']);assert(report.gate.violations.some(v=>v.id==='test.retry-recovered'));
  const acquired=(await readFile(join(dir,'acquired.ndjson'),'utf8')).trim().split('\n').map(JSON.parse);
  const cleaned=(await readFile(join(dir,'cleaned.ndjson'),'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(acquired.length,2);assert.equal(cleaned.length,2);assert.notEqual(acquired[0].workerIndex,acquired[1].workerIndex);assert.notEqual(acquired[0].namespace,acquired[1].namespace);assert.notEqual(acquired[0].scope,acquired[1].scope);
  for(const item of acquired)await assert.rejects(stat(item.directory),{code:'ENOENT'});
});

test('native test failure and cleanup failure both remain visible, while earlier resources still close',async t=>{
  const dir=await consumer(t,`test('primary and cleanup failures',{tag:'@release',annotation:forgeId('lifecycle.multiple-failures')},async({forgeFiles,forgeScope})=>{
    appendFileSync('directory.txt',forgeFiles.directory);
    forgeScope.defer({id:'intentional-cleanup-failure',cleanup:async()=>{throw new Error('fixture-cleanup-canary');}});
    throw new Error('fixture-primary-canary');
  });`);
  const execution=await invoke(dir);assert.notEqual(execution.code,0,execution.out+execution.err);
  const summary=JSON.parse(execution.out);const report=JSON.parse(await readFile(join(summary.runDir,'report.json'),'utf8'));
  assert.equal(report.gate.outcome,'fail');
  // Playwright retains both errors in the raw attempt evidence; neither can yield a green gate.
  const journal=await readFile(join(summary.runDir,'attempts.ndjson'),'utf8');
  assert.match(journal,/fixture-primary-canary/);
  assert.match(execution.out+execution.err+journal,/fixture-cleanup-canary|owned-resource cleanups failed/);
  await assert.rejects(stat(await readFile(join(dir,'directory.txt'),'utf8')),{code:'ENOENT'});
});
