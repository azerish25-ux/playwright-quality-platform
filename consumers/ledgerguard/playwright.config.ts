import { defineForgePlaywrightConfig } from '@azerish25-ux/forgeqa-playwright';
import config from './forgeqa.config.js';

export default defineForgePlaywrightConfig(config, {
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: true,
  expect: { timeout: 10_000 },
  projects: [
    {
      name: 'ledgerguard-api',
      testMatch: '**/*.api.spec.ts'
    }
  ],
  use: {
    baseURL: process.env.LEDGERGUARD_BASE_URL ?? 'http://127.0.0.1:18080',
    extraHTTPHeaders: {
      Accept: 'application/json'
    }
  }
});
