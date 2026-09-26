import type { Reporter, FullConfig, Suite, TestCase, TestResult, FullResult, TestError } from '@playwright/test/reporter';
import { randomUUID } from 'node:crypto';
import { existsSync, realpathSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import {
  RESULT_SCHEMA_VERSION, ConfigurationError, IntegrityError, attemptIdentity, executionIdentity,
  logicalTestIdentity, shardIdentity, stableHash, sha256, redactText, redactValue, gatePolicy, evaluateGates,
  type ArtifactRecord, type AttemptRecord, type ExpectedExecution, type MergedRunResult,
  type SelectionManifest, type ShardResult, type ResolvedForgeConfig, type QuarantineRecord
} from '@azerish25-ux/forgeqa-core';
import { ResultJournal, readFinalizedShard, mergeShardResults, toHtmlReport, toJUnit, toJsonReport, toMarkdownSummary } from '@azerish25-ux/forgeqa-reporter';
interface Metadata { schemaVersion: 1; runId: string; runDir: string; root: string; config: ResolvedForgeConfig; mode: 'discover'|'run'; manifestPath?: string; }
const MAX_ATTACHMENT = 32 * 1024 * 1024;
function atomic(path: string, value: string): void {
  mkdirSync(dirname(path), {recursive:true,mode:0o700});
  const tmp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(tmp, value, {flag:'wx',mode:0o600});
  renameSync(tmp,path);
}
function text(value: string): string { return redactText(value.replace(/\u001b\[[0-9;]*m/g, '')).slice(0,16_384); }
function within(root: string, path: string): boolean {
  const rel = relative(root,path);
  return rel !== '..' && !rel.startsWith('../') && !rel.startsWith('..\\') && !isAbsolute(rel);
}
/** Reporter callbacks are guarded: Playwright otherwise swallows reporter exceptions. */
export default class ForgeReporter implements Reporter {
  private metadata?: Metadata;
  private native?: FullConfig;
  private manifest?: SelectionManifest;
  private journal?: ResultJournal;
  private queue: Promise<void> = Promise.resolve();
  private attempts: AttemptRecord[] = [];
  private errors: string[] = [];
  private globalLog = '';
  private executions = new Map<string,ExpectedExecution>();
  private failedReporter = false;
  printsToStdio(): boolean { return true; }
  private panic(error: unknown): void {
    this.failedReporter = true;
    this.errors.push(text(error instanceof Error ? error.message : String(error)));
    process.exitCode = 3;
  }
  private guard(fn: () => void): void { try { fn(); } catch (error) { this.panic(error); } }
  private enqueue(fn: () => Promise<void>): void { this.queue = this.queue.then(fn).catch(error=>this.panic(error)); }
  private identify(test: TestCase): ExpectedExecution {
    const m = this.metadata!;
    const project = test.parent.project();
    const explicitId = test.annotations.find(a=>a.type==='forgeqa-id')?.description;
    const relativePath = relative(m.root,test.location.file).replace(/\\/g,'/');
    const logicalTestId = logicalTestIdentity({ ...(explicitId ? {explicitId} : {}), relativePath, titlePath:test.titlePath().slice(3) });
    return {
      executionId: executionIdentity({consumer:m.config.consumer ?? m.config.project,environment:m.config.environment,project:project?.name ?? '',repetition:test.repeatEachIndex,logicalTestId}),
      logicalTestId, project:project?.name ?? '', ...(project?.use.browserName ? {browser:project.use.browserName} : {}),
      environment:m.config.environment, shardIndex:this.native?.shard?.current ?? 1, shardTotal:this.native?.shard?.total ?? 1,
      title:text(test.title), relativePath, repetition:test.repeatEachIndex
    };
  }
  onBegin(config: FullConfig, suite: Suite): void {
    this.guard(()=>{
      const m = config.metadata['forgeqa'] as Metadata | undefined;
      if (!m || m.schemaVersion!==1) throw new ConfigurationError('Use defineForgePlaywrightConfig to connect native Playwright to ForgeQA.');
      this.metadata=m; this.native=config;
      if (config.shard && config.shard.total!==1) throw new ConfigurationError('Distributed run reconciliation is not implemented in this milestone; use a complete single-runner inventory.');
      mkdirSync(m.runDir,{recursive:true,mode:0o700});
      const explicit = new Map<string,string>();
      const expected = suite.allTests().map(test=>{
        const record=this.identify(test);
        const id=test.annotations.find(a=>a.type==='forgeqa-id')?.description;
        const declaration=`${record.relativePath}:${test.location.line}:${test.location.column}`;
        if (id && explicit.has(id) && explicit.get(id)!==declaration) throw new ConfigurationError(`Duplicate explicit test ID: ${id}`);
        if (id) explicit.set(id,declaration);
        if (this.executions.has(test.id)) throw new ConfigurationError(`Duplicate native test identity: ${test.id}`);
        this.executions.set(test.id,record);
        return record;
      }).sort((a,b)=>a.executionId.localeCompare(b.executionId));
      if (!expected.length) throw new ConfigurationError('Empty test selection.');
      if (new Set(expected.map(e=>e.executionId)).size!==expected.length) throw new ConfigurationError('Duplicate execution identities.');
      const manifest: SelectionManifest={schemaVersion:1,runId:m.runId,configHash:m.config.configHash,selectionHash:stableHash(expected),expected};
      if (m.mode==='run' && m.manifestPath) {
        const prior=JSON.parse(readFileSync(m.manifestPath,'utf8')) as SelectionManifest;
        if (stableHash(prior)!==stableHash(manifest)) throw new IntegrityError('Execution discovery changed after the expected manifest was created.');
      } else atomic(resolve(m.runDir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
      this.manifest=manifest;
      if (m.mode==='run') {
        this.journal=new ResultJournal(resolve(m.runDir,'attempts.ndjson'));
        const {attempts: _a, completion: _c, ...header}=this.shard();
        this.enqueue(()=>this.journal!.start(header));
      }
    });
  }
  private shard(): ShardResult {
    const m=this.metadata!;
    return {schemaVersion:RESULT_SCHEMA_VERSION,runId:m.runId,shardId:shardIdentity({runId:m.runId,project:'all',index:1,total:1}),shardIndex:1,shardTotal:1,
      selectionHash:this.manifest!.selectionHash,configHash:m.config.configHash,completion:this.failedReporter?'infrastructure-failure':'complete',
      revision:{repository:process.env.GITHUB_REPOSITORY ?? m.config.consumer ?? m.config.project,sourceCommit:process.env.FORGEQA_SOURCE_SHA ?? 'local-unversioned',testedCommit:process.env.GITHUB_SHA ?? process.env.FORGEQA_TESTED_SHA ?? 'local-unversioned',...(process.env.GITHUB_REF_NAME ? {branch:process.env.GITHUB_REF_NAME} : {})},attempts:this.attempts};
  }
  private artifacts(test: TestCase, result: TestResult, attemptId: string): ArtifactRecord[] {
    const m=this.metadata!;
    const artifacts: ArtifactRecord[]=[];
    for (const [index,attachment] of result.attachments.entries()) {
      const type: ArtifactRecord['type'] = attachment.name==='trace'?'trace':attachment.name==='screenshot'?'screenshot':attachment.name==='video'?'video':attachment.name.includes('diagnostic')?'log':'attachment';
      let path=attachment.path;
      if (attachment.body) {
        if (attachment.body.length>MAX_ATTACHMENT) {artifacts.push({path:'',type,state:'unavailable',size:attachment.body.length});continue;}
        let body=attachment.body;
        if (/json|text/.test(attachment.contentType)) {
          let content=body.toString('utf8');
          try {content=JSON.stringify(redactValue(JSON.parse(content)));} catch {content=text(content);}
          body=Buffer.from(content);
        }
        path=resolve(m.runDir,'attachments',`${attemptId.replace(':','-')}-${index}`);
        mkdirSync(dirname(path),{recursive:true,mode:0o700});
        writeFileSync(path,body,{mode:0o600,flag:'wx'});
      }
      if (!path) {artifacts.push({path:'',type,state:'unavailable'});continue;}
      path=resolve(path);
      if (!within(m.runDir,path)) {artifacts.push({path:'[outside-owned-output]',type,state:'unavailable'});continue;}
      const rel=relative(m.runDir,path).replace(/\\/g,'/');
      if (!existsSync(path)) {artifacts.push({path:rel,type,state:'missing'});continue;}
      const stat=lstatSync(path);
      if (!within(realpathSync(m.runDir),realpathSync(path)) || stat.isSymbolicLink() || !stat.isFile() || stat.size>MAX_ATTACHMENT) {artifacts.push({path:rel,type,state:'unavailable',size:stat.size});continue;}
      artifacts.push({path:rel,type,state:'captured',size:stat.size,sha256:sha256(readFileSync(path))});
    }
    const browser=this.executions.get(test.id)?.browser;
    for (const kind of ['trace','screenshot','video'] as const) if (!artifacts.some(a=>a.type===kind)) artifacts.push({path:'',type:kind,state:!browser?'inapplicable':m.config.artifactPolicy?.[kind]==='off'?'disabled':'unavailable'});
    return artifacts;
  }
  onTestEnd(test: TestCase, result: TestResult): void {
    this.guard(()=>{
      if (!this.manifest || this.metadata?.mode!=='run') return;
      const expected=this.executions.get(test.id);
      if (!expected) throw new IntegrityError(`Undiscovered native test ${test.id}.`);
      const attemptId=attemptIdentity(expected.executionId,result.retry);
      const outcome: AttemptRecord['outcome']=result.status==='skipped'?'skipped':result.status==='interrupted'?'cancelled':result.status==='passed'?(test.expectedStatus==='passed'?'passed':'unexpected-pass'):result.status===test.expectedStatus?'expected-failure':result.status==='timedOut'?'timed-out':'failed';
      const attempt: AttemptRecord={schemaVersion:1,attemptId,executionId:expected.executionId,logicalTestId:expected.logicalTestId,retry:result.retry,outcome,startedAt:result.startTime.toISOString(),durationMs:result.duration,project:expected.project,environment:expected.environment,...(expected.browser?{browser:expected.browser}:{}),title:expected.title ?? '',
        ...(test.annotations.find(a=>a.type==='forgeqa-owner')?.description ? {owner:text(test.annotations.find(a=>a.type==='forgeqa-owner')!.description!)} : {}),
        ...(result.errors.length ? {error:{name:'PlaywrightError',message:text(result.errors.map(e=>e.message ?? e.value ?? 'Unknown test error').join('\n')),stack:text(result.errors[0]?.stack ?? '')}} : {}),artifacts:this.artifacts(test,result,attemptId)};
      const stdio=result.stdout.concat(result.stderr).map(chunk=>chunk.toString()).join('').slice(0,16_384);
      if (stdio) {
        const path=resolve(this.metadata.runDir,'attachments',`${attemptId.replace(':','-')}-stdio.txt`);
        atomic(path,text(stdio));
        attempt.artifacts!.push({path:relative(this.metadata.runDir,path).replace(/\\/g,'/'),type:'log',state:'captured',size:Buffer.byteLength(text(stdio))});
      }
      this.attempts.push(attempt);
      this.enqueue(()=>this.journal!.attempt(attempt));
    });
  }
  onError(error: TestError): void { this.errors.push(text(error.message ?? error.value ?? 'Native runner error')); }
  onStdOut(chunk: string|Buffer, test?: TestCase): void { if (!test && this.globalLog.length<16_384) this.globalLog+=text(chunk.toString()).slice(0,16_384-this.globalLog.length); }
  onStdErr(chunk: string|Buffer, test?: TestCase): void { this.onStdOut(chunk,test); }
  async onEnd(result: FullResult): Promise<{status:'passed'|'failed'}> {
    await this.queue;
    const m=this.metadata;
    try {
      if (!m || !this.manifest || this.failedReporter) throw new IntegrityError(this.errors.join('; ') || 'Reporter initialization did not complete.');
      if (m.mode==='discover') {
        if (this.errors.length) throw new ConfigurationError(this.errors.join('; '));
        return {status:result.status==='passed'?'passed':'failed'};
      }
      const shard=this.shard();
      if (result.status==='interrupted') shard.completion='cancelled';
      if (this.errors.length) shard.completion='infrastructure-failure';
      await this.journal!.finalize(shard);
      const finalized=await readFinalizedShard(this.journal!.finalPath);
      const report: MergedRunResult=mergeShardResults([finalized],this.manifest);
      report.inventory=this.manifest.expected;
      report.runnerStatus=result.status;
      report.infrastructureErrors=[...this.errors];
      let quarantine: QuarantineRecord[]=[];
      try {quarantine=JSON.parse(readFileSync(m.config.quarantineFile,'utf8')) as QuarantineRecord[];}
      catch (error) {if ((error as NodeJS.ErrnoException).code!=='ENOENT') throw new ConfigurationError('Quarantine file is unreadable or invalid JSON.');}
      report.gate=evaluateGates(report,quarantine,gatePolicy(m.config.qualityGates));
      const outputs={'report.json':toJsonReport(report),'junit.xml':toJUnit(report),'summary.md':toMarkdownSummary(report),'index.html':toHtmlReport(report),'runtime.log':this.globalLog};
      for (const [name,content] of Object.entries(outputs)) atomic(resolve(m.runDir,name),content);
      const exitCode=report.completion!=='complete'?3:report.gate.outcome==='fail'?1:0;
      atomic(resolve(m.runDir,'complete.json'),JSON.stringify({schemaVersion:1,runId:m.runId,configHash:m.config.configHash,selectionHash:this.manifest.selectionHash,exitCode,runnerStatus:result.status,checksums:Object.fromEntries(Object.entries(outputs).map(([name,content])=>[name,sha256(content)]))},null,2)+'\n');
      return {status:exitCode===0?'passed':'failed'};
    } catch (error) {
      this.panic(error);
      if (m) {
        try {atomic(resolve(m.runDir,'reporter-error.json'),JSON.stringify({schemaVersion:1,errors:this.errors},null,2)+'\n');} catch { /* The absent complete marker also fails the parent integrity check. */ }
      }
      process.stderr.write(`FORGEQA_REPORTER: ${this.errors.join('; ')}\n`);
      return {status:'failed'};
    }
  }
}
