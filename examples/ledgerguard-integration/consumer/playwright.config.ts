import { defineForgePlaywrightConfig } from '@azerish25-ux/forgeqa-playwright';
import config from './forgeqa.config.js';

export default defineForgePlaywrightConfig(config, {
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  expect: { timeout: 10_000 },
  projects: [{ name: 'api', testMatch: '**/*.api.spec.ts' }],
});
