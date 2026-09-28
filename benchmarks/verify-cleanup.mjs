import { mkdir, writeFile } from 'node:fs/promises';
import pg from 'pg';
const url = process.env.DATABASE_URL;
if (!url || process.env.TEAMBOARD_TEST_MODE !== '1') throw new Error('Disposable TeamBoard runtime database is required.');
const parsed = new URL(url);
if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || !/^\/forgeqa_test(?:_[-a-z0-9]+)?$/.test(parsed.pathname)) throw new Error('Cleanup verification is limited to the owned local test database.');
const pool = new pg.Pool({ connectionString: url, connectionTimeoutMillis: 5000, query_timeout: 5000 });
const output = 'evidence/benchmarks/supplementary/cleanup';
await mkdir(output, { recursive: true });
let evidence = { status: 'FAIL' };
try {
  const result = await pool.query(`SELECT (SELECT count(*) FROM teamboard_test_runs)::int AS namespaces, (SELECT count(*) FROM workspaces WHERE test_namespace IS NOT NULL)::int AS tenants, (SELECT count(*) FROM users WHERE test_namespace IS NOT NULL)::int AS accounts`);
  evidence = { status: Object.values(result.rows[0]).every(value => value === 0) ? 'PASS' : 'FAIL', remaining: result.rows[0] };
  if (evidence.status !== 'PASS') process.exitCode = 1;
} catch (error) { evidence.failure = error.message; process.exitCode = 1; }
finally { await pool.end(); await writeFile(`${output}/result.json`, JSON.stringify(evidence, null, 2)); console.log(JSON.stringify(evidence)); }
