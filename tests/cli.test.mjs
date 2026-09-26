import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const cli=fileURLToPath(new URL('../packages/cli/dist/cli.js',import.meta.url));
async function run(args,cwd=process.cwd()){return await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[cli,...args],{cwd,env:{...process.env}});let out='',err='';child.stdout.on('data',(d)=>out+=d);child.stderr.on('data',(d)=>err+=d);child.once('error',reject);child.once('exit',(code)=>resolve({code,out,err}));});}

test('help exposes complete command families and exit contract',async()=>{const result=await run(['--help']);assert.equal(result.code,0);for(const command of ['init','doctor','plan','run','repeat','report merge','history import','quarantine add','gate','migrate'])assert.match(result.out,new RegExp(command));assert.match(result.out,/Exit codes/);});

test('init is idempotent and refuses conflicts without overwriting',async()=>{const dir=await mkdtemp(join(tmpdir(),'forgeqa unicode Ω '));let result=await run(['init','--destination',dir,'--json']);assert.equal(result.code,0);const original=await readFile(join(dir,'forgeqa.config.ts'),'utf8');result=await run(['init','--destination',dir,'--json']);assert.equal(result.code,0);await writeFile(join(dir,'forgeqa.config.ts'),'custom');result=await run(['init','--destination',dir,'--json']);assert.equal(result.code,2);assert.equal(await readFile(join(dir,'forgeqa.config.ts'),'utf8'),'custom');assert.notEqual(original,'custom');});

test('init refuses symlink targets',async()=>{if(process.platform==='win32')return;const dir=await mkdtemp(join(tmpdir(),'forgeqa-'));await mkdir(join(dir,'.forgeqa'),{recursive:true});const target=join(dir,'outside');await writeFile(target,'x');const {symlink}=await import('node:fs/promises');await symlink(target,join(dir,'.forgeqa','quarantine.json'));const result=await run(['init','--destination',dir]);assert.equal(result.code,2);assert.match(result.err,/symlink/i);});

test('run fails closed when no native execution command is configured',async()=>{const result=await run(['run','--json']);assert.equal(result.code,3);assert.match(result.out,/not-run/);});
