import type { Fixtures, Page, TestInfo, TestType } from '@playwright/test';
import { stableHash, redactValue, ResourceScope, withResourceScope, type ResolvedForgeConfig } from '@azerish25-ux/forgeqa-core';
import { OwnedFiles } from './owned-files.js';
export * from './authentication.js';
export * from './owned-files.js';
export * from './overrides.js';
export { defineForgePlaywrightConfig } from './config.js';
export interface ForgeWorkerContext { runId: string; namespace: string; config: ResolvedForgeConfig; }
export interface ForgeTestOptions {
  config?: ResolvedForgeConfig; runId?: string;
  namespaceFactory?: (info: { project: {name: string}; parallelIndex: number; workerIndex: number }) => string;
}
export interface ForgeWorkerFixtures { forge: ForgeWorkerContext; }
export interface ForgeTestFixtures { forgeDiagnosticsEnabled: boolean; forgeScope: ResourceScope; forgeFiles: OwnedFiles; }
export async function withBrowserDiagnostics(page: Page, info: TestInfo, use: (page: Page) => Promise<void>): Promise<void> {
  const events: Array<Record<string, unknown>> = [];
  let bytes = 0, dropped = 0;
  const record = (kind: string, data: Record<string, unknown>) => {
    const event = redactValue({ kind, ...data }) as Record<string, unknown>;
    const text = JSON.stringify(event);
    if (events.length >= 100 || bytes + text.length > 32_768) { dropped++; return; }
    events.push(event); bytes += text.length;
  };
  const consoleError = (msg: import('@playwright/test').ConsoleMessage) => { if (msg.type()==='error') record('console-error', {message:msg.text().slice(0,4096)}); };
  const pageError = (error: Error) => record('page-error', {message:error.message.slice(0,4096)});
  const failed = (request: import('@playwright/test').Request) => record('transport-failure', {url:request.url(),message:request.failure()?.errorText});
  const response = (value: import('@playwright/test').Response) => { if (value.status()>=400) record('http-error', {url:value.url(),status:value.status()}); };
  page.on('console',consoleError); page.on('pageerror',pageError); page.on('requestfailed',failed); page.on('response',response);
  try { await use(page); }
  finally {
    page.off('console',consoleError); page.off('pageerror',pageError); page.off('requestfailed',failed); page.off('response',response);
    await info.attach('forgeqa-diagnostics', {body:Buffer.from(JSON.stringify({events,dropped})),contentType:'application/json'});
  }
}
/** Extends, rather than replaces, the full native callable TestType. API-only tests never request page. */
export function createForgeTest<T extends {page: Page}, W extends object>(base: TestType<T,W>, options: ForgeTestOptions = {}): TestType<T & ForgeTestFixtures,W & ForgeWorkerFixtures> {
  const fixtures = {
    forgeDiagnosticsEnabled: [true, {option:true}],
    forgeScope: async ({forge}: {forge:ForgeWorkerContext}, use:(scope:ResourceScope)=>Promise<void>, info:TestInfo) => {
      await withResourceScope(new ResourceScope(`${forge.namespace}-${stableHash({testId:info.testId,retry:info.retry,repeat:info.repeatEachIndex}).slice(0,16)}`), use);
    },
    forgeFiles: async ({forgeScope,forge}: {forgeScope:ResourceScope;forge:ForgeWorkerContext}, use:(files:OwnedFiles)=>Promise<void>) => {
      const files = await OwnedFiles.create(10 * 1024 * 1024, { identity: { runId: forge.runId, consumer: forge.config.consumer ?? forge.config.project, namespace: forgeScope.namespace } });
      forgeScope.defer({id:'owned-files',cleanup:()=>files.close()});
      await use(files);
    },
    forge: [async ({}: object, use: (context: ForgeWorkerContext)=>Promise<void>, info: import('@playwright/test').WorkerInfo) => {
      const metadata = info.config.metadata['forgeqa'];
      const config = options.config ?? metadata?.config as ResolvedForgeConfig | undefined;
      const runId = options.runId ?? metadata?.runId as string | undefined;
      if (!config || !runId) throw new Error('createForgeTest requires defineForgePlaywrightConfig or explicit resolved configuration and runId.');
      const namespace = options.namespaceFactory?.(info) ?? `fq-${stableHash({consumer:config.consumer,runId,project:info.project.name,shard:info.config.shard,parallelIndex:info.parallelIndex,workerIndex:info.workerIndex}).slice(0,24)}`;
      await use({runId,namespace,config});
    }, {scope:'worker'}],
    page: async ({page,forgeDiagnosticsEnabled}: {page:Page;forgeDiagnosticsEnabled:boolean}, use:(page:Page)=>Promise<void>, info:TestInfo) => {
      if (forgeDiagnosticsEnabled) await withBrowserDiagnostics(page,info,use); else await use(page);
    }
  } as unknown as Fixtures<ForgeTestFixtures,ForgeWorkerFixtures,T,W>;
  return base.extend<ForgeTestFixtures,ForgeWorkerFixtures>(fixtures);
}
export function forgeId(id:string): {type:'forgeqa-id';description:string} { return {type:'forgeqa-id',description:id}; }
export function forgeOwner(owner:string): {type:'forgeqa-owner';description:string} { return {type:'forgeqa-owner',description:owner}; }
