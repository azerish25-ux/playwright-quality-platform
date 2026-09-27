#!/usr/bin/env node
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse, planCommand, runCommand, doctorCommand, type Parsed } from './runner.js';
import { mergeNativeBlobReports } from './native-merge.js';
import { serveReport } from './serve.js';
import {
  ConfigurationError,
  IntegrityError,
  evaluateGates,
  sha256,
  toForgeError
} from '@azerish25-ux/forgeqa-core';
import {
  mergeShardResults,
  mergeShardEvidence,
  reconcileNativeJson,
  toHtmlReport,
  toJsonReport,
  toJUnit,
  toMarkdownSummary,
  validateShardEvidence
} from '@azerish25-ux/forgeqa-reporter';
import { analyzeHistory, createHistoryRecord, readHistoryRecords, readQuarantine } from '@azerish25-ux/forgeqa-flake-analysis';
import {
  flakesCommand,
  gateCommand,
  historyImportCommand,
  historyImportGitHubCommand,
  historyProvenance,
  quarantineAddCommand,
  quarantineRemoveCommand,
  quarantineValidateCommand,
  repeatCommand
} from './reliability-commands.js';
import { initCommand } from './init.js';

const VERSION = '0.1.0';

function jsonMode(parsed: Parsed): boolean {
  return parsed.options.get('json') === true;
}

function emit(parsed: Parsed, value: unknown, human: string): void {
  process.stdout.write(jsonMode(parsed) ? `${JSON.stringify(value)}\n` : `${human}\n`);
}

async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, content, { flag: 'wx', mode: 0o600 });
  await rename(temp, path);
}

async function loadJson(path: string): Promise<any> {
  return JSON.parse(await readFile(resolve(path), 'utf8')) as any;
}

async function directoryChecksums(root: string, path: string, output: Record<string, string>): Promise<void> {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const full = resolve(path, entry.name);
    const rel = relative(root, full).replace(/\\/g, '/');
    if (entry.isSymbolicLink()) throw new IntegrityError(`Generated report contains a symbolic link: ${rel}`);
    if (entry.isDirectory()) await directoryChecksums(root, full, output);
    else if (entry.isFile()) output[rel] = sha256(await readFile(full));
  }
}

async function reportMerge(parsed: Parsed): Promise<void> {
  const manifestPath = String(parsed.options.get('manifest') || '');
  if (!manifestPath || !parsed.positionals.length) throw new ConfigurationError('report merge requires --manifest and finalized shard report paths.');
  const manifest = await loadJson(manifestPath);
  const evidence = await Promise.all(parsed.positionals.map(path => validateShardEvidence(resolve(path))));
  const shards = evidence.map(item => item.shard);
  const merged = mergeShardResults(shards, manifest);
  merged.inventory = manifest.expected;
  const output = resolve(String(parsed.options.get('output') || 'forgeqa-results'));
  await mkdir(output, { recursive: true });
  const mergedEvidence = await mergeShardEvidence(evidence, output, merged);
  const native = await mergeNativeBlobReports(resolve(output, 'native-blob-reports'), output);
  const reconciliation = reconcileNativeJson(merged, await loadJson(native.jsonPath));
  merged.evidence = {
    artifactManifest: 'artifact-manifest.json',
    capturedArtifacts: mergedEvidence.manifest.counts.captured,
    missingArtifacts: mergedEvidence.manifest.counts.missing,
    unavailableArtifacts: mergedEvidence.manifest.counts.unavailable,
    nativeBlobCount: mergedEvidence.nativeBlobPaths.length,
    nativeReport: 'playwright-report/index.html',
    nativeJson: 'playwright-report/results.json',
    reconciliation
  };
  const quarantines = await readQuarantine(String(parsed.options.get('quarantine') || '.forgeqa/quarantine.json'));
  merged.gate = evaluateGates(merged, quarantines, {
    failOnRetryRecovered: true,
    unexpectedSkipBudget: 0,
    requireCompleteShards: true,
    maxQuarantineEntries: 20
  });
  const history = parsed.options.has('history')
    ? analyzeHistory(merged, await readHistoryRecords(String(parsed.options.get('history'))), Number(parsed.options.get('minimum-samples') || 20))
    : undefined;
  const historyRecord = createHistoryRecord(merged, historyProvenance());
  const outputs: Record<string, string> = {
    'report.json': toJsonReport(merged),
    'junit.xml': toJUnit(merged, history),
    'summary.md': toMarkdownSummary(merged, history),
    'index.html': toHtmlReport(merged, history),
    'history-record.json': `${JSON.stringify(historyRecord, null, 2)}\n`
  };
  if (history) outputs['history-analysis.json'] = `${JSON.stringify(history, null, 2)}\n`;
  await Promise.all(Object.entries(outputs).map(([name, content]) => atomicWrite(resolve(output, name), content)));
  const checksumPaths = [...Object.keys(outputs), 'artifact-manifest.json'];
  const checksums: Record<string, string> = {};
  for (const name of checksumPaths) checksums[name] = sha256(await readFile(resolve(output, name)));
  await directoryChecksums(output, resolve(output, 'playwright-report'), checksums);
  const complete = {
    schemaVersion: 1,
    runId: merged.runId,
    completion: merged.completion,
    selectionHash: merged.selectionHash,
    configHash: merged.configHash,
    expectedShards: evidence[0]?.shard.shardTotal ?? 0,
    receivedShards: evidence.length,
    expectedExecutions: manifest.expected.length,
    receivedExecutions: new Set(merged.attempts.map(attempt => attempt.executionId)).size,
    attempts: merged.attempts.length,
    gate: merged.gate.outcome,
    nativeMergeExitCode: native.runnerExitCode,
    reconciliation,
    history: history?.status ?? 'NO_BASELINE',
    checksums
  };
  await atomicWrite(resolve(output, 'complete.json'), `${JSON.stringify(complete, null, 2)}\n`);
  emit(
    parsed,
    { runId: merged.runId, output, completion: merged.completion, tests: new Set(merged.attempts.map(attempt => attempt.executionId)).size, attempts: merged.attempts.length, gate: merged.gate, evidence: merged.evidence, history: history ?? { status: 'NO_BASELINE' }, historyRecord: resolve(output, 'history-record.json') },
    `Merged ${shards.length} shards into ${output}. Native and ForgeQA evidence matched. ${merged.gate.outcome === 'pass' ? 'Quality gates passed.' : 'Quality gates failed.'}`
  );
  if (merged.completion !== 'complete') process.exitCode = 3;
  else if (merged.gate.outcome === 'fail') process.exitCode = 1;
}

