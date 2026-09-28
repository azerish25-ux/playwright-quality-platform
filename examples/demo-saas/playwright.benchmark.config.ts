import {defineForgePlaywrightConfig} from '@azerish25-ux/forgeqa-playwright';
import config from './forgeqa.benchmark.config.js';

export default defineForgePlaywrightConfig(config,{
  testDir:'./tests',
  fullyParallel:true,
  expect:{timeout:7000},
  projects:[
    {name:'api',testMatch:'**/*.api.spec.ts'},
    ...(['chromium','firefox','webkit'] as const).map(browserName=>({name:browserName,testMatch:'**/*.ui.spec.ts',use:{browserName}}))
  ],
  webServer:{
    command:'node dist/server.js',
    url:`${process.env.TEAMBOARD_ORIGIN??'http://127.0.0.1:3199'}/ready`,
    reuseExistingServer:false,
    timeout:30000,
    gracefulShutdown:{signal:'SIGTERM',timeout:6000}
  }
});
