import { defineForgeConfig } from '@azerish25-ux/forgeqa-core';

export default defineForgeConfig({
  project: 'ledgerguard',
  consumer: 'transaction-reliability-lab',
  environments: {
    local: {
      baseUrl: process.env.LEDGERGUARD_BASE_URL ?? 'http://127.0.0.1:18080'
    }
  },
  suites: {
    release: ['@release']
  },
  browsers: ['chromium'],
  workers: 1,
  shards: 1,
  retries: 0,
  timeout: '90s',
  outputDir: 'forgeqa-results',
  qualityGates: {
    failOnRetryRecovered: true,
    unexpectedSkipBudget: 0,
    requireCompleteShards: true
  },
  artifactPolicy: {
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    retentionDays: 7
  }
});
