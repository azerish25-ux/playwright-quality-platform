import pg from 'pg';
import {randomBytes} from 'node:crypto';
import {appendFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const admin=process.env.DATABASE_ADMIN_URL;
if(process.env.FORGEQA_ALLOW_DB_SETUP!=='1'||!admin||!process.env.GITHUB_ENV)throw new Error('This runner-only setup requires explicit authorization and a GitHub environment file.');
const url=new URL(admin);if(!/^\/forgeqa_test(?:_[a-z0-9_]+)?$/.test(url.pathname))throw new Error('Refusing a non-laboratory database.');
const pool=new pg.Pool({connectionString:admin});const ownerPassword=randomBytes(32).toString('hex'),runtimePassword=randomBytes(32).toString('hex'),testToken=randomBytes(32).toString('hex');
for(const secret of [ownerPassword,runtimePassword,testToken])console.log(`::add-mask::${secret}`);
try{
  await pool.query(`CREATE ROLE teamboard_owner LOGIN PASSWORD '${ownerPassword}'`);
  await pool.query(`CREATE ROLE teamboard_runtime LOGIN PASSWORD '${runtimePassword}'`);
  await pool.query('GRANT USAGE, CREATE ON SCHEMA public TO teamboard_owner');
  url.username='teamboard_owner';url.password=ownerPassword;
  const migrationEnv={...process.env,DATABASE_URL:url.href};for(const key of ['DATABASE_ADMIN_URL','GITHUB_TOKEN','GH_TOKEN','NODE_AUTH_TOKEN','NPM_TOKEN'])delete migrationEnv[key];
  const result=spawnSync(process.execPath,['dist/server.js','--migrate'],{cwd:'examples/demo-saas',env:migrationEnv,stdio:'inherit',timeout:30000});if(result.status!==0)throw new Error('Schema migrations failed.');
  await pool.query('GRANT USAGE ON SCHEMA public TO teamboard_runtime');
  await pool.query('GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO teamboard_runtime');
  await pool.query('REVOKE INSERT,UPDATE,DELETE ON teamboard_migrations FROM teamboard_runtime');
  url.username='teamboard_runtime';url.password=runtimePassword;
  const runtime=new pg.Pool({connectionString:url.href});try{const r=await runtime.query("SELECT current_user,has_schema_privilege(current_user,'public','CREATE') AS can_create,has_table_privilege(current_user,'teamboard_migrations','UPDATE') AS can_alter_history");if(r.rows[0].can_create||r.rows[0].can_alter_history)throw new Error('Runtime role is overprivileged.');console.log(JSON.stringify({database:'postgresql',runtime:r.rows[0].current_user,canCreateSchema:false,canAlterMigrationHistory:false}));}finally{await runtime.end();}
  // Only runtime credentials reach application/testing steps; no write-capable GitHub credentials do.
  console.log(`::add-mask::${runtimePassword}`);
  await appendFile(process.env.GITHUB_ENV,`DATABASE_URL=${url.href}\nTEAMBOARD_TEST_MODE=1\nTEAMBOARD_TEST_TOKEN=${testToken}\n`);
}finally{await pool.end();}
