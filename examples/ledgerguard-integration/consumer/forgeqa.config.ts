import { defineForgeConfig } from '@azerish25-ux/forgeqa-core';

export default defineForgeConfig({
  project: 'ledgerguard',
  environments: {
    local: { baseUrl: process.env.LEDGERGUARD_ORIGIN ?? 'http://127.0.0.1:8080' },
  },
  browsers: ['chromium'],
  workers: 1,
  retries: 0,
  timeout: '120s',
  outputDir: 'forgeqa-results',
  qualityGates: { failOnRetryRecovered: true, unexpectedSkipBudget: 0 },
});
