import test from 'node:test';
import assert from 'node:assert/strict';
import { stat, lstat, readFile, writeFile, readdir, mkdtemp, rm, rename, symlink, link } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { ResourceScope, withResourceScope, runBounded, ownResource } from '@azerish25-ux/forgeqa-core';
import { CleanupRegistry } from '@azerish25-ux/forgeqa-test-data';
// Direct package-module imports also allow focused source verification without a browser runtime.
// Installed public exports and native fixtures are verified separately by the packed consumer lane.
import { AuthenticationManager, withAuthentication, authenticationKey } from '../packages/playwright/dist/authentication.js';
import { OwnedFiles } from '../packages/playwright/dist/owned-files.js';
import { withFeatureFlags, withNetworkRoutes, withClockPage } from '../packages/playwright/dist/overrides.js';

const identity = (changes = {}) => ({ application: 'demo', environment: 'local', role: 'owner', project: 'api',
  configHash: 'configuration-v1', namespace: 'owned-tenant', runId: 'run-1', shard: 1, parallelIndex: 0, workerIndex: 0, ...changes });
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
function adapterFixture(options={}) {
  const state={created:0,disposed:[],validated:0,valid:true};
  const adapter={ id:'demo-auth',
    async authenticate(id,scope) { const session={id:++state.created,role:id.role}; scope.defer({id:'session',cleanup:async()=>{state.disposed.push(session.id);}}); return session; },
    async validate(session,id) {state.validated++;return state.valid&&session.role===id.role;},
    ...(options.storage?{storageState:async()=>({cookies:[{name:'secret-cookie',value:'credential-canary',domain:'localhost',path:'/',expires:-1,httpOnly:true,secure:false,sameSite:'Strict'}],origins:[]})}:{}) };
  return {state,adapter};
}
const flatten = error => error instanceof AggregateError ? error.errors.flatMap(flatten) : [error];

