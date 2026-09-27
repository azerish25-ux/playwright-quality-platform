import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const cli=resolve(root,'packages/cli/dist/cli.js');
const temporary=await mkdtemp(resolve(root,'.tmp/browser-evidence-'));
const evidence=resolve(root,'evidence/browser-distributed');
const forgeConfig=join(temporary,'forgeqa.config.ts');
const playwrightConfig=join(temporary,'playwright.config.ts');
const explicitConfigs=['--config',forgeConfig,'--playwright-config',playwrightConfig];
await rm(evidence,{recursive:true,force:true});
await mkdir(evidence,{recursive:true});

await writeFile(join(temporary,'package.json'),JSON.stringify({name:'browser-evidence-consumer',private:true,type:'module'},null,2));
await writeFile(forgeConfig,`import {defineForgeConfig} from '@azerish25-ux/forgeqa-core';
export default defineForgeConfig({
 project:'browser-evidence-consumer',
 testDir:'./tests',
 baseUrl:'http://127.0.0.1:31999',
 workers:1,
 retries:0,
 suites:{release:{includeTags:['@release']}},
 browsers:['chromium'],
 artifacts:{directory:'./forgeqa-results',trace:'off',screenshot:'off',video:'off'},
 gates:{failOnTestFailure:true,failOnIncomplete:true,maxFlakeRate:0,maxUnexpectedRetries:0,maxQuarantinedTests:0,maxQuarantineAgeDays:1}
});
`);
await writeFile(playwrightConfig,`import {defineConfig} from '@playwright/test';
import {defineForgePlaywrightConfig} from '@azerish25-ux/forgeqa-playwright';
import forge from './forgeqa.config';
export default defineForgePlaywrightConfig(forge,defineConfig({testDir:'./tests',use:{browserName:'chromium'},reporter:[]}));
`);
await mkdir(join(temporary,'tests'),{recursive:true});
await writeFile(join(temporary,'tests','distributed.spec.ts'),`import {test,expect} from '@playwright/test';
for(let index=0;index<4;index++) test('distributed '+index,{tag:'@release'},async({page})=>{await page.setContent('<main data-index="'+index+'">ok</main>');await expect(page.locator('main')).toHaveText('ok');});
`);

try{
  const plan=await invoke(['plan','--suite','release','--shard-total','2','--json',...explicitConfigs],temporary);
  assert.equal(plan.status,0,plan.stderr);
  const planJson=JSON.parse(plan.stdout);
  assert.equal(planJson.shardTotal??planJson.shardCount,2);
  assert.equal(planJson.manifest.expected.length,4);
  const manifest=join(temporary,'manifest.json');
  await writeFile(manifest,JSON.stringify(planJson.manifest,null,2));
  const first=await invoke(['run','--suite','release','--shard','1/2','--manifest',manifest,'--json',...explicitConfigs],temporary);
  const second=await invoke(['run','--suite','release','--shard','2/2','--manifest',manifest,'--json',...explicitConfigs],temporary);
  assert.equal(first.status,0,first.stderr);
  assert.equal(second.status,0,second.stderr);
  const firstJson=JSON.parse(first.stdout);
  const secondJson=JSON.parse(second.stdout);
  const dirs=[firstJson.runDir,secondJson.runDir];
  const bundles=[];
  for(let index=0;index<dirs.length;index++){
    const source=join(dirs[index],'blob-report');
    const destination=join(temporary,`blob-${index+1}`);
    await import('node:fs/promises').then(({cp})=>cp(source,destination,{recursive:true}));
    bundles.push(destination);
  }
  const merge=await invoke(['merge',...bundles,'--expected',manifest,'--output',join(evidence,'merged'),'--mode','merge','--json'],temporary);
  assert.equal(merge.status,0,merge.stderr);
  const summary=JSON.parse(merge.stdout);
  assert.equal(summary.tests,4);
  assert.equal(summary.attempts,4);
  assert.equal(summary.gate.outcome,'pass');
  const report=JSON.parse(await readFile(join(evidence,'merged','report.json'),'utf8'));
  assert.equal(report.attempts.length,4);
  assert.equal(report.missingExecutions.length,0);
  assert.equal(report.unexpectedExecutions.length,0);
  assert.equal(report.duplicateExecutions.length,0);
  assert.deepEqual([...new Set(report.attempts.map(item=>item.project))],['chromium']);
  await writeFile(join(evidence,'summary.json'),JSON.stringify({
    schemaVersion:1,
    status:'PASS',
    browser:'chromium',
    shards:2,
    tests:summary.tests,
    attempts:summary.attempts,
    sourceSha:process.env.FORGEQA_SOURCE_SHA??'local',
    runId:summary.runId
  },null,2)+'\n');
}finally{
  await rm(temporary,{recursive:true,force:true});
}

function isolatedEnvironment(){
  const env={...process.env};
  for(const name of Object.keys(env)){
    if(name.startsWith('FORGEQA_')||name.startsWith('TEAMBOARD_')||name==='PORT') delete env[name];
  }
  env.CI='true';
  return env;
}

function invoke(args,cwd){
  return new Promise((resolvePromise,reject)=>{
    const child=spawn(process.execPath,[cli,...args],{
      cwd,
      env:isolatedEnvironment(),
      stdio:['ignore','pipe','pipe']
    });
    let stdout='';
    let stderr='';
    child.stdout.on('data',chunk=>stdout+=chunk);
    child.stderr.on('data',chunk=>stderr+=chunk);
    child.once('error',reject);
    child.once('close',status=>resolvePromise({status,stdout:stdout.trim(),stderr}));
  });
}
