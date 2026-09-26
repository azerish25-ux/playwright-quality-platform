import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg, { type PoolClient } from 'pg';

const scrypt = promisify(scryptCallback);
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required. TeamBoard uses real PostgreSQL.');
const database = new URL(databaseUrl);
// This demonstrator is deliberately restricted to disposable laboratory databases.
if (!/^\/forgeqa_test(?:_[a-z0-9_]+)?$/.test(database.pathname)) throw new Error('Refusing a non-laboratory database. Use a forgeqa_test database.');
const pool = new pg.Pool({ connectionString: databaseUrl, max: 12, statement_timeout: 5000, connectionTimeoutMillis: 5000 });
const port = Number(process.env.PORT ?? 3199);
const origin = process.env.TEAMBOARD_ORIGIN ?? `http://127.0.0.1:${port}`;
const testMode = process.env.TEAMBOARD_TEST_MODE === '1' && process.env.NODE_ENV !== 'production';
const testToken = process.env.TEAMBOARD_TEST_TOKEN ?? '';
if (testMode && testToken.length < 32) throw new Error('Test mode requires a disposable token of at least 32 characters.');
const publicDir = resolve('dist/public');
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const id = () => randomUUID();
const secret = () => randomBytes(32).toString('hex');
function equal(a: string, b: string): boolean { const aa = Buffer.from(a), bb = Buffer.from(b); return aa.length === bb.length && timingSafeEqual(aa, bb); }
class HttpError extends Error { constructor(readonly status: number, message: string) { super(message); } }
function text(value: unknown, name: string, max = 120): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new HttpError(400, `${name} must contain 1–${max} characters.`);
  return value.trim();
}
function identifier(value: string | undefined): string { if (!value || !/^[0-9a-f-]{36}$/.test(value)) throw new HttpError(400, 'Invalid resource identifier.'); return value; }
async function passwordHash(password: string): Promise<string> { const salt = secret(); const hash = await scrypt(password, salt, 64) as Buffer; return `${salt}:${hash.toString('hex')}`; }
async function passwordMatches(password: string, stored: string): Promise<boolean> { const [salt, hash] = stored.split(':'); return !!salt && !!hash && equal((await scrypt(password, salt, 64) as Buffer).toString('hex'), hash); }
async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> { const c = await pool.connect(); try { await c.query('BEGIN'); const result = await fn(c); await c.query('COMMIT'); return result; } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); } }
async function migrate(): Promise<void> {
  await transaction(async c => {
    await c.query('SELECT pg_advisory_xact_lock(73193219)');
    await c.query('CREATE TABLE IF NOT EXISTS teamboard_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    for (const file of ['001_initial.sql', '002-consumer.sql']) {
      const exists = await c.query('SELECT version FROM teamboard_migrations WHERE version=$1', [file]);
      if (!exists.rowCount) { await c.query(await readFile(resolve('db', file), 'utf8')); await c.query('INSERT INTO teamboard_migrations(version) VALUES($1)', [file]); }
    }
  });
}
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []; let length = 0;
  for await (const chunk of req) { length += chunk.length; if (length > 100_000) throw new HttpError(413, 'Request exceeds the 100 KB limit.'); chunks.push(chunk); }
  try { const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value as Record<string, unknown>; } catch { throw new HttpError(400, 'A JSON object is required.'); }
}
function json(res: ServerResponse, status: number, value: unknown): void { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); }
function sessionCookie(req: IncomingMessage): string {
  const raw = (req.headers.cookie ?? '').split(';').find(v => v.trim().startsWith('teamboard_session='))?.trim().slice('teamboard_session='.length) ?? '';
  return /^[a-f0-9]{64}$/.test(raw) ? raw : '';
}
interface User { id: string; email: string; }
async function user(req: IncomingMessage): Promise<User> { const token = sessionCookie(req); const result = await pool.query('SELECT u.id,u.email FROM teamboard_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()', [digest(token)]); if (!result.rowCount) throw new HttpError(401, 'Sign in to continue.'); return result.rows[0] as User; }
async function membership(userId: string, workspaceId: string, write = false, ownerOnly = false): Promise<string> {
  const result = await pool.query('SELECT role FROM memberships WHERE user_id=$1 AND workspace_id=$2', [userId, workspaceId]);
  if (!result.rowCount) throw new HttpError(404, 'Workspace not found.'); const role = result.rows[0].role as string;
  if ((write && role === 'viewer') || (ownerOnly && role !== 'owner')) throw new HttpError(403, 'Your role does not permit this operation.'); return role;
}
async function project(userId: string, projectId: string, write = false): Promise<{ id: string; workspace_id: string; name: string }> { const r = await pool.query('SELECT id,workspace_id,name FROM projects WHERE id=$1', [projectId]); if (!r.rowCount) throw new HttpError(404, 'Project not found.'); await membership(userId, r.rows[0].workspace_id, write); return r.rows[0]; }
async function task(userId: string, taskId: string, write = false): Promise<{id: string;project_id: string;title: string}> { const r = await pool.query('SELECT * FROM tasks WHERE id=$1', [taskId]); if (!r.rowCount) throw new HttpError(404, 'Task not found.'); await project(userId, r.rows[0].project_id, write); return r.rows[0]; }
function validateTask(b: Record<string, unknown>): {title: string;status: string;dueAt: string | null} { const title = text(b.title, 'Title', 200); const status = b.status ?? 'todo'; if (!['todo','doing','done'].includes(String(status))) throw new HttpError(400, 'Unknown task status.'); const dueAt = b.dueAt == null || b.dueAt === '' ? null : String(b.dueAt); if (dueAt && !Number.isFinite(Date.parse(dueAt))) throw new HttpError(400, 'Invalid due date.'); return {title,status:String(status),dueAt}; }
function requireTest(req: IncomingMessage): void { if (!testMode) throw new HttpError(404, 'Not found.'); if (!equal(String(req.headers['x-forgeqa-token'] ?? ''), testToken)) throw new HttpError(403, 'Test authorization required.'); }

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', origin); const parts = url.pathname.split('/').filter(Boolean); const method = req.method ?? 'GET';
  if (!['GET','HEAD','OPTIONS'].includes(method)) { const requestOrigin = req.headers.origin; if (requestOrigin && requestOrigin !== origin) throw new HttpError(403, 'Cross-origin mutation refused.'); if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) throw new HttpError(415, 'Use application/json.'); }
  if (url.pathname === '/health') return json(res, 200, {status:'alive'});
  if (url.pathname === '/ready') { await pool.query('SELECT 1'); return json(res, 200, {status:'ready',database:'postgresql'}); }
  if (parts[0] === '__test') {
    requireTest(req);
    if (method === 'POST' && parts[1] === 'seed') {
      const b = await body(req); const namespace = text(b.namespace, 'Namespace', 120); if (!/^fq-[a-zA-Z0-9_-]{8,116}$/.test(namespace)) throw new HttpError(400,'Invalid owned namespace.');
      const cleanupKey = secret(), password = secret(); const hash = await passwordHash(password);
      const result = await transaction(async c => {
        await c.query('INSERT INTO teamboard_test_runs(namespace,cleanup_hash) VALUES($1,$2)', [namespace,digest(cleanupKey)]);
        const workspaceId = id(); await c.query('INSERT INTO workspaces(id,name,test_namespace) VALUES($1,$2,$3)', [workspaceId,`Team ${namespace}`,namespace]);
        const accounts: Record<string, {email:string;password:string;id:string}> = {};
        for (const role of ['owner','editor','viewer']) { const uid=id(), email=`${role}.${namespace}@example.test`; await c.query('INSERT INTO users(id,email,password_hash,test_namespace) VALUES($1,$2,$3,$4)',[uid,email,hash,namespace]); await c.query('INSERT INTO memberships(workspace_id,user_id,role) VALUES($1,$2,$3)',[workspaceId,uid,role]); accounts[role]={id:uid,email,password}; }
        const projectId=id(); await c.query('INSERT INTO projects(id,workspace_id,name) VALUES($1,$2,$3)',[projectId,workspaceId,'Reliability board']);
        return {workspaceId,projectId,accounts};
      });
      return json(res,201,{namespace,cleanupKey,...result});
    }
    if (method === 'POST' && parts[1] === 'cleanup') {
      const b = await body(req); const namespace=text(b.namespace,'Namespace'), key=text(b.cleanupKey,'Cleanup key');
      await transaction(async c => { const r=await c.query('SELECT cleanup_hash FROM teamboard_test_runs WHERE namespace=$1 FOR UPDATE',[namespace]); if (!r.rowCount) return; if (!equal(digest(key),r.rows[0].cleanup_hash)) throw new HttpError(403,'Ownership proof does not match this namespace.'); await c.query('DELETE FROM workspaces WHERE test_namespace=$1',[namespace]); await c.query('DELETE FROM users WHERE test_namespace=$1',[namespace]); await c.query('DELETE FROM teamboard_test_runs WHERE namespace=$1',[namespace]); });
      const remaining=await pool.query('SELECT (SELECT count(*) FROM workspaces WHERE test_namespace=$1)::int+(SELECT count(*) FROM users WHERE test_namespace=$1)::int AS count',[namespace]);
      return json(res,200,{remaining:remaining.rows[0].count});
    }
    throw new HttpError(404,'Not found.');
  }
  if (url.pathname === '/api/login' && method === 'POST') {
    const b=await body(req); const email=text(b.email,'Email',254).toLowerCase(), password=text(b.password,'Password',200);
    // Bounded in-memory throttling protects the demonstration without an unbounded IP map.
    const bucket=`${req.socket.remoteAddress}:${email}`; const previous=loginAttempts.get(bucket); const now=Date.now();
    if (previous && previous.until>now && previous.count>=20) throw new HttpError(429,'Too many login attempts. Try again later.');
    if (loginAttempts.size>1000) loginAttempts.clear(); loginAttempts.set(bucket,{until:now+60_000,count:previous && previous.until>now ? previous.count+1:1});
    const r=await pool.query('SELECT id,email,password_hash FROM users WHERE email=$1',[email]);
    if (!r.rowCount || !await passwordMatches(password,r.rows[0].password_hash)) throw new HttpError(401,'Invalid email or password.');
    loginAttempts.delete(bucket); const token=secret(); await pool.query('INSERT INTO teamboard_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval \'8 hours\')',[digest(token),r.rows[0].id]);
    res.setHeader('set-cookie',`teamboard_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800${origin.startsWith('https:')?'; Secure':''}`); return json(res,200,{id:r.rows[0].id,email:r.rows[0].email});
  }
  if (url.pathname === '/api/register' && method === 'POST') {
    const b=await body(req), email=text(b.email,'Email',254).toLowerCase(), password=text(b.password,'Password',200), name=text(b.workspace,'Workspace');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length<12) throw new HttpError(400,'Use a valid email and a password of at least 12 characters.');
    const hash=await passwordHash(password); await transaction(async c=>{const uid=id(),wid=id();await c.query('INSERT INTO users(id,email,password_hash) VALUES($1,$2,$3)',[uid,email,hash]);await c.query('INSERT INTO workspaces(id,name) VALUES($1,$2)',[wid,name]);await c.query('INSERT INTO memberships(workspace_id,user_id,role) VALUES($1,$2,\'owner\')',[wid,uid]);});return json(res,201,{created:true});
  }
  if (parts[0] === 'api') {
    const current=await user(req);
    if (url.pathname==='/api/logout' && method==='POST') {await pool.query('DELETE FROM teamboard_sessions WHERE token_hash=$1',[digest(sessionCookie(req))]);res.setHeader('set-cookie','teamboard_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');return json(res,200,{loggedOut:true});}
    if (url.pathname==='/api/me') return json(res,200,current);
    if (url.pathname==='/api/workspaces' && method==='GET') return json(res,200,(await pool.query('SELECT w.id,w.name,w.attachments_enabled,m.role FROM workspaces w JOIN memberships m ON m.workspace_id=w.id WHERE m.user_id=$1 ORDER BY w.name',[current.id])).rows);
    if (parts[1]==='workspaces' && parts[2]) {
      const wid=identifier(parts[2]); await membership(current.id,wid);
      if (parts[3]==='projects') {
        if(method==='GET') return json(res,200,(await pool.query('SELECT id,name FROM projects WHERE workspace_id=$1 ORDER BY created_at,id',[wid])).rows);
        if(method==='POST') {await membership(current.id,wid,true);const b=await body(req),pid=id();await pool.query('INSERT INTO projects(id,workspace_id,name) VALUES($1,$2,$3)',[pid,wid,text(b.name,'Project name')]);return json(res,201,{id:pid,name:b.name});}
      }
      if (parts[3]==='members') {
        if(method==='GET') return json(res,200,(await pool.query('SELECT u.email,m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=$1 ORDER BY u.email',[wid])).rows);
        if(method==='POST') {await membership(current.id,wid,true,true);const b=await body(req);if(!['editor','viewer'].includes(String(b.role)))throw new HttpError(400,'Members can be invited as editor or viewer.');const email=text(b.email,'Email',254).toLowerCase();const r=await pool.query('INSERT INTO memberships(workspace_id,user_id,role) SELECT $1,id,$2 FROM users WHERE email=$3 ON CONFLICT(workspace_id,user_id) DO UPDATE SET role=EXCLUDED.role WHERE memberships.role<>\'owner\' RETURNING user_id',[wid,b.role,email]);if(!r.rowCount)throw new HttpError(400,'User does not exist or is an owner.');return json(res,200,{updated:true});}
      }
      if (parts[3]==='settings' && method==='PATCH') {await membership(current.id,wid,true,true);const b=await body(req);if(typeof b.attachmentsEnabled!=='boolean')throw new HttpError(400,'attachmentsEnabled must be boolean.');await pool.query('UPDATE workspaces SET attachments_enabled=$2 WHERE id=$1',[wid,b.attachmentsEnabled]);return json(res,200,{attachmentsEnabled:b.attachmentsEnabled});}
    }
    if (parts[1]==='projects' && parts[2]) {
      const pid=identifier(parts[2]);await project(current.id,pid);
      if(parts[3]==='tasks') {
        if(method==='GET') {const limit=Number(url.searchParams.get('limit')??10),offset=Number(url.searchParams.get('offset')??0),status=url.searchParams.get('status')??'',q=url.searchParams.get('q')??'';if(!Number.isInteger(limit)||limit<1||limit>50||!Number.isInteger(offset)||offset<0||offset>10000||q.length>200||!['','todo','doing','done'].includes(status))throw new HttpError(400,'Invalid pagination or filters.');const args=[pid,status,`%${q.replace(/[\\%_]/g,'\\$&')}%`];const where='project_id=$1 AND ($2=\'\' OR status=$2) AND title ILIKE $3';const r=await pool.query(`SELECT * FROM tasks WHERE ${where} ORDER BY created_at,id LIMIT $4 OFFSET $5`,[...args,limit,offset]);const total=await pool.query(`SELECT count(*)::int AS total FROM tasks WHERE ${where}`,args);return json(res,200,{items:r.rows,total:total.rows[0].total,limit,offset});}
        if(method==='POST') {await project(current.id,pid,true);const b=validateTask(await body(req)),tid=id();const r=await pool.query('INSERT INTO tasks(id,project_id,title,status,due_at) VALUES($1,$2,$3,$4,$5) RETURNING *',[tid,pid,b.title,b.status,b.dueAt]);return json(res,201,r.rows[0]);}
      }
      if(parts[3]==='export.csv' && method==='GET') {const r=await pool.query('SELECT title,status,due_at FROM tasks WHERE project_id=$1 ORDER BY created_at,id LIMIT 10000',[pid]);const cell=(v:unknown)=>`"${String(v??'').replace(/^[=+\-@\t\r]/,'\'$&').replace(/"/g,'""')}"`;res.writeHead(200,{'content-type':'text/csv; charset=utf-8','content-disposition':'attachment; filename="tasks.csv"'});res.end('title,status,due_at\r\n'+r.rows.map(t=>[t.title,t.status,t.due_at?.toISOString()??''].map(cell).join(',')).join('\r\n'));return;}
    }
    if(parts[1]==='tasks'&&parts[2]) {
      const tid=identifier(parts[2]),existing=await task(current.id,tid,method!=='GET');
      if(parts.length===3&&method==='PATCH'){const b=validateTask(await body(req));const r=await pool.query('UPDATE tasks SET title=$2,status=$3,due_at=$4 WHERE id=$1 RETURNING *',[tid,b.title,b.status,b.dueAt]);return json(res,200,r.rows[0]);}
      if(parts.length===3&&method==='DELETE'){await pool.query('DELETE FROM tasks WHERE id=$1',[tid]);return json(res,200,{deleted:true});}
      if(parts[3]==='attachments'){
        const p=await project(current.id,existing.project_id);const flag=await pool.query('SELECT attachments_enabled FROM workspaces WHERE id=$1',[p.workspace_id]);if(!flag.rows[0].attachments_enabled)throw new HttpError(403,'Attachments are disabled for this workspace.');
        if(method==='GET')return json(res,200,(await pool.query('SELECT id,filename,octet_length(content) AS size FROM teamboard_attachments WHERE task_id=$1',[tid])).rows);
        if(method==='POST'){const b=await body(req),filename=text(b.filename,'Filename',80);if(!/^[\w .-]+$/.test(filename)||filename.includes('..')||filename.startsWith('.'))throw new HttpError(400,'Unsafe filename.');const encoded=text(b.content,'Base64 content',90_000);if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))throw new HttpError(400,'Invalid base64.');const bytes=Buffer.from(encoded,'base64');if(bytes.length>65536)throw new HttpError(413,'Attachment limit is 64 KB.');const aid=id();await pool.query('INSERT INTO teamboard_attachments(id,task_id,filename,content) VALUES($1,$2,$3,$4)',[aid,tid,filename,bytes]);return json(res,201,{id:aid,filename,size:bytes.length});}
      }
    }
    if(parts[1]==='attachments'&&parts[2]&&method==='GET'){const r=await pool.query('SELECT * FROM teamboard_attachments WHERE id=$1',[identifier(parts[2])]);if(!r.rowCount)throw new HttpError(404,'Attachment not found.');await task(current.id,r.rows[0].task_id);res.writeHead(200,{'content-type':'application/octet-stream','content-disposition':`attachment; filename="${r.rows[0].filename}"`});res.end(r.rows[0].content);return;}
    throw new HttpError(404,'Not found.');
  }
  if (method==='GET' && ['/', '/app.js','/app.css'].includes(url.pathname)) { const name=url.pathname==='/'?'index.html':url.pathname.slice(1);res.writeHead(200,{'content-type':name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html; charset=utf-8'});res.end(await readFile(resolve(publicDir,name)));return; }
  throw new HttpError(404,'Not found.');
}
const loginAttempts=new Map<string,{until:number;count:number}>();
if(process.argv.includes('--migrate')){await migrate();await pool.end();process.exit(0);}
const schema=await pool.query("SELECT version FROM teamboard_migrations WHERE version='002-consumer.sql'");
if(!schema.rowCount)throw new Error('Run the explicit schema migration command before starting TeamBoard.');
const server=createServer((req,res)=>{
  const correlationId=randomUUID();res.setHeader('x-correlation-id',correlationId);res.setHeader('x-content-type-options','nosniff');res.setHeader('referrer-policy','no-referrer');res.setHeader('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  route(req,res).catch((error:unknown)=>{const code=(error as {code?:string})?.code;const status=error instanceof HttpError?error.status:code==='23505'?409:500;const message=error instanceof HttpError?error.message:status===409?'Resource already exists.':'The operation could not be completed.';if(!res.headersSent)json(res,status,{error:message,correlationId});else res.end();if(status===500)console.error(JSON.stringify({level:'error',event:'request_failed',correlationId,code:code??'internal'}));});
});
server.requestTimeout=10_000;server.headersTimeout=10_000;
server.listen(port,process.env.HOST??'127.0.0.1',()=>console.log(JSON.stringify({event:'ready',port,database:'postgresql'})));
let closing=false;
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{if(closing)return;closing=true;server.close(()=>{void pool.end().then(()=>process.exit(0));});server.closeIdleConnections();setTimeout(()=>process.exit(1),5000).unref();});
