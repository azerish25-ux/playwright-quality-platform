import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as pollDelay } from 'node:timers/promises';
import { createTimingContext } from '../packages/core/dist/timing.js';
const script=fileURLToPath(new URL('../benchmarks/profile-server.mjs',import.meta.url));
async function unusedPort(){const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function exercise(mode){
  const root=await mkdtemp(join(tmpdir(),'forgeqa-profile-http-'));
  let child,appPid,finished=false;
  try{
    await mkdir(join(root,'dist'));await mkdir(join(root,'run'));
    await writeFile(join(root,'package.json'),'{"type":"module"}');
    const port=await unusedPort();
    const source=mode==='startup-failure'?'process.exit(7);':`import {createServer} from 'node:http';import {writeFileSync} from 'node:fs';writeFileSync('app.pid',String(process.pid));const server=createServer((q,r)=>{r.writeHead(q.url==='/ready'?200:404);r.end();});server.listen(${port},'127.0.0.1');process.on('SIGTERM',()=>{server.close(()=>process.exit(0));server.closeIdleConnections();});`;
    await writeFile(join(root,'dist/server.js'),source);
    const context=createTimingContext(join(root,'run/timing'),{sourceSha:'a'.repeat(40),runId:'synthetic-http',shardIndex:1,shardTotal:1});
    child=spawn(process.execPath,[script],{cwd:root,env:{...process.env,FORGEQA_TIMING_CONTEXT:context,TEAMBOARD_ORIGIN:`http://127.0.0.1:${port}`},stdio:['ignore','pipe','pipe']});
    let stderr='';child.stderr.on('data',b=>{stderr=(stderr+b).slice(-8192);});child.stdout.resume();
    const exit=new Promise((accept,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>{finished=true;accept({code,signal});});});
    if(mode!=='startup-failure'){
      let ready=false;
      for(let attempt=0;attempt<100;attempt++){
        try{const record=JSON.parse(await readFile(join(dirname(context),'application.json'),'utf8'));ready=record.spans.some(s=>s.name==='applicationReadiness');}catch{}
        if(ready)break;
        if(finished)throw new Error(`Profile server exited before readiness: ${stderr}`);
        await pollDelay(30);
      }
      assert(ready,'Readiness must be observed within the test budget.');
      appPid=Number(await readFile(join(root,'app.pid'),'utf8'));
      if(mode==='crash')process.kill(appPid,'SIGKILL');else child.kill('SIGTERM');
    }
    const deadline=setTimeout(()=>child.kill('SIGKILL'),7000);
    const result=await exit;clearTimeout(deadline);
    const record=JSON.parse(await readFile(join(dirname(context),'application.json'),'utf8'));
    assert.equal(record.identity.runId,'synthetic-http');
    assert.equal(record.completion,mode==='clean'?'complete':'incomplete');
    assert.equal(result.code,mode==='clean'?0:3,stderr);
    assert.equal(record.spans.some(s=>s.name==='applicationReadiness'),mode!=='startup-failure');
    if(mode==='clean')assert(record.spans.some(s=>s.name==='applicationShutdown'&&s.endMs>=s.startMs));
  }finally{
    if(child&&!finished)child.kill('SIGKILL');
    if(appPid)try{process.kill(-appPid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}
    await rm(root,{recursive:true,force:true});
  }
}
for(const mode of ['clean','startup-failure','crash'])test(`profile server ${mode} uses real owned HTTP processes`,{skip:process.platform==='win32',timeout:15000},()=>exercise(mode));
