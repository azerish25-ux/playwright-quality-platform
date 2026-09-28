import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,readdir,cp,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,relative} from 'node:path';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=process.cwd(),npm=process.env.npm_execpath;
if(!npm)throw new Error('Run this harness using npm run test:consumers.');
const mode=process.argv[2]??'template';if(!['template','teamboard','docs'].includes(mode))throw new Error('Unknown consumer mode.');
const temp=await mkdtemp(join(tmpdir(),'ForgeQA packed Ω ')),artifacts=join(temp,'packages'),evidence=resolve('evidence',`packed-${mode}`);await mkdir(artifacts);await mkdir(evidence,{recursive:true});
let docsIdentitySet;
const packages=['core','api','test-data','reporter','flake-analysis','playwright','github-action','cli'];
async function run(args,cwd=root,env=process.env){return await new Promise((done,reject)=>{const child=spawn(process.execPath,args,{cwd,env,stdio:['ignore','pipe','pipe']});let out='',err='';const timer=setTimeout(()=>{child.kill();reject(new Error('Consumer command exceeded five minutes.'));},300000);child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('close',code=>{clearTimeout(timer);if(code!==0)reject(new Error(`Command failed (${code}): ${args.slice(1,3).join(' ')}\n${out}\n${err}`));else done(out);});});}
try{
  const specs={},checksums={};
  for(const dir of packages){const metadata=JSON.parse(await readFile(join(root,'packages',dir,'package.json'),'utf8'));const packed=JSON.parse(await run([npm,'pack',`./packages/${dir}`,'--pack-destination',artifacts,'--json','--ignore-scripts']))[0];assert(packed.files.some(f=>f.path==='dist/index.js'));assert(packed.files.some(f=>f.path==='dist/index.d.ts'));assert(!packed.files.some(f=>/(^|\/)(node_modules|\.env|src|test-results|\.auth)(\/|$)/.test(f.path)));const file=join(artifacts,packed.filename);specs[metadata.name]=`file:${file.replace(/\\/g,'/')}`;checksums[packed.filename]=createHash('sha256').update(await readFile(file)).digest('hex');}
  await writeFile(join(evidence,'package-checksums.json'),JSON.stringify(checksums,null,2));
  for(const manager of ['npm','pnpm']){
    const executable=manager==='npm'?npm:join(root,'node_modules/pnpm/bin/pnpm.cjs');
    let initializer=join(root,'packages/cli/dist/cli.js');
    if(mode==='docs'){
      // Bootstrap through the actual tarballs; provider source cannot satisfy adoption.
      const bootstrap=join(temp,`bootstrap-${manager}`);await mkdir(bootstrap);
      await writeFile(join(bootstrap,'package.json'),JSON.stringify({name:'forgeqa-docs-bootstrap',private:true,type:'module',dependencies:{...specs,'@playwright/test':'1.58.2'},pnpm:{overrides:specs}},null,2));
      await run([executable,'install','--ignore-scripts',...(manager==='npm'?['--no-audit','--no-fund']:[])],bootstrap);
      await cp(join(root,'tests/consumers/public-exports.mjs'),join(bootstrap,'public-exports.mjs'));
      initializer=JSON.parse(await run([join(bootstrap,'public-exports.mjs'),...Object.keys(specs)],bootstrap)).cli;
    }
    const consumer=join(temp,`${mode}-${manager}`);await mkdir(consumer);
    if(mode==='teamboard')await cp(join(root,'examples/demo-saas'),consumer,{recursive:true,filter:src=>!relative(join(root,'examples/demo-saas'),src).split(/[\\/]/).some(p=>['node_modules','dist','forgeqa-results','test-results'].includes(p))});
    else {await run([initializer,'init','--destination',consumer,'--template','demo','--package-manager',manager,'--json']);}
    if(mode==='docs'){
      await cp(join(root,'docs/snippets/forgeqa.config.ts'),join(consumer,'forgeqa.config.ts'));
      await cp(join(root,'docs/snippets/fixtures.ts'),join(consumer,'tests/e2e/fixtures.ts'));
      await cp(join(root,'docs/snippets/public-api.ts'),join(consumer,'public-api.ts'));
    }
    const manifest=JSON.parse(await readFile(join(consumer,'package.json'),'utf8'));
    manifest.dependencies={...manifest.dependencies,...specs};for(const name of Object.keys(specs))if(manifest.devDependencies)delete manifest.devDependencies[name];
    manifest.devDependencies={...manifest.devDependencies,'@playwright/test':'1.58.2','typescript':'5.8.3','@types/node':'22.18.6'};manifest.pnpm={overrides:specs};
    await writeFile(join(consumer,'package.json'),JSON.stringify(manifest,null,2));
    await run([executable,'install','--ignore-scripts',...(manager==='npm'?['--no-audit','--no-fund']:[])],consumer);
    await run([executable,...(manager==='npm'?['ci','--ignore-scripts','--no-audit','--no-fund']:['install','--frozen-lockfile','--ignore-scripts'])],consumer);
    const require=createRequire(join(consumer,'package.json'));
    await cp(join(root,'tests/consumers/public-exports.mjs'),join(consumer,'public-exports.mjs'));
    const resolved=JSON.parse(await run([join(consumer,'public-exports.mjs'),...Object.keys(specs)],consumer));
    assert.equal(Object.keys(resolved.entries).length,packages.length);
    const cli=resolved.cli;
    if(mode==='teamboard'){await run([require.resolve('typescript/bin/tsc'),'--noEmit'],consumer);await run([join(consumer,'build.mjs')],consumer);}else{
      await writeFile(join(consumer,'contract.ts'),"import {test as base,expect} from '@playwright/test';\nimport {createForgeTest} from '@azerish25-ux/forgeqa-playwright';\nconst test=createForgeTest(base).extend<{answer:number}>({answer:42});\ntest('callable composed public interface',async({page,answer,forge})=>{expect(answer).toBe(42);expect(forge.namespace).toBeTruthy();await page.goto('/');});\ntest.describe('native annotations',()=>{});\n");
      await run([require.resolve('typescript/bin/tsc'),'--noEmit','--strict','--skipLibCheck','--module','NodeNext','--moduleResolution','NodeNext','--target','ES2022','contract.ts'],consumer);
    }
    if(mode==='docs'){
      await run([require.resolve('typescript/bin/tsc'),'--noEmit','--strict','--skipLibCheck','--module','NodeNext','--moduleResolution','NodeNext','--target','ES2022','public-api.ts','forgeqa.config.ts','tests/e2e/fixtures.ts'],consumer);
      const doctor=JSON.parse(await run([cli,'doctor','--json'],consumer));assert.equal(doctor.ok,true);
      await run([cli,'plan','--suite','release','--json'],consumer);
    }
    const summary=JSON.parse(await run([cli,'run','--suite','release','--json'],consumer));assert.equal(summary.exitCode,0);assert.equal(summary.tests,mode==='teamboard'?20:2);assert.equal(summary.attempts,summary.tests);
    const report=JSON.parse(await readFile(join(summary.runDir,'report.json'),'utf8'));assert.equal(report.gate.outcome,'pass');assert.equal(report.missingExecutions.length,0);
    assert.equal(report.unexpectedExecutions.length,0);assert.equal(report.duplicateExecutions.length,0);
    if(mode==='docs'){
      const identities=report.attempts.map(a=>`${a.logicalTestId}:${a.project}:${a.environment}`).sort();
      assert(report.attempts.every(a=>a.retry===0&&a.outcome==='passed'));
      if(docsIdentitySet)assert.deepEqual(identities,docsIdentitySet,'Documentation npm/pnpm inventories must match.');
      docsIdentitySet=identities;
    }
    if(mode==='teamboard'){
      // Compare identity sets, not counts: dropping one test and adding another
      // must not make a packed consumer look equivalent to the workspace run.
      const workspace=JSON.parse(await readFile(join(root,'evidence/teamboard-workspace.json'),'utf8'));
      const original=JSON.parse(await readFile(join(workspace.runDir,'report.json'),'utf8'));
      const identities=r=>r.attempts.map(a=>`${a.logicalTestId}:${a.project}:${a.environment}`).sort();
      assert.deepEqual(identities(report),identities(original),'Packed TeamBoard must execute the same identity set as the workspace.');
      assert(report.attempts.every(a=>a.retry===0&&a.outcome==='passed'),'No retry recovery may satisfy first-consumer acceptance.');
      const {default:pg}=await import('pg');const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
      try{
        const {rows}=await pool.query('SELECT (SELECT count(*) FROM teamboard_test_runs)::int AS namespaces,(SELECT count(*) FROM workspaces WHERE test_namespace IS NOT NULL)::int AS tenants,(SELECT count(*) FROM users WHERE test_namespace IS NOT NULL)::int AS accounts');
        assert(Object.values(rows[0]).every(v=>v===0),'Packed consumer leaked run-owned database resources.');
        await writeFile(join(evidence,`${manager}-cleanup.json`),JSON.stringify({cleanup:rows[0],sameInventory:true,executions:report.attempts.length},null,2));
      }finally{await pool.end();}
    }
    await cp(summary.runDir,join(evidence,manager),{recursive:true});await writeFile(join(evidence,`${manager}.json`),JSON.stringify({manager,mode,independentConsumer:true,...summary},null,2));
    if(mode==='template'||mode==='docs')await run([require.resolve('@playwright/test/cli'),'test'],consumer);
    if(mode==='docs')await writeFile(join(evidence,`${manager}-onboarding.json`),JSON.stringify({schemaVersion:1,status:'PASS',sourceSha:process.env.FORGEQA_SOURCE_SHA??null,manager,initializer:'installed-tarball-cli',commands:['init','doctor','plan','run','native'],snippetsCompiled:['forgeqa.config.ts','fixtures.ts','public-api.ts'],identities:docsIdentitySet,publicationClaimed:false},null,2));
    console.log(JSON.stringify({manager,mode,tests:summary.tests,attempts:summary.attempts,gate:summary.gate.outcome,independentConsumer:true}));
  }
}finally{await rm(temp,{recursive:true,force:true});}