test('bounded operations preserve values/errors and reject invalid budgets before execution',async()=>{
  assert.equal(await runBounded(async()=>42,100),42);
  const primary=new Error('primary'); await assert.rejects(runBounded(async()=>{throw primary;},100),e=>e===primary);
  for(const value of [0,-1,Infinity,1.5,2**32])await assert.rejects(runBounded(async()=>assert.fail(),value),RangeError);
});
test('bounded operations honor parent cancellation and timeout without claiming forced termination',async()=>{
  const parent=new AbortController(); const reason=new Error('stop'); parent.abort(reason);
  await assert.rejects(runBounded(async()=>assert.fail('must not execute'),100,'operation',parent.signal),e=>e===reason);
  const active=new AbortController(); let child; const began=deferred();
  const pending=runBounded(async signal=>{child=signal;began.resolve();return new Promise(()=>{});},1000,'operation',active.signal);
  await began.promise; active.abort(reason); await assert.rejects(pending,e=>e===reason);assert.equal(child.aborted,true);
  let timeoutSignal;
  await assert.rejects(runBounded(async signal=>{timeoutSignal=signal;return new Promise(()=>{});},10,'controlled test'),/timed out/);
  assert.equal(timeoutSignal.aborted,true);
});
test('resource scopes are reverse ordered, immutable registrations, and concurrent-close safe',async()=>{
  for(const value of [0,Infinity])assert.throws(()=>new ResourceScope('mine',value),RangeError);
  assert.throws(()=>new ResourceScope(' '),/namespace/);
  const scope=new ResourceScope('mine'),order=[];
  const entry={id:'first',cleanup:async()=>{order.push('first');}};scope.defer(entry);entry.cleanup=async()=>assert.fail();
  scope.defer({id:'second',cleanup:async()=>{order.push('second');assert.throws(()=>scope.defer({id:'late',cleanup:async()=>{}}),/closing/);}});
  assert.throws(()=>scope.defer({id:'first',cleanup:async()=>{}}),/unique/);
  assert.throws(()=>scope.defer({id:'',cleanup:async()=>{}}),/nonempty/);
  assert.throws(()=>scope.defer({id:'bad',timeoutMs:0,cleanup:async()=>{}}),RangeError);
  const first=scope.close();assert.equal(first,scope.close());await first;assert.deepEqual(order,['second','first']);await scope.close();
});
test('execution failure and every cleanup failure survive; throw undefined is not success',async()=>{
  const scope=new ResourceScope('mine',20),primary=new Error('setup failed'),other=new Error('cleanup failed');let last=false;
  scope.defer({id:'last',cleanup:async()=>{last=true;}});
  scope.defer({id:'error',cleanup:async()=>{throw other;}});
  scope.defer({id:'hang',timeoutMs:5,cleanup:async()=>new Promise(()=>{})});
  await assert.rejects(withResourceScope(scope,async()=>{throw primary;}),e=>e instanceof AggregateError&&flatten(e).includes(primary)&&flatten(e).includes(other)&&flatten(e).some(x=>/timed out/.test(x.message)));
  assert(last);
  let observed=false;try{await withResourceScope(new ResourceScope('undefined'),async()=>{throw undefined;});}catch(e){observed=true;assert.equal(e,undefined);}assert(observed);
  const only=new ResourceScope('cleanup');only.defer({id:'bad',cleanup:async()=>{throw other;}});await assert.rejects(withResourceScope(only,async()=>42),AggregateError);
  assert.equal(await withResourceScope(new ResourceScope('success'),async()=>42),42);
});
test('late acquisitions are disposed even after a timed-out setup scope has closed',async()=>{
  const scope=new ResourceScope('late');await scope.close();let disposed=0;
  await assert.rejects(ownResource(scope,'context',{},async()=>{disposed++;}),/closing/);assert.equal(disposed,1);
  await assert.rejects(ownResource(scope,'context',{},async()=>{throw new Error('dispose failed');}),e=>e instanceof AggregateError&&e.errors.length===2);
  const owned=new ResourceScope('normal');const value={};assert.equal(await ownResource(owned,'resource',value,async()=>{disposed++;}),value);await owned.close();assert.equal(disposed,2);
});
test('cleanup registry retains its public result shape while bounding and preserving failures',async()=>{
  assert.throws(()=>new CleanupRegistry('mine',0),/timeout/);
  const registry=new CleanupRegistry('mine',20),order=[];let signal;
  assert.throws(()=>registry.register({id:'foreign',ownerNamespace:'other',description:'',cleanup:async()=>{}}),/another namespace/);
  assert.throws(()=>registry.register({id:'invalid',ownerNamespace:'mine',description:'',timeoutMs:0,cleanup:async()=>{}}),/timeout/);
  registry.register({id:'last',ownerNamespace:'mine',description:'',cleanup:async()=>{order.push('last');}});
  assert.throws(()=>registry.register({id:'last',ownerNamespace:'mine',description:'',cleanup:async()=>{}}),/Duplicate/);
  registry.register({id:'error',ownerNamespace:'mine',description:'',cleanup:async()=>{throw 'plain error';}});
  registry.register({id:'timeout',ownerNamespace:'mine',description:'',timeoutMs:5,cleanup:async s=>{signal=s;return new Promise(()=>{});}});
  const [a,b]=await Promise.all([registry.run(),registry.run()]);assert.deepEqual(a,b);assert.equal(a.attempted,3);assert.equal(a.succeeded,1);assert.equal(a.failures.length,2);assert.equal(a.failures[1].message,'plain error');assert(signal.aborted);assert.deepEqual(order,['last']);
  assert.throws(()=>registry.register({id:'late',ownerNamespace:'mine',description:'',cleanup:async()=>{}}),/closed/);
  assert.deepEqual(await registry.run(),{attempted:0,succeeded:0,failures:[]});
});

