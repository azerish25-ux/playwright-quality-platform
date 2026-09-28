import { defineForgeConfig } from '@azerish25-ux/forgeqa-core';

export default defineForgeConfig({
  project: 'forgeqa-consumer',
  environments: { local: { baseUrl: 'http://127.0.0.1:3219' } },
  browsers: ['chromium'],
  workers: 2,
  retries: 0,
  qualityGates: { failOnRetryRecovered: true, requireCompleteShards: true },
});
