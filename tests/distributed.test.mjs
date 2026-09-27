import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {parseShard} from '../packages/cli/dist/runner.js';

const root=fileURLToPath(new URL('../',import.meta.url));

test('shard syntax is strict and bounded',()=>{
  assert.deepEqual(parseShard('1/1'),{index:1,total:1});
  assert.deepEqual(parseShard('4/8'),{index:4,total:8});
  for(const value of ['0/2','3/2','1/0','1/257','1','a/b','1/2/3'])assert.throws(()=>parseShard(value),/Invalid shard/);
});

test('reusable workflow creates a dynamic independent shard matrix and aggregate gate',async()=>{
  const content=await readFile(resolve(root,'.github/workflows/forgeqa-reusable.yml'),'utf8');
  assert.match(content,/fromJSON\(needs\.plan\.outputs\.matrix\)/);
  assert.match(content,/fail-fast:\s*false/);
  assert.match(content,/name:\s*forgeqa-quality/);
  assert.match(content,/mode:\s*merge/);
  assert.match(content,/pattern: forgeqa-shard-/);
  assert.doesNotMatch(content,/matrix:\s*\n\s*shard:\s*\[1\]/);
});
