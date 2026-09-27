import { lstat, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { runCommand, type Parsed } from './runner.js';
import {
  ConfigurationError,
  IntegrityError,
  evaluateGates,
  type MergedRunResult,
  type QuarantineRecord
} from '@azerish25-ux/forgeqa-core';
import {
  addQuarantine,
  analyzeHistory,
  calculateReliability,
  createHistoryRecord,
  importHistory,
  readHistoryRecords,
  readQuarantine,
  removeQuarantine,
  validateQuarantine,
  type HistoryProvenance
} from '@azerish25-ux/forgeqa-flake-analysis';

function jsonMode(parsed: Parsed): boolean {
  return parsed.options.get('json') === true;
}

function emit(parsed: Parsed, value: unknown, human: string): void {
  process.stdout.write(jsonMode(parsed) ? `${JSON.stringify(value)}\n` : `${human}\n`);
}

async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, content, { flag: 'wx', mode: 0o600 });
  await rename(temp, path);
}

async function loadRun(path: string): Promise<MergedRunResult> {
  const value = JSON.parse(await readFile(resolve(path), 'utf8')) as MergedRunResult;
  if (value.schemaVersion !== 1 || !value.runId || !value.revision?.repository || !Array.isArray(value.attempts)) {
    throw new IntegrityError(`Invalid ForgeQA report: ${path}`);
  }
  return value;
}

export function historyProvenance(): HistoryProvenance {
  const explicit = process.env.FORGEQA_HISTORY_PROVENANCE;
  if (explicit && ['trusted-default-branch', 'untrusted-pr', 'synthetic', 'diagnostic'].includes(explicit)) return explicit as HistoryProvenance;
  if (process.env.GITHUB_EVENT_NAME === 'pull_request' || process.env.GITHUB_EVENT_NAME === 'pull_request_target') return 'untrusted-pr';
  return 'trusted-default-branch';
}

export async function gateCommand(parsed: Parsed): Promise<void> {
  const run = await loadRun(String(parsed.options.get('report') || parsed.positionals[0] || ''));
  const quarantines = await readQuarantine(String(parsed.options.get('quarantine') || '.forgeqa/quarantine.json'));
  const decision = evaluateGates(run, quarantines, {
    failOnRetryRecovered: true,
    unexpectedSkipBudget: 0,
    requireCompleteShards: true,
    maxQuarantineEntries: 20
  });
  emit(parsed, decision, decision.violations.length ? decision.violations.map(violation => `${violation.severity.toUpperCase()} ${violation.id}: ${violation.message}`).join('\n') : 'All quality gates passed.');
  if (decision.outcome === 'fail') process.exitCode = 1;
}

export async function flakesCommand(parsed: Parsed): Promise<void> {
  const reportPath = String(parsed.options.get('report') || parsed.positionals[0] || '');
  if (!reportPath) throw new ConfigurationError('flakes requires --report FILE.');
  const run = await loadRun(reportPath);
  const minimumSamples = Number(parsed.options.get('minimum-samples') || 20);
  if (parsed.options.has('output')) {
    const records = await readHistoryRecords(String(parsed.options.get('output')));
    const analysis = analyzeHistory(run, records, minimumSamples);
    emit(parsed, analysis, JSON.stringify(analysis, null, 2));
    return;
  }
  const metrics = calculateReliability(run.attempts, minimumSamples);
  emit(parsed, metrics, JSON.stringify(metrics, null, 2));
}

export async function historyImportCommand(parsed: Parsed): Promise<void> {
  const sources = [...parsed.positionals];
  if (parsed.options.has('report')) sources.push(String(parsed.options.get('report')));
  if (!sources.length) sources.push('forgeqa-results');
  const root = String(parsed.options.get('output') || '.forgeqa/history');
  const result = await importHistory(root, sources, { provenance: historyProvenance() });
  emit(parsed, result, `Imported ${result.imported} history record(s), skipped ${result.skipped} duplicate(s), and pruned ${result.pruned}.\nManifest: ${result.manifestPath}`);
}

async function knownTests(parsed: Parsed, records?: QuarantineRecord[]): Promise<string[]> {
  if (parsed.options.has('known-tests')) return String(parsed.options.get('known-tests')).split(',').map(value => value.trim()).filter(Boolean);
  if (parsed.options.has('report')) {
    const run = await loadRun(String(parsed.options.get('report')));
    return [...new Set([
      ...run.attempts.map(attempt => attempt.logicalTestId),
      ...(run.inventory?.map(item => item.logicalTestId) ?? [])
    ])].sort();
  }
  if (records) return [...new Set(records.map(record => record.testId))].sort();
  throw new ConfigurationError('Provide --report FILE or --known-tests ID1,ID2 so quarantine operations can reject unknown tests.');
}

export async function quarantineValidateCommand(parsed: Parsed): Promise<void> {
  const file = String(parsed.options.get('file') || '.forgeqa/quarantine.json');
  const records = await readQuarantine(file);
  const tests = await knownTests(parsed, records);
  const result = validateQuarantine(records, tests);
  emit(parsed, result, result.errors.concat(result.warnings).join('\n') || 'Quarantine policy is valid.');
  if (!result.valid) process.exitCode = 1;
}

