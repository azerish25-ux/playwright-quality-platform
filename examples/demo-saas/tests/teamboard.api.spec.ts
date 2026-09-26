import {test,expect,taskFactory,type Tenant} from './fixtures.js';
import {ForgeHttpClient} from '@azerish25-ux/forgeqa-api';
import {randomUUID} from 'node:crypto';
import {forgeId} from '@azerish25-ux/forgeqa-playwright';

test('password authentication, secure session cookies and logout',{tag:'@smoke',annotation:forgeId('tb-session')},async({request,tenant})=>{
  expect((await request.get('/api/me')).status()).toBe(401);
  expect((await request.post('/api/login',{data:{email:tenant.accounts.owner.email,password:'wrong-password'}})).status()).toBe(401);
  const r=await request.post('/api/login',{data:tenant.accounts.owner});expect(r.status()).toBe(200);expect(r.headers()['set-cookie']).toMatch(/HttpOnly/);expect(r.headers()['set-cookie']).toMatch(/SameSite=Strict/);
  expect((await request.get('/api/me')).status()).toBe(200);expect((await request.post('/api/logout',{data:{}})).status()).toBe(200);expect((await request.get('/api/me')).status()).toBe(401);
});
test('owner creation, editor modification and viewer denial use the real database',{tag:'@smoke',annotation:forgeId('tb-roles')},async({tenant,owner,editor,viewer,forge})=>{
  const data=taskFactory.build({seed:'reference-seed',logicalTestId:'tb-roles',namespace:forge.namespace});
  const created=await owner.post(`/api/projects/${tenant.projectId}/tasks`,{data});expect(created.status()).toBe(201);const task=await created.json();
  expect((await editor.patch(`/api/tasks/${task.id}`,{data:{title:'Edited by editor',status:'doing'}})).status()).toBe(200);
  expect((await viewer.patch(`/api/tasks/${task.id}`,{data:{title:'Forbidden change',status:'done'}})).status()).toBe(403);
  expect((await viewer.delete(`/api/tasks/${task.id}`,{data:{}})).status()).toBe(403);
  const observed=await (await viewer.get(`/api/projects/${tenant.projectId}/tasks`)).json();expect(observed.items[0].title).toBe('Edited by editor');expect(observed.items[0].status).toBe('doing');
});
test('cross-tenant access and foreign cleanup proofs are rejected',{tag:'@smoke',annotation:forgeId('tb-isolation')},async({tenant,owner,forge})=>{
  const client=new ForgeHttpClient(forge.config.baseUrl,{'x-forgeqa-token':process.env.TEAMBOARD_TEST_TOKEN??''});const other=(await client.post<Tenant>('/__test/seed',{namespace:`${forge.namespace}-${randomUUID()}`})).data;
  try{expect((await owner.get(`/api/projects/${other.projectId}/tasks`)).status()).toBe(404);await expect(client.post('/__test/cleanup',{namespace:other.namespace,cleanupKey:tenant.cleanupKey})).rejects.toMatchObject({status:403});const observed=await client.post('/__test/cleanup',{namespace:tenant.namespace,cleanupKey:'not-the-owner'}).catch(e=>e);expect(observed.status).toBe(403);}finally{expect((await client.post<{remaining:number}>('/__test/cleanup',{namespace:other.namespace,cleanupKey:other.cleanupKey})).data.remaining).toBe(0);}
});
test('validation, filtering and pagination preserve the actual inventory',{tag:'@regression',annotation:forgeId('tb-filters')},async({tenant,owner})=>{
  const path=`/api/projects/${tenant.projectId}/tasks`;expect((await owner.post(path,{data:{title:'',status:'todo'}})).status()).toBe(400);expect((await owner.post(path,{data:{title:'Invalid',status:'unknown'}})).status()).toBe(400);
  for(let i=0;i<7;i++)expect((await owner.post(path,{data:{title:`Ordered ${i}`,status:i<4?'todo':'done'}})).status()).toBe(201);
  const first=await (await owner.get(path+'?limit=3&offset=0')).json(),second=await (await owner.get(path+'?limit=3&offset=3')).json();expect(first.total).toBe(7);expect(second.items).toHaveLength(3);expect(first.items.map((t:{id:string})=>t.id).some((id:string)=>second.items.some((t:{id:string})=>t.id===id))).toBe(false);
  const done=await(await owner.get(path+'?status=done&q=Ordered')).json();expect(done.total).toBe(3);expect((await owner.get(path+'?limit=100000')).status()).toBe(400);
});
test('tenant flag, bounded attachments, safe names and authenticated downloads',{tag:'@regression',annotation:forgeId('tb-attachments')},async({tenant,owner,editor,viewer,request})=>{
  const task=await(await owner.post(`/api/projects/${tenant.projectId}/tasks`,{data:{title:'Attachment target'}})).json();const path=`/api/tasks/${task.id}/attachments`;
  expect((await owner.post(path,{data:{filename:'note.txt',content:'aGk='}})).status()).toBe(403);
  expect((await editor.patch(`/api/workspaces/${tenant.workspaceId}/settings`,{data:{attachmentsEnabled:true}})).status()).toBe(403);
  expect((await owner.patch(`/api/workspaces/${tenant.workspaceId}/settings`,{data:{attachmentsEnabled:true}})).status()).toBe(200);
  expect((await owner.post(path,{data:{filename:'../escape',content:'aGk='}})).status()).toBe(400);
  expect((await owner.post(path,{data:{filename:'large.txt',content:Buffer.alloc(65537).toString('base64')}})).status()).toBe(413);
  const r=await editor.post(path,{data:{filename:'note.txt',content:Buffer.from('real attachment').toString('base64')}});expect(r.status()).toBe(201);const file=await r.json();expect((await viewer.get(`/api/attachments/${file.id}`)).status()).toBe(200);expect(await(await viewer.get(`/api/attachments/${file.id}`)).text()).toBe('real attachment');expect((await request.get(`/api/attachments/${file.id}`)).status()).toBe(401);
});
test('CSV export quotes values and neutralizes spreadsheet formulas',{tag:'@regression',annotation:forgeId('tb-csv')},async({tenant,owner,viewer})=>{
  await owner.post(`/api/projects/${tenant.projectId}/tasks`,{data:{title:'=HYPERLINK("evil")',status:'todo'}});
  const r=await viewer.get(`/api/projects/${tenant.projectId}/export.csv`);expect(r.status()).toBe(200);expect(r.headers()['content-type']).toContain('text/csv');expect(await r.text()).toContain('"\'=HYPERLINK(""evil"")"');
});
test('test controls require authorization and cross-origin mutations fail',{tag:'@release',annotation:forgeId('tb-control-guards')},async({request,owner,tenant})=>{
  expect((await request.post('/__test/cleanup',{data:{namespace:tenant.namespace,cleanupKey:tenant.cleanupKey}})).status()).toBe(403);
  expect((await owner.post(`/api/projects/${tenant.projectId}/tasks`,{headers:{origin:'https://outside.invalid'},data:{title:'Forbidden'}})).status()).toBe(403);
  expect((await owner.post(`/api/projects/${tenant.projectId}/tasks`,{data:{title:'Still alive'}})).status()).toBe(201);
});
test('memberships can only be modified by an owner',{tag:'@release',annotation:forgeId('tb-membership')},async({tenant,owner,editor,viewer})=>{
  const path=`/api/workspaces/${tenant.workspaceId}/members`;expect((await viewer.get(path)).status()).toBe(200);const data={email:tenant.accounts.viewer.email,role:'editor'};expect((await editor.post(path,{data})).status()).toBe(403);expect((await owner.post(path,{data})).status()).toBe(200);expect((await viewer.post(`/api/projects/${tenant.projectId}/tasks`,{data:{title:'Newly promoted'}})).status()).toBe(201);
});
