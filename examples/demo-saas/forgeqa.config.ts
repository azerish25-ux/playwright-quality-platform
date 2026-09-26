import {defineForgeConfig} from '@azerish25-ux/forgeqa-core';
export default defineForgeConfig({project:'teamboard',environments:{local:{baseUrl:process.env.TEAMBOARD_ORIGIN??'http://127.0.0.1:3199'}},browsers:['chromium','firefox','webkit'],workers:4,retries:0,timeout:'30s',outputDir:'forgeqa-results',qualityGates:{failOnRetryRecovered:true,unexpectedSkipBudget:0}});
