import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import { createJiti } from 'jiti';
import { ConfigurationError, IntegrityError, resolveForgeConfig, sha256, stableHash, redactText, type ExpectedExecution, type ForgeConfigInput, type ResolveConfigOptions, type ResolvedForgeConfig, type SelectionManifest, type MergedRunResult, type ShardResult } from '@azerish25-ux/forgeqa-core';
export interface Parsed { command: string[]; options: Map<string,string|boolean>; positionals: string[]; }
export interface ShardSpec { index:number; total:number; }
const booleanOptions=new Set(['json','dry-run','help','version']);
const allowedOptions=new Set([...booleanOptions,'destination','package-manager','template','config','playwright-config','environment','suite','browsers','workers','retries','shard','manifest','output','report','quarantine','minimum-samples','file','known-tests','test-id','history','render','repository','workflow','artifact-name','token-env','max-runs']);
export function parse(argv: string[]): Parsed {
  const options=new Map<string,string|boolean>(), positionals:string[]=[], command:string[]=[];
  let index=0;
  if (argv[0] && !argv[0].startsWith('-')) {command.push(argv[0]);index++;}
  if (['report','history','quarantine'].includes(command[0] ?? '') && argv[index] && !argv[index]!.startsWith('-')) command.push(argv[index++]!);
  for (;index<argv.length;index++) {
    const token=argv[index]!;
    if (!token.startsWith('--')) {if(token.startsWith('-'))throw new ConfigurationError(`Unknown option: ${token}`);positionals.push(token);continue;}
    const split=token.indexOf('='); const name=token.slice(2,split<0?undefined:split);
    if (!allowedOptions.has(name)) throw new ConfigurationError(`Unknown option: --${name}`);
    if (options.has(name)) throw new ConfigurationError(`Duplicate option: --${name}`);
    if (booleanOptions.has(name)) {if(split>=0)throw new ConfigurationError(`--${name} takes no value.`);options.set(name,true);continue;}
    const value=split<0?argv[++index]:token.slice(split+1);
    if (!value || value.startsWith('--')) throw new ConfigurationError(`--${name} requires a value.`);
    options.set(name,value);
  }
  return {command,options,positionals};
}
export function parseShard(value:string):ShardSpec {
  const match=/^(\d+)\/(\d+)$/.exec(value.trim());
  if(!match)throw new ConfigurationError(`Invalid shard ${value}. Use INDEX/TOTAL.`);
  const index=Number(match[1]),total=Number(match[2]);
  if(!Number.isInteger(index)||!Number.isInteger(total)||total<1||total>256||index<1||index>total)throw new ConfigurationError(`Invalid shard ${value}. INDEX must be between 1 and TOTAL, and TOTAL must be at most 256.`);
  return {index,total};
}
function opt(p: Parsed,key:string,fallback:string):string {return String(p.options.get(key)??fallback);}
function emit(p: Parsed,value:unknown,human:string):void {process.stdout.write((p.options.get('json')?JSON.stringify(value):human)+'\n');}
async function boundedJson(path:string):Promise<any> {
  const bytes=await readFile(path);
  if(bytes.length>16*1024*1024)throw new IntegrityError('JSON evidence exceeds 16 MiB.');
  return JSON.parse(bytes.toString('utf8')) as unknown;
}
async function configuration(parsed: Parsed): Promise<{config:ResolvedForgeConfig;options:ResolveConfigOptions;shard:ShardSpec}> {
  const configPath=resolve(opt(parsed,'config','forgeqa.config.ts'));
  try {await access(configPath);} catch {throw new ConfigurationError(`Missing ForgeQA configuration: ${configPath}`);}
  const jiti=createJiti(pathToFileURL(resolve('package.json')).href,{moduleCache:false,fsCache:false});
  let input: ForgeConfigInput;
  try {input=await jiti.import(configPath,{default:true}) as ForgeConfigInput;} catch(error) {throw new ConfigurationError(`Cannot load ForgeQA configuration: ${redactText(error instanceof Error?error.message:String(error))}`);}
  if(!input || typeof input!=='object')throw new ConfigurationError('ForgeQA configuration must export an object.');
  const cli: NonNullable<ResolveConfigOptions['cli']>={};
  for(const key of ['workers','retries'] as const)if(parsed.options.has(key))cli[key]=Number(parsed.options.get(key));
  if(parsed.options.has('browsers'))cli.browsers=opt(parsed,'browsers','').split(',') as NonNullable<ForgeConfigInput['browsers']>;
  if(parsed.options.has('output'))cli.outputDir=opt(parsed,'output','forgeqa-results');
  const requestedShard=parsed.options.has('shard')?parseShard(opt(parsed,'shard','1/1')):undefined;
  if(requestedShard)cli.shards=requestedShard.total;
  const options:ResolveConfigOptions={cwd:process.cwd(),cli,...(parsed.options.has('environment')?{environment:opt(parsed,'environment','local')}:{})};
  const config=resolveForgeConfig(input,options);
  if((config.retries ?? 0)>1)throw new ConfigurationError('Ordinary execution permits at most one recorded diagnostic retry.');
  const shard=requestedShard ?? {index:1,total:config.shards ?? 1};
  if(shard.total!==(config.shards ?? 1))throw new ConfigurationError(`Shard total ${shard.total} conflicts with configured shard count ${config.shards}.`);
  return {config,options,shard};
}
function consumerRunner(): {cli:string;reporter:string} {
  const require=createRequire(resolve('package.json'));
  try {return {cli:require.resolve('@playwright/test/cli'),reporter:require.resolve('@azerish25-ux/forgeqa-playwright/reporter')};}
  catch {throw new ConfigurationError('Install compatible @playwright/test and @azerish25-ux/forgeqa-playwright in the consumer.');}
}
function suitePattern(config:ResolvedForgeConfig,suite:string): string {
  const membership:Record<string,string[]>={smoke:['@smoke'],regression:['@regression'],release:['@release'],...config.suites};
  if(!membership[suite])throw new ConfigurationError(`Unknown suite: ${suite}`);
  const names=suite==='release'?['smoke','regression','release']:suite==='regression'?['smoke','regression']:[suite];
  return `(?:${[...new Set(names.flatMap(name=>membership[name]!))].join('|')})(?:\\s|$)`;
}
export interface StableTestSelection { expected: ExpectedExecution[]; selectors: string[]; }
export function selectStableTest(expected:ExpectedExecution[],testId:string):StableTestSelection {
  const stableId=testId.trim();
  if(!stableId)throw new ConfigurationError('Stable test ID must not be empty.');
  const matches=expected.filter(entry=>entry.logicalTestId===stableId).sort((a,b)=>a.executionId.localeCompare(b.executionId));
  if(!matches.length)throw new ConfigurationError(`Unknown stable test ID: ${stableId}`);
  const locations=new Set<string>();
  for(const entry of matches) {
    if(!entry.relativePath || !Number.isInteger(entry.line) || entry.line!<1)throw new IntegrityError(`Stable test ${stableId} is missing source location evidence.`);
    locations.add(`${entry.relativePath}:${entry.line}`);
  }
  if(locations.size!==1)throw new IntegrityError(`Stable test ${stableId} resolves to multiple declarations.`);
  return {expected:matches,selectors:[...locations].sort()};
}
interface ChildResult {code:number;stdout:string;stderr:string;interrupted:boolean;}
function childEnvironment(requestPath:string,runDir:string): NodeJS.ProcessEnv {
  const env={...process.env,FORGEQA_RUN_REQUEST:requestPath,PLAYWRIGHT_BLOB_OUTPUT_DIR:resolve(runDir,'blob-report')};
  for(const key of Object.keys(env)) if(/^(GITHUB_TOKEN|GH_TOKEN|NODE_AUTH_TOKEN|NPM_TOKEN|ACTIONS_RUNTIME_TOKEN|ACTIONS_ID_TOKEN_REQUEST_TOKEN)$/.test(key))delete (env as NodeJS.ProcessEnv)[key];
  return env;
}
async function invoke(cli:string,args:string[],env:NodeJS.ProcessEnv,budgetMs:number): Promise<ChildResult> {
  return await new Promise((done,reject)=>{
    const child=spawn(process.execPath,[cli,...args],{cwd:process.cwd(),env,shell:false,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='',interrupted=false,killTimer:NodeJS.Timeout|undefined;
    const terminate=(force=false)=>{
      if(!child.pid)return;
      if(process.platform==='win32') {
        const killer=spawn('taskkill',['/PID',String(child.pid),'/T',...(force?['/F']:[])],{stdio:'ignore',shell:false});
        killer.on('error',()=>{child.kill(force?'SIGKILL':'SIGTERM');});
      } else {try {process.kill(-child.pid,force?'SIGKILL':'SIGTERM');} catch(error) {if((error as NodeJS.ErrnoException).code!=='ESRCH')stderr+='\nOwned process termination failed.';}}
    };
    const stop=()=>{interrupted=true;terminate();killTimer=setTimeout(()=>terminate(true),5000);killTimer.unref();};
    process.once('SIGINT',stop);process.once('SIGTERM',stop);
    const timer=setTimeout(()=>{stderr+='\nNative runner exceeded the execution budget.';stop();},budgetMs);timer.unref();
    const cleanup=()=>{clearTimeout(timer);if(killTimer)clearTimeout(killTimer);process.off('SIGINT',stop);process.off('SIGTERM',stop);};
    child.stdout.on('data',(chunk:Buffer)=>{stdout=(stdout+chunk.toString()).slice(-65_536);});
    child.stderr.on('data',(chunk:Buffer)=>{stderr=(stderr+chunk.toString()).slice(-65_536);});
    child.once('error',error=>{cleanup();reject(error);});
    child.once('close',(code,signal)=>{cleanup();done({code:interrupted?130:code??(signal?3:3),stdout:redactText(stdout),stderr:redactText(stderr),interrupted});});
  });
}
function validateManifest(manifest:SelectionManifest,config:ResolvedForgeConfig,shardTotal:number):void {
  if(manifest.schemaVersion!==1 || !manifest.runId || manifest.configHash!==config.configHash || !manifest.expected.length)throw new IntegrityError('Expected execution manifest is missing, empty, or incompatible.');
  if(manifest.selectionHash!==stableHash(manifest.expected))throw new IntegrityError('Expected execution manifest selection hash is invalid.');
  if(manifest.expected.some(entry=>entry.shardTotal!==shardTotal || entry.shardIndex<1 || entry.shardIndex>shardTotal))throw new IntegrityError('Expected execution manifest has contradictory shard dimensions.');
  if(new Set(manifest.expected.map(entry=>entry.executionId)).size!==manifest.expected.length)throw new IntegrityError('Expected execution manifest contains duplicate executions.');
}
async function discover(parsed:Parsed) {
  const {config,options,shard}=await configuration(parsed);
  const runner=consumerRunner();
  const suite=opt(parsed,'suite','smoke');
  const grep=suitePattern(config,suite);
  const nativeConfig=resolve(opt(parsed,'playwright-config','playwright.config.ts'));
  if(!existsSync(nativeConfig))throw new ConfigurationError(`Missing Playwright configuration: ${nativeConfig}`);
  await mkdir(config.outputDir,{recursive:true,mode:0o700});
  const runDir=await mkdtemp(resolve(config.outputDir,'run-'));
  const args=['test','--config',nativeConfig,'--grep',grep,'--workers',String(config.workers),'--retries',String(config.retries),'--timeout',String(config.timeoutMs),'--forbid-only'];
  if(config.qualityGates?.failOnRetryRecovered)args.push('--fail-on-flaky-tests');
  if(parsed.options.has('manifest')) {
    if(parsed.options.has('test-id'))throw new ConfigurationError('--test-id cannot be combined with --manifest. Discover the exact diagnostic target locally.');
    const manifestPath=resolve(opt(parsed,'manifest',''));
    const manifest=await boundedJson(manifestPath) as SelectionManifest;
    validateManifest(manifest,config,shard.total);
    return {config,runner,args,runDir,runId:manifest.runId,manifest,manifestPath,request:{runId:manifest.runId,runDir,mode:'discover' as const,suite,options},shard};
  }
  const runId=randomUUID();
  const manifests:SelectionManifest[]=[];
  for(let index=1;index<=shard.total;index+=1) {
    const discoveryDir=shard.total===1?runDir:resolve(runDir,`discovery-${index}-of-${shard.total}`);
    await mkdir(discoveryDir,{recursive:true,mode:0o700});
    const requestPath=resolve(discoveryDir,'request.json');
    const request={runId,runDir:discoveryDir,mode:'discover' as const,suite,options};
    await writeFile(requestPath,JSON.stringify(request),{mode:0o600});
    const env=childEnvironment(requestPath,discoveryDir);
    const nativeShard=shard.total===1?[]:['--shard',`${index}/${shard.total}`];
    const listing=await invoke(runner.cli,[...args,...nativeShard,'--list','--reporter',runner.reporter],env,60_000);
    if(listing.code!==0)throw new ConfigurationError('Playwright discovery failed.',{runnerExitCode:listing.code,diagnostics:listing.stderr||listing.stdout,runDir:discoveryDir,shard:`${index}/${shard.total}`});
    const partPath=resolve(discoveryDir,'manifest.json');
    if(!existsSync(partPath))throw new IntegrityError('Discovery did not write an execution manifest.',{runDir:discoveryDir,diagnostics:listing.stderr});
    const part=await boundedJson(partPath) as SelectionManifest;
    if(part.schemaVersion!==1 || part.runId!==runId || part.configHash!==config.configHash)throw new IntegrityError('Shard discovery manifest is incompatible with the planned run.');
    if(part.expected.some(entry=>entry.shardIndex!==index || entry.shardTotal!==shard.total))throw new IntegrityError(`Shard discovery ${index}/${shard.total} reported contradictory identities.`);
    manifests.push(part);
  }
  const discovered=manifests.flatMap(value=>value.expected).sort((a,b)=>a.executionId.localeCompare(b.executionId));
  if(!discovered.length)throw new ConfigurationError('Empty test selection.');
  if(new Set(discovered.map(entry=>entry.executionId)).size!==discovered.length)throw new IntegrityError('Distributed discovery produced duplicate executions.');
  let expected=discovered;
  let selectionArgs:string[]=[];
  if(parsed.options.has('test-id')) {
    if(shard.total!==1)throw new ConfigurationError('--test-id diagnostic selection does not accept distributed shards.');
    const target=selectStableTest(discovered,opt(parsed,'test-id',''));
    expected=target.expected;
    selectionArgs=target.selectors;
  }
  const manifest:SelectionManifest={schemaVersion:1,runId,configHash:config.configHash,selectionHash:stableHash(expected),expected};
  const manifestPath=resolve(runDir,'manifest.json');
  await writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n',{mode:0o600});
  return {config,runner,args:[...args,...selectionArgs],runDir,runId,manifest,manifestPath,request:{runId,runDir,mode:'discover' as const,suite,options},shard};
}
export async function planCommand(parsed: Parsed): Promise<void> {
  const value=await discover(parsed);
  const shards=Array.from({length:value.shard.total},(_,index)=>({index:index+1,executions:value.manifest.expected.filter(entry=>entry.shardIndex===index+1).length}));
  emit(parsed,{runId:value.runId,runDir:value.runDir,manifestPath:value.manifestPath,suite:value.request.suite,workers:value.config.workers,shardCount:value.shard.total,estimatedConcurrency:(value.config.workers ?? 1)*value.shard.total,shards,manifest:value.manifest,reason:'native Playwright shard discovery with suite inheritance'},`Selected ${value.manifest.expected.length} executions across ${value.shard.total} shard(s).\n${shards.map(item=>`Shard ${item.index}/${value.shard.total}: ${item.executions} executions`).join('\n')}\nManifest: ${value.manifestPath}`);
}
async function verifyShardEvidence(path:string,value:{runId:string;manifest:SelectionManifest;config:ResolvedForgeConfig;shard:ShardSpec}):Promise<ShardResult> {
  const shard=await boundedJson(path) as ShardResult;
  if(shard.schemaVersion!==1 || shard.runId!==value.runId || shard.selectionHash!==value.manifest.selectionHash || shard.configHash!==value.config.configHash || shard.shardIndex!==value.shard.index || shard.shardTotal!==value.shard.total || !shard.finalizedAt || !shard.journalSha256)throw new IntegrityError('Shard finalization evidence is missing or incompatible.');
  const journalPath=path.replace(/\.final\.json$/,'');
  if(journalPath===path || sha256(await readFile(journalPath))!==shard.journalSha256)throw new IntegrityError('Shard journal checksum mismatch.');
  return shard;
}
export async function runCommand(parsed: Parsed): Promise<void> {
  const value=await discover(parsed);
  if(value.shard.total>1 && !parsed.options.has('shard'))throw new ConfigurationError('Distributed execution requires an explicit --shard INDEX/TOTAL. Use forgeqa plan first or the reusable workflow.');
  const executionDir=value.shard.total===1?value.runDir:resolve(value.runDir,`shard-${value.shard.index}-of-${value.shard.total}`);
  await mkdir(executionDir,{recursive:true,mode:0o700});
  const requestPath=resolve(executionDir,'request.json');
  const request={...value.request,runDir:executionDir,mode:'run' as const,manifestPath:value.manifestPath};
  await writeFile(requestPath,JSON.stringify(request),{mode:0o600});
  const env=childEnvironment(requestPath,executionDi6);
  const nativeShard=value.shard.total===1?[]:['--shard',`${value.shard.index}/${value.shard.total}`];
  const runner=await invoke(value.runner.cli,[...value.args,...nativeShard,'--reporter',`${value.runner.reporter},blob`],env,600_000);
  let exitCode=runner.code===0?0:runner.code===130?130:1;
  const failures:unknown[]=[];
  if(value.shard.total>1) {
    let shardReport:ShardResult|undefined;
    const shardReportPath=resolve(executionDir,'attempts.ndjson.final.json');
    try {
      shardReport=await verifyShardEvidence(shardReportPath,value);
      if(shardReport.completion!=='complete' && exitCode===0)exitCode=3;
    } catch(error) {exitCode=3;failures.push({code:'FORGEQA_INTEGRITY',message:error instanceof Error?error.message:String(error)});}
    if(runner.interrupted)exitCode=130;
    if(runner.code!==0)failures.push({code:'NATIVE_RUNNER',exitCode:runner.code,diagnostics:runner.stderr||runner.stdout});
    emit(parsed,{runId:value.runId,runDir:executionDir,manifestPath:value.manifestPath,shardReport:shardReport?shardReportPath:undefined,shardIndex:value.shard.index,shardCount:value.shard.total,exitCode,runnerExitCode:runner.code,completion:shardReport?.completion ?? 'incomplete',tests:new Set(shardReport?.attempts.map(a=>a.executionId)).size,attempts:shardReport?.attempts.length ?? 0,failures},`ForgeQA shard ${value.shard.index}/${value.shard.total} ${exitCode===0?'passed':'failed'} (exit ${exitCode}).\nShard evidence: ${shardReportPath}${failures.length?'\n'+JSON.stringify(failures):''}`);
    process.exitCode=exitCode;
    return;
  }
  let report:MergedRunResult|undefined;
  try {
    const marker=await boundedJson(resolve(executionDir,'complete.json'));
    if(marker.schemaVersion!==1 || marker.runId!==value.runId || marker.configHash!==value.config.configHash || marker.selectionHash!==value.manifest.selectionHash || ![0,1,2,3,130].includes(marker.exitCode))throw new IntegrityError('Invalid finalization marker.');
    for(const name of ['report.json','junit.xml','summary.md','index.html','runtime.log']) if(sha256(await readFile(resolve(executionDir,name)))!==marker.checksums?.[name])throw new IntegrityError(`Report checksum mismatch: ${name}`);
    report=await boundedJson(resolve(executionDir,'report.json')) as MergedRunResult;
    if(report.runId!==value.runId || report.configHash!==value.config.configHash)throw new IntegrityError('Report belongs to a different run.');
    if(marker.exitCode!==0)exitCode=marker.exitCode;
    if(report.gate?.outcome!=='pass' && exitCode===0)exitCode=1;
  } catch(error) {exitCode=3;failures.push({code:'FORGEQA_INTEGRITY',message:error instanceof Error?error.message:String(error)});}
  if(runner.interrupted)exitCode=130;
  if(runner.code!==0)failures.push({code:'NATIVE_RUNNER',exitCode:runner.code,diagnostics:runner.stderr||runner.stdout});
  const shardReportPath=resolve(executionDir,'attempts.ndjson.final.json');
  emit(parsed,{runId:value.runId,runDir:executionDir,manifestPath:value.manifestPath,...(existsSync(shardReportPath)?{shardReport:shardReportPath}:{}),exitCode,runnerExitCode:runner.code,completion:report?.completion ?? 'incomplete',tests:new Set(report?.attempts.map(a=>a.executionId)).size,attempts:report?.attempts.length ?? 0,gate:report?.gate,failures},`ForgeQA ${exitCode===0?'passed':'failed'} (exit ${exitCode}).\nReport: ${resolve(executionDir,'index.html')}\n${report?.gate?.violations.map(v=>`${v.id}: ${v.message}`).join('\n') ?? ''}${failures.length?'\n'+JSON.stringify(failures):''}`);
  process.exitCode=exitCode;
}
export async function doctorCommand(parsed:Parsed):Promise<void> {
  const {config}=await configuration(parsed);
  const runner=consumerRunner();
  const require=createRequire(resolve('package.json'));
  const checks:Array<{name:string;ok:boolean;detail:string}>=[];
  const version=require('@playwright/test/package.json').version as string;
  checks.push({name:'runtime',ok:Number(process.versions.node.split('.')[0])>=22,detail:process.versions.node});
  checks.push({name:'playwright',ok:/^1\.(5[8-9]|[6-9]\d)\./.test(version),detail:version});
  checks.push({name:'reporter',ok:existsSync(runner.reporter),detail:runner.reporter});
  const playwright=require('@playwright/test') as Record<string,{executablePath():string}>;
  for(const browser of config.browsers ?? [])checks.push({name:browser,ok:existsSync(playwright[browser]!.executablePath()),detail:playwright[browser]!.executablePath()});
  await mkdir(config.outputDir,{recursive:true});
  await access(config.outputDir,2);
  checks.push({name:'output',ok:true,detail:config.outputDir});
  emit(parsed,{ok:checks.every(c=>c.ok),checks},checks.map(c=>`${c.ok?'PASS':'FAIL'} ${c.name}: ${c.detail}`).join('\n'));
  if(checks.some(c=>!c.ok))process.exitCode=2;
}
