import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
export default defineConfig({ testDir: '.', testMatch: 'lifecycle.spec.ts', retries: 0, workers: 2, fullyParallel: true,
  reporter: [['list'], ['json', { outputFile: fileURLToPath(new URL('./result.json', import.meta.url)) }]],
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }], timeout: 30_000 });
