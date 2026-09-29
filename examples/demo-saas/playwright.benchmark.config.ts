import {defineForgePlaywrightConfig} from '@azerish25-ux/forgeqa-playwright';
import {createTimingContext, readTimingContext} from '@azerish25-ux/forgeqa-core';
import {resolve} from 'node:path';
import {readFileSync} from 'node:fs';
import config from './forgeqa.benchmark.config.js';

const request = process.env.FORGEQA_RUN_REQUEST ? JSON.parse(readFileSync(process.env.FORGEQA_RUN_REQUEST, 'utf8')) as { mode: string; runId: string; runDir: string } : undefined;
if (request?.mode === 'run') {
  if (!process.env.FORGEQA_TIMING_CONTEXT) {
    const value = process.argv[process.argv.indexOf('--shard') + 1];
    const shard = process.argv.includes('--shard') ? /^(\d+)\/(\d+)$/.exec(value ?? '') : undefined;
    if (process.argv.includes('--shard') && !shard) throw new Error('Invalid profiling shard.');
    process.env.FORGEQA_TIMING_CONTEXT = createTimingContext(resolve(request.runDir, 'timing'), {
      sourceSha: process.env.FORGEQA_SOURCE_SHA ?? '', runId: request.runId,
      shardIndex: shard ? Number(shard[1]) : 1, shardTotal: shard ? Number(shard[2]) : 1
    });
  } else if (readTimingContext(process.env.FORGEQA_TIMING_CONTEXT).identity.runId !== request.runId) {
    throw new Error('Profiling context belongs to another run.');
  }
}
export default defineForgePlaywrightConfig(config,{
  testDir:'./tests',
  fullyParallel:true,
  expect:{timeout:7000},
  projects:[
    {name:'api',testMatch:'**/*.api.spec.ts'},
    ...(['chromium','firefox','webkit'] as const).map(browserName=>({name:browserName,testMatch:'**/*.ui.spec.ts',use:{browserName}}))
  ],
  webServer:{
    command: request?.mode === 'run' ? 'node ../../benchmarks/profile-server.mjs' : 'node dist/server.js',
    url:`${process.env.TEAMBOARD_ORIGIN??'http://127.0.0.1:3199'}/ready`,
    reuseExistingServer:false,
    timeout:30000,
    gracefulShutdown:{signal:'SIGTERM',timeout:6000}
  }
});
