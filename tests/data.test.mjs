import test from 'node:test';
import assert from 'node:assert/strict';
import { defineDataFactory, allocateNamespace, CleanupRegistry } from '@azerish25-ux/forgeqa-test-data';

test('same seed reproduces values across worker dimensions',()=>{const factory=defineDataFactory('user',(ctx)=>({email:`u${ctx.integer(1,9999)}@example.test`,role:ctx.pick(['owner','viewer'])}));const a=factory.build({seed:'42',logicalTestId:'t',namespace:'run-a'});const b=factory.build({seed:'42',logicalTestId:'t',namespace:'run-b'});assert.deepEqual(a,b);});

test('namespaces prevent concurrent dimension collisions',()=>{const set=new Set();for(let shard=1;shard<=3;shard++)for(let p=0;p<4;p++)set.add(allocateNamespace({consumer:'demo',runId:'r',shardIndex:shard,project:'chromium',repetition:0,parallelIndex:p}));assert.equal(set.size,12);});

test('cleanup cannot register resources from another run and is reverse ordered',async()=>{const order=[];const registry=new CleanupRegistry('mine');assert.throws(()=>registry.register({id:'x',ownerNamespace:'other',description:'bad',cleanup:async()=>{}}),/another namespace/);registry.register({id:'a',ownerNamespace:'mine',description:'a',cleanup:async()=>{order.push('a')}});registry.register({id:'b',ownerNamespace:'mine',description:'b',cleanup:async()=>{order.push('b')}});const result=await registry.run();assert.deepEqual(order,['b','a']);assert.equal(result.succeeded,2);});
