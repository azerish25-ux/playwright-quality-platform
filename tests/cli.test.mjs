import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const cli=fileURLToPath(new URL('../packages/cli/dist/cli.js',import.meta.url));
async function runEntrypoint(entrypoint,args,cwd=process.cwd()){return await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[entrypoint,...args],{cwd,env:{...process.env}});let out='',err='';child.stdout.on('data',(d)=>out+=d);child.stderr.on('data',(d)=>err+=d);child.once('error',reject);child.once('exit',(code)=>resolve({code,out,err}));});}
async function run(args,cwd=process.cwd()){return runEntrypoint(cli,args,cwd);}

test('help exposes complete command families and exit contract',async()=>{const result=await run(['--help']);assert.equal(result.code,0);for(const command of ['init','doctor','plan','run','repeat','report merge','history import','quarantine add','gate','migrate'])assert.match(result.out,new RegExp(command));assert.match(result.out,/Exit codes/);});

test('the CLI executes through a package-manager-style symlink',{skip:process.platform==='win32'},async()=>{const {symlink,rm}=await import('node:fs/promises');const dir=await mkdtemp(join(tmpdir(),'forgeqa-bin-'));try{const shim=join(dir,'forgeqa');await symlink(cli,shim);const result=await runEntrypoint(shim,['--help'],dir);assert.equal(result.code,0,result.out+result.err);assert.match(result.out,/ForgeQA 0\.1\.0/);assert.match(result.out,/Exit codes/);}finally{await rm(dir,{recursive:true,force:true});}});

test('init is idempotent and refuses conflicts without overwriting',async()=>{const dir=await mkdtemp(join(tmpdir(),'forgeqa unicode Ω '));let result=await run(['init','--destination',dir,'--json']);assert.equal(result.code,0);const original=await readFile(join(dir,'forgeqa.config.ts'),'utf8');result=await run(['init','--destination',dir,'--json']);assert.equal(result.code,0);await writeFile(join(dir,'forgeqa.config.ts'),'custom');result=await run(['init','--destination',dir,'--json']);assert.equal(result.code,2);assert.equal(await readFile(join(dir,'forgeqa.config.ts'),'utf8'),'custom');assert.notEqual(original,'custom');});

test('init refuses symlink targets',async()=>{if(process.platform==='win32')return;const dir=await mkdtemp(join(tmpdir(),'forgeqa-'));await mkdir(join(dir,'.forgeqa'),{recursive:true});const target=join(dir,'outside');await writeFile(target,'x');const {symlink}=await import('node:fs/promises');await symlink(target,join(dir,'.forgeqa','quarantine.json'));const result=await run(['init','--destination',dir]);assert.equal(result.code,2);assert.match(result.err,/symlink/i);});

test('run fails closed when configuration is missing',async()=>{const result=await run(['run','--json']);assert.equal(result.code,2);assert.match(result.out,/Missing ForgeQA configuration/);});

test('dry-run does not create the destination',async()=>{const {existsSync}=await import('node:fs');const root=await mkdtemp(join(tmpdir(),'forgeqa-dry-'));const destination=join(root,'not-created');const r=await run(['init','--destination',destination,'--dry-run','--json']);assert.equal(r.code,0);assert.equal(existsSync(destination),false);});
test('all conflicts are detected before any new file is written',async()=>{const {existsSync}=await import('node:fs');const dir=await mkdtemp(join(tmpdir(),'forgeqa-conflict-'));await writeFile(join(dir,'FORGEQA.md'),'existing guide');const r=await run(['init','--destination',dir,'--json']);assert.equal(r.code,2);assert.equal(existsSync(join(dir,'package.json')),false);assert.equal(await readFile(join(dir,'FORGEQA.md'),'utf8'),'existing guide');});
test('symlinked parent directory cannot receive template writes',{skip:process.platform==='win32'},async()=>{const {symlink,rm}=await import('node:fs/promises');const outside=await mkdtemp(join(tmpdir(),'forgeqa-outside-'));const dir=await mkdtemp(join(tmpdir(),'forgeqa-parent-'));try{await symlink(outside,join(dir,'tests'));const r=await run(['init','--destination',dir,'--json']);assert.equal(r.code,2);assert.match(r.out,/symlink/i);const {readdir}=await import('node:fs/promises');assert.deepEqual(await readdir(outside),[]);}finally{await rm(dir,{recursive:true,force:true});await rm(outside,{recursive:true,force:true});}});


test('parent aliases are canonicalized without accepting destination symlinks',{skip:process.platform==='win32'},async()=>{
  const {symlink,realpath,rm,access}=await import('node:fs/promises');
  const root=await mkdtemp(join(tmpdir(),'forgeqa-alias-'));
  try{
    const target=join(root,'real');await mkdir(target);
    const alias=join(root,'alias');await symlink(target,alias);
    const destination=join(alias,'nested','consumer Ω');
    let result=await run(['init','--destination',destination,'--dry-run','--json']);
    assert.equal(result.code,0,result.out+result.err);
    await assert.rejects(access(join(target,'nested')),{code:'ENOENT'});
    result=await run(['init','--destination',destination,'--json']);
    assert.equal(result.code,0,result.out+result.err);
    assert.equal(JSON.parse(result.out).destination,join(await realpath(target),'nested','consumer Ω'));
    result=await run(['init','--destination',destination,'--json']);
    assert.equal(result.code,0,result.out+result.err);
    assert(JSON.parse(result.out).files.every(file=>file.action==='unchanged'));
    result=await run(['init','--destination',alias,'--json']);
    assert.equal(result.code,2);assert.match(result.out,/symlink/i);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('dangling parent symlinks are rejected before template writes',{skip:process.platform==='win32'},async()=>{
  const {symlink,rm,access}=await import('node:fs/promises');
  const root=await mkdtemp(join(tmpdir(),'forgeqa-dangling-'));
  try{
    const target=join(root,'missing');await symlink(target,join(root,'alias'));
    const result=await run(['init','--destination',join(root,'alias','consumer'),'--json']);
    assert.equal(result.code,2);assert.match(result.out,/symlink/i);
    await assert.rejects(access(target),{code:'ENOENT'});
  }finally{await rm(root,{recursive:true,force:true});}
});


test('pnpm templates pin the audited installer consistently',async()=>{
  const {rm}=await import('node:fs/promises');
  const dir=await mkdtemp(join(tmpdir(),'forgeqa-pnpm-'));
  try{
    const result=await run(['init','--destination',dir,'--package-manager','pnpm','--json']);
    assert.equal(result.code,0,result.out+result.err);
    const manifest=JSON.parse(await readFile(join(dir,'package.json'),'utf8'));
    assert.equal(manifest.packageManager,'pnpm@10.34.5');
    const workflow=await readFile(join(dir,'.github/workflows/forgeqa.yml'),'utf8');
    assert(workflow.includes('pnpm@10.34.5'));
    assert(!workflow.includes('pnpm@10.17.1'));
  }finally{await rm(dir,{recursive:true,force:true});}
});
