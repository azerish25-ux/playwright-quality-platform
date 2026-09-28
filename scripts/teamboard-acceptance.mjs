import {spawnSync} from 'node:child_process';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import pg from 'pg';
// The same required acceptance lane also exercises the public PostgreSQL adapter.
await import('./postgres-adapter-acceptance.mjs');
const output=resolve('evidence');await mkdir(output,{recursive:true});
const result=spawnSync(process.execPath,[resolve('packages/cli/dist/cli.js'),'run','--suite','release','--json'],{cwd:'examples/demo-saas',env:process.env,encoding:'utf8',timeout:240000,maxBuffer:5*1024*1024});
if(result.error)throw result.error;
let summary;try{summary=JSON.parse(result.stdout);}catch{throw new Error(`Invalid runner output: ${result.stdout}\n${result.stderr}`);}
await writeFile(resolve(output,'teamboard-workspace.json'),JSON.stringify(summary,null,2));
console.log(JSON.stringify(summary,null,2));
if(result.status!==0)throw new Error(`TeamBoard acceptance failed (${result.status}).`);
if(summary.tests!==20||summary.attempts!==20)throw new Error(`Expected 8 API and 4 UI journeys across three browsers; received ${summary.tests} executions / ${summary.attempts} attempts.`);
const report=JSON.parse(await readFile(resolve(summary.runDir,'report.json'),'utf8'));
const projects=Object.fromEntries(['api','chromium','firefox','webkit'].map(p=>[p,report.attempts.filter(a=>a.project===p).length]));
if(projects.api!==8||projects.chromium!==4||projects.firefox!==4||projects.webkit!==4)throw new Error('Incorrect browser/API inventory.');
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});try{const r=await pool.query('SELECT (SELECT count(*) FROM teamboard_test_runs)::int AS namespaces,(SELECT count(*) FROM workspaces WHERE test_namespace IS NOT NULL)::int AS tenants,(SELECT count(*) FROM users WHERE test_namespace IS NOT NULL)::int AS accounts');if(Object.values(r.rows[0]).some(v=>v!==0))throw new Error('Run-owned database resources leaked.');console.log(JSON.stringify({projects,cleanup:r.rows[0]}));await writeFile(resolve(output,'teamboard-cleanup.json'),JSON.stringify({projects,cleanup:r.rows[0]},null,2));}finally{await pool.end();}
