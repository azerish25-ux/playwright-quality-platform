import { performance } from 'node:perf_hooks';
import { writeFile, mkdir } from 'node:fs/promises';
import { cpus, totalmem } from 'node:os';
import { defineDataFactory } from '@azerish25-ux/forgeqa-test-data';
const factory=defineDataFactory('benchmark-user',(ctx)=>({id:ctx.integer(1,1_000_000)}));
const conditions=[1,2,4];const raw=[];for(const workers of conditions){for(let repetition=0;repetition<5;repetition++){const start=performance.now();for(let i=0;i<100_000;i++)factory.build({seed:'benchmark',logicalTestId:`t-${i%100}`,namespace:`w-${i%workers}`,sequence:i});raw.push({workers,repetition,durationMs:performance.now()-start,inventory:100_000});}}
await mkdir('benchmarks/results',{recursive:true});const result={schemaVersion:1,generatedAt:new Date().toISOString(),node:process.version,platform:process.platform,cpuCount:cpus().length,totalMemory:totalmem(),note:'Synthetic factory-throughput benchmark; not represented as customer test execution.',raw};await writeFile('benchmarks/results/latest.json',`${JSON.stringify(result,null,2)}\n`);console.log(JSON.stringify(result,null,2));
