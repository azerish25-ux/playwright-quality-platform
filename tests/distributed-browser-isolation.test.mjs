import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('distributed browser evidence is isolated from preceding consumer lifecycle state', async () => {
  const source = await readFile('scripts/distributed-browser-evidence.mjs', 'utf8');
  assert.match(source, /const temporaryRoot=resolve\(root,'\.tmp'\)/);
  assert.match(source, /await mkdir\(temporaryRoot,\{recursive:true\}\)/);
  assert.match(source, /mkdtemp\(join\(temporaryRoot,'browser-evidence-'\)\)/);
  assert(
    source.indexOf('await mkdir(temporaryRoot,{recursive:true})')
      < source.indexOf("mkdtemp(join(temporaryRoot,'browser-evidence-'))"),
    'The clean-checkout temporary parent must exist before mkdtemp runs.'
  );
  assert.match(source, /const explicitConfigs=\['--config',forgeConfig,'--playwright-config',playwrightConfig\]/);
  assert.match(source, /environments:\{ci:\{baseUrl:'http:\/\/127\.0\.0\.1:31999'\}\}/);
  assert.match(source, /suites:\{release:\['@release'\]\}/);
  assert.match(source, /outputDir:'\.\/forgeqa-results'/);
  assert.match(source, /artifactPolicy:\{trace:'off',screenshot:'off',video:'off'\}/);
  assert.match(source, /qualityGates:\{failOnRetryRecovered:true/);
  assert.doesNotMatch(source, /testDir:'\.\/tests',[\s\S]*baseUrl:/);
  assert.doesNotMatch(source, /artifacts:|gates:/);
  assert.match(source, /env:isolatedEnvironment\(\)/);
  assert.match(source, /name\.startsWith\('FORGEQA_'\)/);
  assert.match(source, /name\.startsWith\('TEAMBOARD_'\)/);
  assert.match(source, /name==='PORT'/);
  assert.match(source, /\['plan','--suite','release','--shard','1\/2','--json'/);
  assert.doesNotMatch(source, /--shard-total/);
  assert.match(source, /planJson\.shardTotal\?\?planJson\.shardCount/);
});
