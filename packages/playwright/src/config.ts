import { defineConfig, type PlaywrightTestConfig as TestConfig } from '@playwright/test';
import { resolveForgeConfig, ConfigurationError, type ForgeConfigInput, type ResolveConfigOptions } from '@azerish25-ux/forgeqa-core';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
export interface RunRequest {
  runId: string; runDir: string; mode: 'discover' | 'run'; suite: string;
  options: ResolveConfigOptions; manifestPath?: string;
}
export function readRunRequest(): RunRequest | undefined {
  const path = process.env.FORGEQA_RUN_REQUEST;
  if (!path) return undefined;
  const value = JSON.parse(readFileSync(path, 'utf8')) as RunRequest;
  if (!value.runId || !value.runDir || !['discover','run'].includes(value.mode)) throw new ConfigurationError('Invalid ForgeQA run request.');
  return value;
}
/** Preserve native projects, dependencies, fixtures, webServer, and assertions. */
export function defineForgePlaywrightConfig(input: ForgeConfigInput, native: TestConfig = {}): TestConfig {
  const request = readRunRequest();
  const config = resolveForgeConfig(input, request?.options ?? {});
  const runId = request?.runId ?? process.env.FORGEQA_RUN_ID ?? randomUUID();
  process.env.FORGEQA_RUN_ID = runId;
  const runDir = request?.runDir ?? resolve(config.outputDir, runId);
  const projects = native.projects ?? (config.browsers ?? ['chromium']).map(browser => ({ name: browser, use: { browserName: browser } }));
  const selected = request?.options.cli?.browsers;
  const actualProjects = selected ? projects.filter(project => !project.use?.browserName || selected.includes(project.use.browserName)) : projects;
  const configured = native.reporter === undefined ? [['list'] as [string]] : typeof native.reporter === 'string' ? [[native.reporter] as [string]] : native.reporter.map(entry => [entry[0], entry[1]] as [string, Record<string, unknown>?]);
  if (request?.mode !== 'discover' && !configured.some(([name]) => name === 'blob')) configured.push(['blob', { outputDir: resolve(runDir, 'blob-report') }]);
  if (!configured.some(([name]) => name === '@azerish25-ux/forgeqa-playwright/reporter')) configured.push(['@azerish25-ux/forgeqa-playwright/reporter']);
  return defineConfig({
    ...native,
    forbidOnly: true,
    failOnFlakyTests: config.qualityGates?.failOnRetryRecovered ?? true,
    workers: config.workers ?? 1,
    retries: config.retries ?? 0,
    timeout: config.timeoutMs,
    outputDir: resolve(runDir, 'artifacts'),
    use: { ...native.use, baseURL: config.baseUrl,
      trace: (config.artifactPolicy?.trace ?? 'retain-on-failure') as 'retain-on-failure',
      screenshot: (config.artifactPolicy?.screenshot ?? 'only-on-failure') as 'only-on-failure',
      video: (config.artifactPolicy?.video ?? 'retain-on-failure') as 'retain-on-failure' },
    projects: actualProjects,
    reporter: configured,
    metadata: { ...native.metadata, forgeqa: {
      schemaVersion: 1, runId, runDir, root: process.cwd(),
      config: { ...config, environments: Object.fromEntries(Object.entries(config.environments).map(([k,v])=>[k,{baseUrl:v.baseUrl}])) },
      mode: request?.mode ?? 'run', ...(request?.manifestPath ? { manifestPath: request.manifestPath } : {})
    } }
  });
}
