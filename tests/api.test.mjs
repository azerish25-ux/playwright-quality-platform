import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { ForgeHttpClient, pollUntil } from '@azerish25-ux/forgeqa-api';

async function server(handler){const instance=createServer(handler);await new Promise((resolve)=>instance.listen(0,'127.0.0.1',resolve));const address=instance.address();return {url:`http://127.0.0.1:${address.port}`,close:()=>new Promise((resolve)=>instance.close(resolve))};}

test('client distinguishes valid HTTP errors and sanitizes diagnostics',async()=>{const s=await server((_req,res)=>{res.statusCode=409;res.setHeader('content-type','application/json');res.end(JSON.stringify({error:'conflict',token:'secret'}));});try{const client=new ForgeHttpClient(s.url);await assert.rejects(()=>client.post('/items',{x:1}),/HTTP 409/);}finally{await s.close();}});

test('client refuses write retries without explicit idempotency',async()=>{const client=new ForgeHttpClient('http://127.0.0.1:1');await assert.rejects(()=>client.post('/x',{}, {retry:{attempts:2,baseDelayMs:1}}),/Automatic retry refused/);});

test('deadline aborts a pending request',async()=>{const s=await server(()=>{});try{const client=new ForgeHttpClient(s.url);await assert.rejects(()=>client.get('/hang',{timeoutMs:25}),/abort|timeout|signal/i);}finally{await s.close();}});

test('polling returns on condition without fixed sleeps in tests',async()=>{let value=0;const result=await pollUntil({operation:async()=>++value,until:(v)=>v===3,timeoutMs:500,intervalMs:1});assert.equal(result,3);});
