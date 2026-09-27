import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('distributed browser evidence is isolated from preceding consumer lifecycle state', async () => {
  const source = await readFile('scripts/distributed-browser-evidence.mjs', 'utf8');
  assert.match(source, /const explicitConfigs=\['--config',forgeConfig,'--playwright-config',playwrightConfig\]/);
  assert.match(source, /env:isolatedEnvironment\(\)/);
  assert.match(source, /name\.startsWith\('FORGEQA_'\)/);
  assert.match(source, /name\.startsWith\('TEAMBOARD_'\)/);
  assert.match(source, /name==='PORT'/);
  assert.match(source, /planJson\.shardTotal\?\?planJson\.shardCount/);
});