export async function quarantineAddCommand(parsed: Parsed): Promise<void> {
  const [testId, owner, reason, issue, expiresAt, projectsValue] = parsed.positionals;
  if (!testId || !owner || !reason || !issue || !expiresAt) {
    throw new ConfigurationError('quarantine add requires TEST_ID OWNER REASON ISSUE EXPIRES_AT [PROJECTS].');
  }
  const file = String(parsed.options.get('file') || '.forgeqa/quarantine.json');
  const tests = await knownTests(parsed);
  const record: QuarantineRecord = {
    schemaVersion: 1,
    testId,
    owner,
    reason,
    issue,
    createdAt: new Date().toISOString(),
    expiresAt,
    ...(projectsValue ? { projects: projectsValue.split(',').map(project => project.trim()).filter(Boolean) } : {})
  };
  const result = await addQuarantine(file, record, tests);
  emit(parsed, result, `Added quarantine metadata for ${testId}. The test remains selected and blocking.\nFile: ${result.file}`);
}

export async function quarantineRemoveCommand(parsed: Parsed): Promise<void> {
  const [testId, projectsValue] = parsed.positionals;
  if (!testId) throw new ConfigurationError('quarantine remove requires TEST_ID [PROJECTS].');
  const file = String(parsed.options.get('file') || '.forgeqa/quarantine.json');
  const projects = projectsValue ? projectsValue.split(',').map(project => project.trim()).filter(Boolean) : undefined;
  const result = await removeQuarantine(file, testId, projects);
  emit(parsed, result, result.changed ? `Removed quarantine metadata for ${testId}.` : `No matching quarantine metadata existed for ${testId}.`);
}

async function newestRunDirectory(root: string): Promise<string | undefined> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const candidates = entries.filter(entry => entry.isDirectory() && entry.name.startsWith('run-')).map(entry => resolve(root, entry.name));
    let newest: { path: string; time: number } | undefined;
    for (const path of candidates) {
      const value = await lstat(path);
      if (!newest || value.mtimeMs > newest.time) newest = { path, time: value.mtimeMs };
    }
    return newest?.path;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export async function repeatCommand(parsed: Parsed): Promise<void> {
  const count = Number(parsed.positionals[0] ?? 10);
  const maxFailures = Number(parsed.positionals[1] ?? 1);
  const timeBudgetMs = Number(parsed.positionals[2] ?? 600_000);
  if (!Number.isInteger(count) || count < 1 || count > 100) throw new ConfigurationError('repeat COUNT must be an integer between 1 and 100.');
  if (!Number.isInteger(maxFailures) || maxFailures < 1 || maxFailures > count) throw new ConfigurationError('repeat MAX_FAILURES must be between 1 and COUNT.');
  if (!Number.isFinite(timeBudgetMs) || timeBudgetMs < 1_000 || timeBudgetMs > 3_600_000) throw new ConfigurationError('repeat TIME_BUDGET_MS must be between 1000 and 3600000.');
  if (parsed.options.has('shard') || parsed.options.has('manifest')) throw new ConfigurationError('repeat operates on one complete local selection; distributed shard flags are not accepted.');
  const root = resolve(String(parsed.options.get('output') || 'forgeqa-repeat'));
  await mkdir(root, { recursive: true, mode: 0o700 });
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const iterations: Array<{ index: number; exitCode: number; runDir?: string; report?: string; historyRecord?: string }> = [];
  let failures = 0;
  let terminalCode = 0;
  for (let index = 1; index <= count; index += 1) {
    if (Date.now() - started >= timeBudgetMs) break;
    const iterationRoot = resolve(root, `iteration-${String(index).padStart(3, '0')}`);
    const options = new Map(parsed.options);
    options.set('output', iterationRoot);
    options.set('retries', '0');
    const iteration: Parsed = { command: ['run'], options, positionals: [] };
    process.exitCode = 0;
    await runCommand(iteration);
    const exitCode = Number(process.exitCode ?? 0);
    process.exitCode = 0;
    const runDir = await newestRunDirectory(iterationRoot);
    const report = runDir ? resolve(runDir, 'report.json') : undefined;
    let historyRecordPath: string | undefined;
    if (report) {
      try {
        const result = await loadRun(report);
        const record = createHistoryRecord(result, 'diagnostic');
        historyRecordPath = resolve(runDir!, 'history-record.json');
        await atomicWrite(historyRecordPath, `${JSON.stringify(record, null, 2)}\n`);
      } catch (error) {
        if (exitCode === 0) throw error;
      }
    }
    iterations.push({ index, exitCode, ...(runDir ? { runDir } : {}), ...(report ? { report } : {}), ...(historyRecordPath ? { historyRecord: historyRecordPath } : {}) });
    if (exitCode !== 0) {
      failures += 1;
      terminalCode = exitCode;
      if (exitCode === 130 || exitCode === 3 || failures >= maxFailures) break;
    }
  }
  const summary = {
    schemaVersion: 1,
    provenance: 'diagnostic',
    startedAt,
    finishedAt: new Date().toISOString(),
    requestedIterations: count,
    completedIterations: iterations.length,
    failures,
    maxFailures,
    timeBudgetMs,
    firstFailure: iterations.find(iteration => iteration.exitCode !== 0) ?? null,
    iterations
  };
  const summaryPath = resolve(root, 'repeat-summary.json');
  await atomicWrite(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  emit(parsed, { ...summary, summaryPath }, `Completed ${iterations.length}/${count} diagnostic repetition(s) with ${failures} failure(s).\nSummary: ${summaryPath}`);
  if (terminalCode === 130) process.exitCode = 130;
  else if (terminalCode === 3) process.exitCode = 3;
  else if (failures) process.exitCode = 1;
}