test('authentication keys partition every relevant dimension and reject incomplete context',()=>{
  const base=authenticationKey('adapter',identity());const variants={application:'second',environment:'ci',role:'viewer',project:'webkit',configHash:'v2',namespace:'other',runId:'run-2',shard:2,parallelIndex:1,workerIndex:1,testId:'test',attempt:1};
  for(const [key,value]of Object.entries(variants))assert.notEqual(authenticationKey('adapter',identity({[key]:value})),base,key);
  assert.notEqual(authenticationKey('other',identity()),base);assert.match(base,/^[0-9a-f]{64}$/);
  for(const [key,value]of Object.entries({application:'',environment:undefined,role:'x'.repeat(4097),shard:-1,parallelIndex:1.2,workerIndex:Infinity,testId:''}))assert.throws(()=>authenticationKey('adapter',identity({[key]:value})),/identity/);
  const {adapter}=adapterFixture();for(const options of [{reuse:'global'},{maxAgeMs:0},{timeoutMs:Infinity},{cleanupTimeoutMs:-1}])assert.throws(()=>new AuthenticationManager(adapter,options));
  assert.throws(()=>new AuthenticationManager({...adapter,id:''}),/adapter ID/);
});
test('default authentication is test scoped and callback failure still disposes the session',async()=>{
  const {state,adapter}=adapterFixture(),manager=new AuthenticationManager(adapter);
  assert.equal(await manager.withSession(identity(),async s=>s.id),1);
  await assert.rejects(manager.withSession(identity(),async()=>{throw new Error('test failure');}),/test failure/);
  assert.deepEqual(state.disposed,[1,2]);await manager.close();await manager.close();
  await assert.rejects(manager.withSession(identity(),async()=>{}),/closed/);
});
test('worker reuse serializes same-key leases and validates actual sessions before reuse',async()=>{
  const {state,adapter}=adapterFixture(),manager=new AuthenticationManager(adapter,{reuse:'worker'}),release=deferred(),entered=deferred();let secondEntered=false;
  const first=manager.withSession(identity(),async s=>{entered.resolve();await release.promise;return s.id;});await entered.promise;
  const second=manager.withSession(identity(),async s=>{secondEntered=true;return s.id;});await Promise.resolve();assert.equal(secondEntered,false);release.resolve();assert.deepEqual(await Promise.all([first,second]),[1,1]);assert.equal(state.created,1);assert.equal(state.validated,2);
  await manager.withSession(identity({role:'viewer'}),async s=>assert.equal(s.role,'viewer'));
  const close=manager.close();assert.equal(close,manager.close());await close;assert.deepEqual(state.disposed,[2,1]);
});
test('expired and invalid cached sessions are disposed before replacement, without ignoring infrastructure errors',async()=>{
  const {state,adapter}=adapterFixture();let validCalls=0;adapter.validate=async()=>++validCalls!==2;
  const manager=new AuthenticationManager(adapter,{reuse:'worker',maxAgeMs:10});await manager.withSession(identity(),async()=>{});await manager.withSession(identity(),async s=>assert.equal(s.id,2));assert.deepEqual(state.disposed,[1]);
  const now=Date.now;Date.now=()=>now()+1000;try{await manager.withSession(identity(),async s=>assert.equal(s.id,3));}finally{Date.now=now;}
  adapter.validate=async()=>{throw new Error('validation unavailable');};await assert.rejects(manager.withSession(identity(),async()=>assert.fail()),/validation unavailable/);assert.deepEqual(state.disposed,[1,2,3]);await manager.close();
});
test('authentication setup, invalid role, state export and cleanup failures remain observable',async()=>{
  for(const kind of ['setup','role','state']){
    let cleaned=false;
    const adapter={id:'failing',authenticate:async(_id,scope)=>{scope.defer({id:'context',cleanup:async()=>{cleaned=true;}});if(kind==='setup')throw new Error('login failed');return {};},validate:async()=>kind!=='role',...(kind==='state'?{storageState:async()=>({})}:{})};
    await assert.rejects(withAuthentication(adapter,identity(),async()=>assert.fail()),/login failed|invalid session|storage state/i);assert(cleaned);
  }
  const adapter={id:'cleanup-error',authenticate:async(_id,scope)=>{scope.defer({id:'context',cleanup:async()=>{throw new Error('disposal failed');}});return {};},validate:async()=>true};
  const manager=new AuthenticationManager(adapter,{reuse:'worker'});await manager.withSession(identity(),async()=>{});await assert.rejects(manager.close(),e=>flatten(e).some(x=>x.message==='disposal failed'));
  await assert.rejects(withAuthentication(adapter,identity(),async()=>{throw new Error('body failed');}),e=>flatten(e).some(x=>x.message==='body failed')&&flatten(e).some(x=>x.message==='disposal failed'));
});
test('timed-out authentication requests cancellation and disposes already acquired resources',async()=>{
  let cleaned=false,signal;
  const adapter={id:'deadline',authenticate:async(_id,scope,s)=>{signal=s;scope.defer({id:'resource',cleanup:async()=>{cleaned=true;}});return new Promise(()=>{});},validate:async()=>true};
  await assert.rejects(withAuthentication(adapter,identity(),async()=>assert.fail(),{timeoutMs:10}),/timed out/);assert(cleaned);assert(signal.aborted);
});
test('storage state is private, intact on reuse, invalidated after tampering and removed on teardown',async()=>{
  const {adapter,state}=adapterFixture({storage:true});const manager=new AuthenticationManager(adapter,{reuse:'worker'});let firstPath,secondPath;
  await manager.withSession(identity(),async(_s,path)=>{firstPath=path;assert.match(await readFile(path,'utf8'),/credential-canary/);const metadata=JSON.parse(await readFile(join(dirname(path),'metadata.json'),'utf8'));assert.equal(metadata.schemaVersion,1);assert.match(metadata.sha256,/^[0-9a-f]{64}$/);if(process.platform!=='win32'){assert.equal((await stat(path)).mode&0o777,0o600);assert.equal((await stat(dirname(path))).mode&0o777,0o700);}});
  await manager.withSession(identity(),async(_s,path)=>assert.equal(path,firstPath));
  await writeFile(firstPath,'{"cookies":[],"origins":[]}');await manager.withSession(identity(),async(s,path)=>{assert.equal(s.id,2);secondPath=path;});assert.notEqual(firstPath,secondPath);await assert.rejects(stat(firstPath),{code:'ENOENT'});assert.deepEqual(state.disposed,[1]);
  await manager.close();await assert.rejects(stat(secondPath),{code:'ENOENT'});
});
test('failed same-key lease does not poison queued work; close waits for active leases',async()=>{
  const {adapter,state}=adapterFixture();const manager=new AuthenticationManager(adapter,{reuse:'worker'}),release=deferred(),entered=deferred();
  const first=manager.withSession(identity(),async()=>{throw new Error('first');});await assert.rejects(first,/first/);
  const active=manager.withSession(identity(),async()=>{entered.resolve();await release.promise;});await entered.promise;const closing=manager.close();assert.equal(state.disposed.length,0);release.resolve();await active;await closing;assert.deepEqual(state.disposed,[1]);
});

