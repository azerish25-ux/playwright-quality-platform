import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,readdir,cp,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,relative} from 'node:path';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=process.cwd(),npm=process.env.npm_execpath;
if(!npm)throw new Error('Run this harness using npm run test:consumers.');
const mode=process.argv[2]??'template';if(!['template','teamboard'].includes(mode))throw new Error('Unknown consumer mode.');
const temp=await mkdtemp(join(tmpdir(),'ForgeQA packed Ω ')),artifacts=join(temp,'packages'),evidence=resolve('evidence',`packed-${mode}`);await mkdir(artifacts);await mkdir(evidence,{recursive:true});
const packages=['core','api','test-data','reporter','flake-analysis','playwright','github-action','cli'];
async function run(args,cwd=root,env=process.env){return await new Promise((done,reject)=>{const child=spawn(process.execPath,args,{cwd,env,stdio:['ignore','pipe','pipe']});let out='',err='';const timer=setTimeout(()=>{child.kill();reject(new Error('Consumer command exceeded five minutes.'));},300000);child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('close',code=>{clearTimeout(timer);if(code!==0)reject(new Error(`Command failed (${code}): ${args.slice(1,3).join(' ')}\n${out}\n${err}`));else done(out);});});}
try{
  const specs={},checksums={};
  for(const dir of packages){const metadata=JSON.parse(await readFile(join(root,'packages',dir,'package.json'),'utf8'));const packed=JSON.parse(await run([npm,'pack',`./packages/${dir}`,'--pack-destination',artifacts,'--json','--ignore-scripts']))[0];assert(packed.files.some(f=>f.path==='dist/index.js'));assert(packed.files.some(f=>f.path==='dist/index.d.ts'));assert(!packed.files.some(f=>/(^|\/)(node_modules|\.env|src|test-results|\.auth)(\/|$)/.test(f.path)));const file=join(artifacts,packed.filename);specs[metadata.name]=`file:${file.replace(/\\/g,'/')}`;checksums[packed.filename]=createHash('sha256').update(await readFile(file)).digest('hex');}
  await writeFile(join(evidence,'package-checksums.json'),JSON.stringify(checksums,null,2));
  for(const manager of ['npm','pnpm']){
    const consumer=join(temp,`${mode}-${manager}`);await mkdir(consumer);
    if(mode==='teamboard')await cp(join(root,'examples/demo-saas'),consumer,{recursive:true,filter:src=>!relative(join(root,'examples/demo-saas'),src).split(/[\\/]/).some(p=>['node_modules','dist','forgeqa-results','test-results'].includes(p))});
    else {await run([join(root,'packages/cli/dist/cli.js'),'init','--destination',consumer,'--template','demo','--package-manager',manager,'--json']);}
    const manifest=JSON.parse(await readFile(join(consumer,'package.json'),'utf8'));
    manifest.dependencies={...manifest.dependencies,...specs};for(const name of Object.keys(specs))if(manifest.devDependencies)delete manifest.devDependencies[name];
    manifest.devDependencies={...manifest.devDependencies,'@playwright/test':'1.58.2','typescript':'5.8.3','@types/node':'22.18.6'};manifest.pnpm={overrides:specs};
    await writeFile(join(consumer,'package.json'),JSON.stringify(manifest,null,2));
    const executable=manager==='npm'?npm:join(root,'node_modules/pnpm/bin/pnpm.cjs');
    await run([executable,'install','--ignore-scripts',...(manager==='npm'?['--no-audit','--no-fund']:[])],consumer);
    await run([executable,...(manager==='npm'?['ci','--ignore-scripts','--no-audit','--no-fund']:['install','--frozen-lockfile','--ignore-scripts'])],consumer);
    const require=createRequire(join(consumer,'package.json'));
    const installedCore=await realpath(require.resolve('@azerish25-ux/forgeqa-core'));assert(relative(consumer,installedCore)&&!relative(consumer,installedCore).startsWith('..'),'Public package must resolve inside the independent consumer.');
    const cli=join(require.resolve('@azerish25-ux/forgeqa-cli'),'..','cli.js');
    if(mode==='teamboard'){await run([require.resolve('typescript/bin/tsc'),'--noEmit'],consumer);await run([join(consumer,'build.mjs')],consumer);}else{
      await writeFile(join(consumer,'contract.ts'),"import {test as base,expect} from '@playwright/test';\nimport {createForgeTest} from '@azerish25-ux/forgeqa-playwright';\nconst test=createForgeTest(base).extend<{answer:number}>({answer:42});\ntest('callable composed public interface',async({page,answer,forge})=>{expect(answer).toBe(42);expect(forge.namespace).toBeTruthy();await page.goto('/');});\ntest.describe('native annotations',()=>{});\n");
      await run([require.resolve('typescript/bin/tsc'),'--noEmit','--strict','--skipLibCheck','--module','NodeNext','--moduleResolution','NodeNext','--target','ES2022','contract.ts'],consumer);
    }
    const summary=JSON.parse(await run([cli,'run','--suite','release','--json'],consumer));assert.equal(summary.exitCode,0);assert.equal(summary.tests,mode==='teamboard'?20:2);assert.equal(summary.attempts,summary.tests);
    const report=JSON.parse(await readFile(join(summary.runDir,'report.json'),'utf8'));assert.equal(report.gate.outcome,'pass');assert.equal(report.missingExecutions.length,0);
    await cp(summary.runDir,join(evidence,manager),{recursive:true});await writeFile(join(evidence,`${manager}.json`),JSON.stringify({manager,mode,independentConsumer:true,...summary},null,2));
    if(mode==='template')await run([require.resolve('@playwright/test/cli'),'test'],consumer);
    console.log(JSON.stringify({manager,mode,tests:summary.tests,attempts:summary.attempts,gate:summary.gate.outcome,independentConsumer:true}));
  }
}finally{await rm(temp,{recursive:true,force:true});}
