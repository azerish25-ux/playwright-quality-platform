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
    },
    ...(['chromium', 'firefox', 'webkit'] as const).map(browserName => ({
      name: `ledgerguard-${browserName}`,
      testMatch: '**/*.ui.spec.ts',
      use: { browserName, baseURL: process.env.LEDGERGUARD_UI_URL ?? 'http://127.0.0.1:13000', viewport: { width: 1440, height: 900 } }
    }))
  ],
  use: {
    baseURL: process.env.LEDGERGUARD_BASE_URL ?? 'http://127.0.0.1:18080',
    extraHTTPHeaders: {
      Accept: 'application/json'
    }
  }
});
