import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const cli=resolve(root,'packages/cli/dist/cli.js');

async function startServer(reportRoot){
  const child=spawn(process.execPath,[cli,'report','serve','--output',reportRoot,'--json'],{
    cwd:root,
    env:{...process.env,FORGEQA_SERVE_PORT:'0'},
    shell:false,
    stdio:['ignore','pipe','pipe']
  });
  let stdout='',stderr='';
  child.stderr.on('data',chunk=>{stderr+=chunk.toString();});
  const announcement=await new Promise((resolveLine,reject)=>{
    const timer=setTimeout(()=>reject(new Error(`Report server did not start. ${stderr}`)),10_000);
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.stdout.on('data',chunk=>{
      stdout+=chunk.toString();
      const newline=stdout.indexOf('\n');
      if(newline<0)return;
      clearTimeout(timer);
      try{resolveLine(JSON.parse(stdout.slice(0,newline)));}
      catch(error){reject(new Error(`Invalid server announcement: ${stdout}\n${stderr}`,{cause:error}));}
    });
    child.once('exit',code=>{if(code!==null){clearTimeout(timer);reject(new Error(`Report server exited ${code}. ${stdout}\n${stderr}`));}});
  });
  return {child,announcement,stderr:()=>stderr};
}
async function stop(child){
  if(child.exitCode!==null)return;
  const exited=new Promise(resolveExit=>child.once('exit',resolveExit));
  child.kill('SIGTERM');
  const result=await Promise.race([exited,new Promise(resolveTimeout=>setTimeout(()=>resolveTimeout('timeout'),5_000))]);
  if(result==='timeout')child.kill('SIGKILL');
}

test('report serve exposes only owned evidence on loopback with hardened headers',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'forgeqa-serve-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  await mkdir(resolve(dir,'artifacts'),{recursive:true});
  await writeFile(resolve(dir,'index.html'),'<!doctype html><title>Deadpan evidence</title><h1>ready</h1>');
  await writeFile(resolve(dir,'artifacts','proof.txt'),'verified evidence\n');
  const {child,announcement,stderr}=await startServer(dir);
  t.after(()=>stop(child));
  assert.equal(announcement.host,'127.0.0.1');
  assert.equal(announcement.root,await import('node:fs/promises').then(({realpath})=>realpath(dir)));

  const home=await fetch(announcement.url);
  assert.equal(home.status,200);
  assert.match(await home.text(),/Deadpan evidence/);
  assert.equal(home.headers.get('cache-control'),'no-store');
  assert.equal(home.headers.get('x-content-type-options'),'nosniff');
  assert.match(home.headers.get('content-security-policy')??'',/frame-ancestors 'none'/);

  const proof=await fetch(new URL('artifacts/proof.txt',announcement.url));
  assert.equal(proof.status,200);
  assert.equal(await proof.text(),'verified evidence\n');

  const traversal=await fetch(`${announcement.url}%2e%2e%2fpackage.json`);
  assert.equal(traversal.status,400);
  const post=await fetch(announcement.url,{method:'POST'});
  assert.equal(post.status,405);
  assert.equal(post.headers.get('allow'),'GET, HEAD');
  assert.equal(stderr(),'');
});