async function reportServe(parsed: Parsed): Promise<void> {
  const root = String(parsed.options.get('output') || parsed.positionals[0] || 'forgeqa-results');
  const port = Number(process.env.FORGEQA_SERVE_PORT ?? '4173');
  await serveReport({ root, host: '127.0.0.1', port, json: jsonMode(parsed) });
}

function help(): string {
  return `ForgeQA ${VERSION}

Commands:
  forgeqa init [--destination DIR] [--package-manager npm|pnpm] [--dry-run] [--json]
  forgeqa doctor [--json]
  forgeqa plan [--suite NAME] [--browsers LIST] [--workers N] [--shard I/N] [--json]
  forgeqa run [selection options] [--shard I/N] [--manifest FILE] [--config FILE] [--playwright-config FILE] [--json]
  forgeqa repeat --test-id STABLE_ID [COUNT] [MAX_FAILURES] [TIME_BUDGET_MS] [selection options] [--output DIR]
  forgeqa report merge --manifest FILE --output DIR SHARD... [--history HISTORY_DIR]
  forgeqa report serve [DIR] [--output DIR] [--json]
  forgeqa history import REPORT_OR_DIR... [--output HISTORY_DIR] [--json]
  forgeqa history import-github --repository OWNER/REPO [--workflow FILE] [--artifact-name PREFIX] [--max-runs N] [--token-env NAME] [--output HISTORY_DIR]
  forgeqa flakes --report FILE [--history HISTORY_DIR] [--minimum-samples N] [--render DIR]
  forgeqa quarantine validate [--file FILE] [--report FILE|--known-tests IDS]
  forgeqa quarantine add TEST_ID OWNER REASON ISSUE EXPIRES_AT [PROJECTS] [--file FILE] [--report FILE|--known-tests IDS]
  forgeqa quarantine remove TEST_ID [PROJECTS] [--file FILE]
  forgeqa gate --report FILE
  forgeqa migrate

repeat resolves one stable ForgeQA ID to its exact source declaration, emits one result per bounded diagnostic iteration, and writes repeat-summary.json. Diagnostic records remain non-authoritative.

Exit codes: 0 compliant success, 1 quality failure, 2 usage/configuration, 3 infrastructure/report integrity, 130 interruption.
`;
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const parsed = parse(argv);
  const key = parsed.command.join(' ');
  if (parsed.options.has('version') || key === 'version') {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (!key || parsed.options.has('help') || key === 'help') {
    process.stdout.write(help());
    return;
  }
  switch (key) {
    case 'init': await initCommand(parsed); break;
    case 'doctor': await doctorCommand(parsed); break;
    case 'plan': await planCommand(parsed); break;
    case 'run': await runCommand(parsed); break;
    case 'repeat': await repeatCommand(parsed); break;
    case 'report merge': await reportMerge(parsed); break;
    case 'report serve': await reportServe(parsed); break;
    case 'history import': await historyImportCommand(parsed); break;
    case 'history import-github': await historyImportGitHubCommand(parsed); break;
    case 'gate': await gateCommand(parsed); break;
    case 'flakes': await flakesCommand(parsed); break;
    case 'quarantine validate': await quarantineValidateCommand(parsed); break;
    case 'quarantine add': await quarantineAddCommand(parsed); break;
    case 'quarantine remove': await quarantineRemoveCommand(parsed); break;
    case 'migrate': throw new ConfigurationError(`${key} requires project-specific inputs and is intentionally fail-closed in this source release.`);
    default: throw new ConfigurationError(`Unknown command: ${key}`);
  }
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  main().catch((error: unknown) => {
    const forge = toForgeError(error);
    if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify({ exitCode: forge.exitCode, error: { code: forge.code, message: forge.message, details: forge.details } })}\n`);
    else {
      process.stderr.write(`${forge.code}: ${forge.message}\n`);
      if (Object.keys(forge.details).length) process.stderr.write(`${JSON.stringify(forge.details)}\n`);
    }
    process.exitCode = forge.exitCode;
  });
}
