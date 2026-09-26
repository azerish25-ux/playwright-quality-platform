import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import { createJiti } from 'jiti';
import { ConfigurationError, IntegrityError, resolveForgeConfig, sha256, redactText, type ForgeConfigInput, type ResolveConfigOptions, type ResolvedForgeConfig, type SelectionManifest, type MergedRunResult } from '@azerish25-ux/forgeqa-core';
export interface Parsed { command: string[]; options: Map<string,string|boolean>; positionals: string[]; }
const booleanOptions=new Set(['json','dry-run','help','version']);
const allowedOptions=new Set([...booleanOptions,'destination','package-manager','template','config','playwright-config','environment','suite','browsers','workers','retries','shard','manifest','output','report','quarantine','minimum-samples','file','known-tests']);
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
function opt(p: Parsed,key:string,fallback:string):string {return String(p.options.get(key)??fallback);}
function emit(p: Parsed,value:unknown,human:string):void {process.stdout.write((p.options.get('json')?JSON.stringify(value):human)+'\n');}
async function boundedJson(path:string):Promise<any> {
  const bytes=await readFile(path);
  if(bytes.length>16*1024*1024)throw new IntegrityError('JSON evidence exceeds 16 MiB.');
  return JSON.parse(bytes.toString('utf8')) as unknown;
}
async function configuration(parsed: Parsed): Promise<{config:ResolvedForgeConfig;options:ResolveConfigOptions}> {
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
  const options:ResolveConfigOptions={cwd:process.cwd(),cli,...(parsed.options.has('environment')?{environment:opt(parsed,'environment','local')}:{})};
  const config=resolveForgeConfig(input,options);
  if((config.retries ?? 0)>1)throw new ConfigurationError('Ordinary execution permits at most one recorded diagnostic retry.');
  if(opt(parsed,'shard','1/1')!=='1/1' || (config.shards ?? 1)!==1)throw new ConfigurationError('This milestone requires a complete single-runner inventory; distributed reconciliation is not implemented yet.');
  return {config,options};
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
async function discover(parsed:Parsed) {
  const {config,options}=await configuration(parsed);
  const runner=consumerRunner();
  const suite=opt(parsed,'suite','smoke');
  const grep=suitePattern(config,suite);
  const nativeConfig=resolve(opt(parsed,'playwright-config','playwright.config.ts'));
  if(!existsSync(nativeConfig))throw new ConfigurationError(`Missing Playwright configuration: ${nativeConfig}`);
  await mkdir(config.outputDir,{recursive:true,mode:0o700});
  const runDir=await mkdtemp(resolve(config.outputDir,'run-'));
  const runId=randomUUID();
  const requestPath=resolve(runDir,'request.json');
  const request={runId,runDir,mode:'discover',suite,options};
  await writeFile(requestPath,JSON.stringify(request),{mode:0o600});
  const args=['test','--config',nativeConfig,'--grep',grep,'--workers',String(config.workers),'--retries',String(config.retries),'--timeout',String(config.timeoutMs),'--forbid-only'];
  if(config.qualityGates?.failOnRetryRecovered)args.push('--fail-on-flaky-tests');
  const env=childEnvironment(requestPath,runDir);
  const listing=await invoke(runner.cli,[...args,'--list','--reporter',runner.reporter],env,60_000);
  if(listing.code!==0)throw new ConfigurationError('Playwright discovery failed.',{runnerExitCode:listing.code,diagnostics:listing.stderr||listing.stdout,runDir});
  const manifestPath=resolve(runDir,'manifest.json');
  if(!existsSync(manifestPath))throw new IntegrityError('Discovery did not write an execution manifest.',{runDir,diagnostics:listing.stderr});
  const manifest=await boundedJson(manifestPath) as SelectionManifest;
  if(manifest.schemaVersion!==1 || manifest.runId!==runId || manifest.configHash!==config.configHash || !manifest.expected.length)throw new IntegrityError('Discovery manifest is missing, empty, or incompatible.');
  return {config,runner,args,env,runDir,runId,requestPath,request,manifest,manifestPath};
}
export async function planCommand(parsed: Parsed): Promise<void> {
  const value=await discover(parsed);
  emit(parsed,{runId:value.runId,runDir:value.runDir,suite:value.request.suite,workers:value.config.workers,estimatedConcurrency:value.config.workers,manifest:value.manifest,reason:'native Playwright discovery with suite inheritance'},`Selected ${value.manifest.expected.length} executions with ${value.config.workers} workers.\n${value.manifest.expected.map(e=>`${e.project}: ${e.logicalTestId} — ${e.title}`).join('\n')}\nManifest: ${value.manifestPath}`);
}
export async function runCommand(parsed: Parsed): Promise<void> {
  const value=await discover(parsed);
  await writeFile(value.requestPath,JSON.stringify({...value.request,mode:'run',manifestPath:value.manifestPath}),{mode:0o600});
  const runner=await invoke(value.runner.cli,[...value.args,'--reporter',`${value.runner.reporter},blob`],value.env,600_000);
  let exitCode=runner.code===0?0:runner.code===130?130:1;
  const failures:unknown[]=[];
  let report:MergedRunResult|undefined;
  try {
    const marker=await boundedJson(resolve(value.runDir,'complete.json'));
    if(marker.schemaVersion!==1 || marker.runId!==value.runId || marker.configHash!==value.config.configHash || marker.selectionHash!==value.manifest.selectionHash || ![0,1,2,3,130].includes(marker.exitCode))throw new IntegrityError('Invalid finalization marker.');
    for(const name of ['report.json','junit.xml','summary.md','index.html','runtime.log']) if(sha256(await readFile(resolve(value.runDir,name)))!==marker.checksums?.[name])throw new IntegrityError(`Report checksum mismatch: ${name}`);
    report=await boundedJson(resolve(value.runDir,'report.json')) as MergedRunResult;
    if(report.runId!==value.runId || report.configHash!==value.config.configHash)throw new IntegrityError('Report belongs to a different run.');
    if(marker.exitCode!==0)exitCode=marker.exitCode;
    if(report.gate?.outcome!=='pass' && exitCode===0)exitCode=1;
  } catch(error) {exitCode=3;failures.push({code:'FORGEQA_INTEGRITY',message:error instanceof Error?error.message:String(error)});}
  if(runner.interrupted)exitCode=130;
  if(runner.code!==0)failures.push({code:'NATIVE_RUNNER',exitCode:runner.code,diagnostics:runner.stderr||runner.stdout});
  emit(parsed,{runId:value.runId,runDir:value.runDir,exitCode,runnerExitCode:runner.code,completion:report?.completion ?? 'incomplete',tests:new Set(report?.attempts.map(a=>a.executionId)).size,attempts:report?.attempts.length ?? 0,gate:report?.gate,failures},`ForgeQA ${exitCode===0?'passed':'failed'} (exit ${exitCode}).\nReport: ${resolve(value.runDir,'index.html')}\n${report?.gate?.violations.map(v=>`${v.id}: ${v.message}`).join('\n') ?? ''}${failures.length?'\n'+JSON.stringify(failures):''}`);
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
