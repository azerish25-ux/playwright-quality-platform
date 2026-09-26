import { resolve, relative, isAbsolute } from 'node:path';
import { ConfigurationError } from './errors.js';
import { redactValue } from './redaction.js';
import { stableHash } from './stable.js';
export type BrowserName = 'chromium' | 'firefox' | 'webkit';
export interface ForgeEnvironment { baseUrl: string; variables?: Record<string, string>; }
export interface ForgeQualityGates {
  failOnRetryRecovered?: boolean;
  unexpectedSkipBudget?: number;
  maxQuarantineEntries?: number;
  requireCompleteShards?: boolean;
  durationBudgetMs?: number;
  minimumHistorySamples?: number;
  maxFlakeRate?: number;
}
export interface ForgeConfigInput {
  project: string;
  consumer?: string;
  environment?: string;
  environments: Record<string, ForgeEnvironment>;
  suites?: Record<string, string[]>;
  browsers?: BrowserName[];
  workers?: number;
  shards?: number;
  retries?: number;
  timeout?: string | number;
  outputDir?: string;
  historyDir?: string;
  quarantineFile?: string;
  qualityGates?: ForgeQualityGates;
  selectionMap?: Record<string, string[]>;
  artifactPolicy?: { trace?: string; screenshot?: string; video?: string; retentionDays?: number };
  github?: { summary?: boolean; prComment?: boolean };
}
export interface ResolveConfigOptions {
  cwd?: string;
  environment?: string;
  env?: Record<string, string | undefined>;
  cli?: Partial<Pick<ForgeConfigInput, 'workers' | 'shards' | 'retries' | 'timeout' | 'browsers' | 'outputDir'>>;
}
export interface ResolvedForgeConfig extends Omit<ForgeConfigInput, 'timeout' | 'environment'> {
  environment: string;
  timeoutMs: number;
  baseUrl: string;
  outputDir: string;
  historyDir: string;
  quarantineFile: string;
  configHash: string;
  redacted: Record<string, unknown>;
}
const allowed = new Set(['project','consumer','environment','environments','suites','browsers','workers','shards','retries','timeout','outputDir','historyDir','quarantineFile','qualityGates','selectionMap','artifactPolicy','github']);
const browsers = new Set<BrowserName>(['chromium','firefox','webkit']);
export function defineForgeConfig(input: ForgeConfigInput): ForgeConfigInput { validateInput(input); return Object.freeze({ ...input }); }
export function parseDuration(value: string | number): number {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0 || value > 86_400_000) throw new ConfigurationError(`Invalid duration: ${value}`);
    return Math.round(value);
  }
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(value.trim());
  if (!match) throw new ConfigurationError(`Invalid duration: ${value}. Use ms, s, m, or h.`);
  const amount = Number(match[1]);
  const unit = match[2] as 'ms'|'s'|'m'|'h';
  const multiplier = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 }[unit];
  const result = Math.round(amount * multiplier);
  if (result <= 0 || result > 86_400_000) throw new ConfigurationError(`Duration out of range: ${value}`);
  return result;
}
function integer(name: string, value: number, min: number, max: number): number {
  if (!Number.isInteger(value) || value < min || value > max) throw new ConfigurationError(`${name} must be an integer between ${min} and ${max}.`);
  return value;
}
function safePath(root: string, value: string, label: string): string {
  const candidate = resolve(root, value);
  const rel = relative(root, candidate);
  if (rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(rel)) throw new ConfigurationError(`${label} escapes the project root.`);
  return candidate;
}
function validateInput(input: ForgeConfigInput): void {
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new ConfigurationError(`Unknown configuration option: ${key}`);
  if (!input.project?.trim()) throw new ConfigurationError('project is required.');
  if (!input.environments || !Object.keys(input.environments).length) throw new ConfigurationError('At least one environment is required.');
  for (const [name, profile] of Object.entries(input.environments)) {
    if (!name.trim() || !profile.baseUrl) throw new ConfigurationError(`Environment ${name || '<empty>'} requires baseUrl.`);
    let url: URL; try { url = new URL(profile.baseUrl); } catch { throw new ConfigurationError(`Environment ${name} has an invalid baseUrl.`); }
    if (!['http:','https:'].includes(url.protocol)) throw new ConfigurationError(`Environment ${name} must use HTTP or HTTPS.`);
  }
  if (input.browsers) for (const browser of input.browsers) if (!browsers.has(browser)) throw new ConfigurationError(`Unsupported browser: ${browser}`);
  if (input.workers !== undefined) integer('workers', input.workers, 1, 128);
  if (input.shards !== undefined) integer('shards', input.shards, 1, 256);
  if (input.retries !== undefined) integer('retries', input.retries, 0, 3);
  if (input.timeout !== undefined) parseDuration(input.timeout);
  if (input.suites) for (const [name, tags] of Object.entries(input.suites)) {
    if (!name.trim() || !Array.isArray(tags) || !tags.length || tags.some(tag => typeof tag !== 'string' || !/^@[a-zA-Z][\w-]*$/.test(tag))) throw new ConfigurationError('Suites require nonempty arrays of @tags.');
  }
  if (input.qualityGates) {
    const keys = new Set(['failOnRetryRecovered','unexpectedSkipBudget','maxQuarantineEntries','requireCompleteShards','durationBudgetMs','minimumHistorySamples','maxFlakeRate']);
    for (const key of Object.keys(input.qualityGates)) if (!keys.has(key)) throw new ConfigurationError(`Unknown quality gate: ${key}`);
    for (const key of ['failOnRetryRecovered','requireCompleteShards'] as const) if (input.qualityGates[key] !== undefined && typeof input.qualityGates[key] !== 'boolean') throw new ConfigurationError(`${key} must be boolean.`);
    for (const key of ['unexpectedSkipBudget','maxQuarantineEntries','minimumHistorySamples'] as const) if (input.qualityGates[key] !== undefined) integer(key, input.qualityGates[key]!, 0, 1_000_000);
  }
}
export function resolveForgeConfig(input: ForgeConfigInput, options: ResolveConfigOptions = {}): ResolvedForgeConfig {
  validateInput(input);
  const env = options.env ?? process.env;
  const root = resolve(options.cwd ?? process.cwd());
  const environment = options.environment ?? env.FORGEQA_ENVIRONMENT ?? input.environment ?? Object.keys(input.environments)[0];
  if (!environment || !(environment in input.environments)) throw new ConfigurationError(`Unknown environment: ${environment ?? '<unset>'}`);
  const selected = { ...input.environments[environment]! };
  const fromEnvironment: Partial<ForgeConfigInput> = {};
  if (env.FORGEQA_WORKERS) fromEnvironment.workers = integer('FORGEQA_WORKERS', Number(env.FORGEQA_WORKERS), 1, 128);
  if (env.FORGEQA_RETRIES) fromEnvironment.retries = integer('FORGEQA_RETRIES', Number(env.FORGEQA_RETRIES), 0, 3);
  if (env.FORGEQA_SHARDS) fromEnvironment.shards = integer('FORGEQA_SHARDS', Number(env.FORGEQA_SHARDS), 1, 256);
  if (env.FORGEQA_BASE_URL) selected.baseUrl = env.FORGEQA_BASE_URL;
  try { const url = new URL(selected.baseUrl); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error(); } catch { throw new ConfigurationError('Selected base URL must be HTTP(S) without embedded credentials.'); }
  const merged = { ...input, environments: { ...input.environments, [environment]: selected }, ...fromEnvironment, ...options.cli };
  validateInput(merged as ForgeConfigInput);
  const materialized = {
    ...merged,
    consumer: merged.consumer ?? merged.project,
    environment,
    baseUrl: selected.baseUrl,
    browsers: merged.browsers ?? ['chromium'],
    workers: merged.workers ?? 1,
    shards: merged.shards ?? 1,
    retries: merged.retries ?? 0,
    timeoutMs: parseDuration(merged.timeout ?? '30s'),
    outputDir: safePath(root, merged.outputDir ?? 'forgeqa-results', 'outputDir'),
    historyDir: safePath(root, merged.historyDir ?? '.forgeqa/history', 'historyDir'),
    quarantineFile: safePath(root, merged.quarantineFile ?? '.forgeqa/quarantine.json', 'quarantineFile'),
    qualityGates: {
      failOnRetryRecovered: true,
      unexpectedSkipBudget: 0,
      maxQuarantineEntries: 20,
      requireCompleteShards: true,
      minimumHistorySamples: 20,
      ...merged.qualityGates
    },
    artifactPolicy: { trace: 'retain-on-failure', screenshot: 'only-on-failure', video: 'retain-on-failure', retentionDays: 7, ...merged.artifactPolicy },
    github: { summary: true, prComment: false, ...merged.github }
  };
  const hashInput = { ...materialized, environments: Object.fromEntries(Object.entries(materialized.environments).map(([name, profile]) => [name, { ...profile, variables: undefined }])) };
  const redacted = redactValue(hashInput) as Record<string, unknown>;
  return Object.freeze({ ...materialized, redacted, configHash: stableHash(redacted) }) as ResolvedForgeConfig;
}
