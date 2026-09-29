import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: '.', testMatch: 'lifecycle.spec.ts', retries: 0, workers: 2, fullyParallel: true,
  reporter: [['json', { outputFile: 'fixture-acceptance/result.json' }]],
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }], timeout: 30_000 });
