import pg from 'pg';
import { DurablePostgresAdapter } from '../../packages/test-data/dist/index.js';
const schema = process.env.FORGEQA_DURABLE_SCHEMA;
if (!/^forgeqa_durable_[0-9a-f]{32}$/.test(schema ?? '')) throw new Error('Invalid owned test schema.');
const connection = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000, statement_timeout: 10000 });
await connection.connect();
await connection.query(`SET search_path TO ${schema}`);
const adapter = new DurablePostgresAdapter(connection, new URL(process.env.DATABASE_URL).pathname.slice(1));
const owner = await adapter.createOwner({ consumer: 'durable-acceptance', namespace: 'lost-runner', runId: 'abandoned' }, 1000);
const tenant = await adapter.provision(owner);
process.send({ owner, tenant });
// The parent hard-kills this process after receiving the resource identity.
// There is no disk journal or clean shutdown to assist the independent reaper.
await new Promise(() => {});