test('owned files publish complete bytes, preserve Unicode and reject unsafe names and oversize content',async()=>{
  for(const size of [0,-1,NaN,65*1024*1024])await assert.rejects(OwnedFiles.create(size),RangeError);
  const files=await OwnedFiles.create(12);try{
    const path=await files.write('file Ω.txt','héllo');assert.equal((await files.read('file Ω.txt')).toString(),'héllo');assert.equal((await stat(path)).nlink,1);
    await files.write('binary.dat',Buffer.from([1,2]));assert.deepEqual(await files.read('binary.dat'),Buffer.from([1,2]));
    await assert.rejects(files.write('file Ω.txt','x'),{code:'EEXIST'});assert.equal((await files.read('file Ω.txt')).toString(),'héllo');
    for(const name of ['','..','.','../escape','x/y','x\\y','C:x','CON','NUL.txt','x.','x ','\0x','x'.repeat(181)])await assert.rejects(files.write(name,'x'),/Unsafe/);
    await assert.rejects(files.write('large','é'.repeat(7)),/size limit/);
    assert.equal((await readdir(files.directory)).some(x=>x.startsWith('.writing-')),false);
  }finally{const closing=files.close();assert.equal(closing,files.close());await closing;}
  await assert.rejects(files.read('binary.dat'),/closed/);await assert.rejects(stat(files.directory),{code:'ENOENT'});
});
test('owned file reads reject oversized and multiply linked files without deleting foreign data',async()=>{
  const files=await OwnedFiles.create(8);const outside=await mkdtemp(join(tmpdir(),'forgeqa-test-'));
  try{
    await writeFile(join(files.directory,'large'),'0123456789');await assert.rejects(files.read('large'),/Unsafe/);
    await writeFile(join(outside,'foreign'),'safe');await link(join(outside,'foreign'),join(files.directory,'hard'));await assert.rejects(files.read('hard'),/Unsafe/);
    await files.close();assert.equal(await readFile(join(outside,'foreign'),'utf8'),'safe');
  }finally{await rm(outside,{recursive:true,force:true});}
});
test('owned directories and symlink targets cannot be substituted during access or teardown',async()=>{
  const files=await OwnedFiles.create();const outside=await mkdtemp(join(tmpdir(),'forgeqa-test-'));const moved=files.directory+'-original';
  try{
    await writeFile(join(outside,'sentinel'),'safe');
    // Junctions do not require Windows symlink privileges; directory links are rejected as files.
    await symlink(outside,join(files.directory,'link'),process.platform==='win32'?'junction':'dir');await assert.rejects(files.read('link'),/Unsafe/);
    await rename(files.directory,moved);await symlink(outside,files.directory,process.platform==='win32'?'junction':'dir');
    await assert.rejects(files.write('escape','bad'),/replaced/);await assert.rejects(files.close(),/replaced/);assert.equal(await readFile(join(outside,'sentinel'),'utf8'),'safe');
  }finally{await rm(files.directory,{recursive:true,force:true});await rm(moved,{recursive:true,force:true});await rm(outside,{recursive:true,force:true});}
});
function downloadFixture(chunks,options={}) { const data={canceled:0};return {data,download:{suggestedFilename:()=>options.name??'download.txt',createReadStream:async()=>options.noStream?null:Readable.from(chunks),failure:async()=>options.failure??null,cancel:async()=>{data.canceled++;if(options.cancelError)throw new Error('cancel failed');}}}; }
test('downloads stream into owned files, enforce byte budgets and remove partial failures',async()=>{
  const files=await OwnedFiles.create(8);try{
    const good=downloadFixture([Buffer.from('abc'),Buffer.from('def')]);await files.saveDownload(good.download);assert.equal((await files.read('download.txt')).toString(),'abcdef');
    for(const [name,fixture]of [['overflow',downloadFixture([Buffer.alloc(9)])],['failed',downloadFixture([],{failure:'network'})],['no-stream',downloadFixture([],{noStream:true})],['cancel-error',downloadFixture([Buffer.alloc(9)],{cancelError:true})]]){
      await assert.rejects(files.saveDownload(fixture.download,name),/size limit|Browser download failed|no readable|cleanup failed/);assert.equal(fixture.data.canceled,1);await assert.rejects(stat(join(files.directory,name)),{code:'ENOENT'});
    }
    await assert.rejects(files.saveDownload(good.download,'invalid',0),RangeError);
  }finally{await files.close();}
});
test('a pending browser download is bounded, canceled, and cannot prevent owned-directory teardown',async()=>{
  const files=await OwnedFiles.create(),started=deferred();let canceled=0;
  const download={suggestedFilename:()=> 'pending',createReadStream:async()=>{started.resolve();return new Readable({read(){}});},failure:async()=>null,cancel:async()=>{canceled++;}};
  const pending=files.saveDownload(download,'pending',15);const rejected=assert.rejects(pending,/timed out/);await started.promise;const close=files.close();await rejected;await close;assert.equal(canceled,1);await assert.rejects(stat(files.directory),{code:'ENOENT'});
});

