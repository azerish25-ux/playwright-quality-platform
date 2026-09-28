import {defineForgeConfig} from '@azerish25-ux/forgeqa-core';

export default defineForgeConfig({
  project:'teamboard',
  environments:{local:{baseUrl:process.env.TEAMBOARD_ORIGIN??'http://127.0.0.1:3199'}},
  browsers:['chromium','firefox','webkit'],
  workers:1,
  retries:0,
  timeout:'30s',
  outputDir:'forgeqa-benchmark-results',
  artifactPolicy:{trace:'off',screenshot:'off',video:'off',retentionDays:14},
  qualityGates:{failOnRetryRecovered:true,unexpectedSkipBudget:0,requireCompleteShards:true}
});
