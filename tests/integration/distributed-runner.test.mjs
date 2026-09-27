import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
const root=fileURLToPath(new URL('../../',import.meta.url));
const cli=resolve(root,'packages/cli/dist/cli.js');
async function invoke(args,cwd){return new Promise((res,rej)=>{const p=spawn(process.execPath,[cli,...args],{cwd,env:{...process.env,CI:'1'},shell:false});let out='',err='';p.stdout.on('data',d=>out+=d);p.stderr.on('data',d=>err+=d);p.on('error',rej);p.on('close',code=>res({code,out,err}));});}
async function json(args,cwd){const result=await invoke([...args,'--json'],cwd);let value;try{value=JSON.parse(result.out);}catch{assert.fail(`Non-JSON output: ${result.out}\n${result.err}`);}return {...result,value};}

test('two native Playwright shards reconcile to one complete inventory',async t=>{
  await mkdir(resolve(root,'.tmp'),{recursive:true});
  const dir=await mkdtemp(resolve(root,'.tmp','distributed Ω '));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  await writeFile(join(dir,'package.json'),JSON.stringify({name:'distributed-consumer',private:true,type:'module'}));
  await writeFile(join(dir,'forgeqa.config.ts'),`import {defineForgeConfig} from '@azerish25-ux/forgeqa-core'; export default defineForgeConfig({project:'distributed-consumer',environments:{local:{baseUrl:'http://127.0.0.1:31999'}},browsers:[],workers:1,retries:0});`);
  await writeFile(join(dir,'playwright.config.ts'),`import {defineForgePlaywrightConfig} from '@azerish25-ux/forgeqa-playwright';import forge from './forgeqa.config';export default defineForgePlaywrightConfig(forge,{testDir:'.',testMatch:'sample.spec.ts',fullyParallel:true,projects:[{name:'api'}]});`);
  await writeFile(join(dir,'sample.spec.ts'),`import {test as base,expect} from '@playwright/test';import {createForgeTest,forgeId} from '@azerish25-ux/forgeqa-playwright';const test=createForgeTest(base);for(let i=1;i<=4;i++)test('case '+i,{tag:'@smoke',annotation:forgeId('distributed.case.'+i)},async()=>{expect(i).toBeGreaterThan(0);});`);
  const plan=await json(['plan','--shard','1/2'],dir);assert.equal(plan.code,0,plan.out+plan.err);assert.equal(plan.value.manifest.expected.length,4);assert.deepEqual(new Set(plan.value.manifest.expected.map(entry=>entry.shardIndex)),new Set([1,2]));
  const first=await json(['run','--shard','1/2','--manifest',plan.value.manifestPath],dir);assert.equal(first.code,0,first.out+first.err);assert.ok(first.value.shardReport);
  const second=await json(['run','--shard','2/2','--manifest',plan.value.manifestPath],dir);assert.equal(second.code,0,second.out+second.err);assert.ok(second.value.shardReport);
  const output=join(dir,'merged');
  const merged=await json(['report','merge','--manifest',plan.value.manifestPath,'--output',output,first.value.shardReport,second.value.shardReport],dir);assert.equal(merged.code,0,merged.out+merged.err);assert.equal(merged.value.completion,'complete');assert.equal(merged.value.tests,4);assert.equal(merged.value.gate.outcome,'pass');
  const report=JSON.parse(await readFile(join(output,'report.json'),'utf8'));assert.equal(report.attempts.length,4);assert.equal(report.missingExecutions.length,0);assert.equal(report.duplicateExecutions.length,0);
});
