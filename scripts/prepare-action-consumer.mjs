import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const destination = resolve('.tmp/action-consumer');
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await writeFile(resolve(destination, 'package.json'), JSON.stringify({
  name: 'forgeqa-action-acceptance',
  private: true,
  type: 'module',
}, null, 2) + '\n');
await writeFile(resolve(destination, 'forgeqa.config.ts'), `
import { defineForgeConfig } from '@azerish25-ux/forgeqa-core';
export default defineForgeConfig({
  project: 'forgeqa-action-acceptance',
  environments: { local: { baseUrl: 'http://127.0.0.1:31999' } },
  browsers: [],
  workers: 1,
  retries: 0,
  shards: 2
});
`);
await writeFile(resolve(destination, 'playwright.config.ts'), `
import { defineForgePlaywrightConfig } from '@azerish25-ux/forgeqa-playwright';
import forge from './forgeqa.config';
export default defineForgePlaywrightConfig(forge, {
  testDir: '.',
  testMatch: 'action.spec.ts',
  projects: [{ name: 'api' }]
});
`);
await writeFile(resolve(destination, 'action.spec.ts'), `
import { test as base, expect } from '@playwright/test';
import { createForgeTest, forgeId } from '@azerish25-ux/forgeqa-playwright';
const test = createForgeTest(base);
test('action shard one', { tag: '@smoke', annotation: forgeId('action.one') }, async ({ forge }) => {
  expect(forge.runId).toBeTruthy();
});
test('action shard two', { tag: '@smoke', annotation: forgeId('action.two') }, async ({ forge }) => {
  expect(forge.namespace).toMatch(/^fq-/);
});
`);
process.stdout.write(`${destination}\n`);
