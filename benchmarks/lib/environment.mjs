import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { arch, cpus, freemem, platform, release, totalmem } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(new URL('../../package.json', import.meta.url));

function packageVersion(name) {
  try {
    return require(`${name}/package.json`).version;
  } catch {
    return null;
  }
}

export function sourceRevision() {
  const explicit = process.env.FORGEQA_SOURCE_SHA ?? process.env.GITHUB_SHA;
  if (explicit) return explicit;
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: resolve(root),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return 'local-uncommitted';
  }
}

export function environmentSnapshot() {
  const cpuModels = [...new Set(cpus().map((cpu) => cpu.model.trim()).filter(Boolean))];
  return {
    nodeVersion: process.version,
    packageManagerUserAgent: process.env.npm_config_user_agent ?? null,
    playwrightVersion: packageVersion('@playwright/test'),
    platform: platform(),
    architecture: arch(),
    operatingSystemRelease: release(),
    cpuCount: cpus().length,
    cpuModels,
    totalMemoryBytes: totalmem(),
    freeMemoryBytesAtCapture: freemem(),
    runnerEnvironment: process.env.RUNNER_ENVIRONMENT ?? null,
    runnerImage: process.env.ImageOS ?? process.env.RUNNER_OS ?? null,
    runnerName: process.env.RUNNER_NAME ?? null,
    githubRunId: process.env.GITHUB_RUN_ID ?? null,
    githubRunAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
    cacheState: process.env.BENCHMARK_CACHE_STATE ?? 'disabled',
  };
}

function numericEnvironment(name) {
  const value = process.env[name];
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function difference(start, end) {
  if (start === null || end === null) return null;
  return Math.max(0, end - start);
}

export function workflowStageDurations(executionStartedMs, completedMs = Date.now()) {
  const jobStarted = numericEnvironment('BENCHMARK_JOB_STARTED_MS');
  const installed = numericEnvironment('BENCHMARK_INSTALL_COMPLETED_MS');
  const built = numericEnvironment('BENCHMARK_BUILD_COMPLETED_MS');
  const browserReady = numericEnvironment('BENCHMARK_BROWSER_COMPLETED_MS');
  const databaseReady = numericEnvironment('BENCHMARK_DATABASE_COMPLETED_MS');
  return {
    installMs: difference(jobStarted, installed),
    buildMs: difference(installed, built),
    browserInstallMs: difference(built, browserReady),
    databaseSetupMs: difference(browserReady ?? built, databaseReady),
    preExecutionSetupMs: difference(jobStarted, executionStartedMs),
    jobElapsedMs: difference(jobStarted, completedMs),
  };
}

export function benchmarkStartedAt(fallbackMs = Date.now()) {
  const jobStarted = numericEnvironment('BENCHMARK_JOB_STARTED_MS');
  return new Date(jobStarted ?? fallbackMs).toISOString();
}