test('tenant-scoped flags restore exact snapshots on success, partial mutation, and body failure',async()=>{
  let flags={attachments:false},calls=0;
  const adapter={id:'tenant-flags',isolation:'tenant',read:async()=>({...flags}),replace:async(_ns,next)=>{flags={...next};calls++;}};
  assert.equal(await withFeatureFlags(adapter,'tenant',{attachments:true,newFlag:true},async()=>{assert.deepEqual(flags,{attachments:true,newFlag:true});return 42;}),42);assert.deepEqual(flags,{attachments:false});
  await assert.rejects(withFeatureFlags(adapter,'tenant',{attachments:true},async()=>{throw new Error('body');}),/body/);assert.deepEqual(flags,{attachments:false});
  let first=true;adapter.replace=async(_ns,next)=>{flags={...next};if(first){first=false;throw new Error('partial mutation');}};
  await assert.rejects(withFeatureFlags(adapter,'tenant',{attachments:true},async()=>assert.fail()),/partial mutation/);assert.deepEqual(flags,{attachments:false});assert.equal(calls,4);
});
test('unsafe global, invalid, and overlapping flag mutations fail before changing state',async()=>{
  const adapter={id:'flags',isolation:'tenant',read:async()=>({enabled:false}),replace:async()=>{}};
  await assert.rejects(withFeatureFlags({...adapter,isolation:'global'},'tenant',{},async()=>{}),/global mutation/);
  await assert.rejects(withFeatureFlags(adapter,'',{},async()=>{}),/namespace/);
  await assert.rejects(withFeatureFlags(adapter,'tenant',{'invalid key':true},async()=>{}),/snapshot/);
  await assert.rejects(withFeatureFlags(adapter,'tenant',{enabled:'yes'},async()=>{}),/snapshot/);
  await withFeatureFlags(adapter,'tenant',{},async()=>{await assert.rejects(withFeatureFlags(adapter,'tenant',{},async()=>{}),/Concurrent/);await withFeatureFlags(adapter,'different',{},async()=>{});});
  await withFeatureFlags(adapter,'tenant',{},async()=>{});
});
test('network interception counts expected traffic and removes only the registered handlers',async()=>{
  const existing={url:'foreign',handler:()=>{}};const handlers=[existing];
  const page={route:async(url,handler)=>{handlers.push({url,handler});},unroute:async(url,handler)=>{const i=handlers.findIndex(h=>h.url===url&&h.handler===handler);if(i>=0)handlers.splice(i,1);}};
  let calls=0;await withNetworkRoutes(page,[{name:'expected',url:'owned',handler:async()=>{calls++;}}],async observations=>{await handlers[1].handler({},{});assert.deepEqual(observations,[{name:'expected',expectedInterceptions:1}]);});assert.equal(calls,1);assert.deepEqual(handlers,[existing]);
  await assert.rejects(withNetworkRoutes(page,[{name:'x',url:'x',handler:async()=>{}}],async()=>{throw new Error('body');}),/body/);assert.deepEqual(handlers,[existing]);
  for(const names of [[''],['x','x']])await assert.rejects(withNetworkRoutes(page,names.map(name=>({name,url:'x',handler:async()=>{}})),async()=>{}),/unique/);
});
test('browser clock control owns a fresh context and closes it even when installation or use fails',async()=>{
  let closed=0,installed;const page={clock:{install:async({time})=>{installed=time;}}};const browser={newContext:async()=>({newPage:async()=>page,close:async()=>{closed++;}})};
  for(const instant of [0,'2000-01-01',new Date(0)])await withClockPage(browser,instant,async p=>{assert.equal(p,page);assert(installed instanceof Date);});assert.equal(closed,3);
  await assert.rejects(withClockPage(browser,'invalid',async()=>{}),/Invalid/);
  await assert.rejects(withClockPage(browser,0,async()=>{throw new Error('body');}),/body/);assert.equal(closed,4);
  page.clock.install=async()=>{throw new Error('install');};await assert.rejects(withClockPage(browser,0,async()=>{}),/install/);assert.equal(closed,5);
});
