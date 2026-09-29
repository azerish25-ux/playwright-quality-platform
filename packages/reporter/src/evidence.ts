import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, readdir, realpath, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  IntegrityError, RESULT_SCHEMA_VERSION, sha256,
  type ArtifactManifest, type ArtifactManifestEntry, type ArtifactRecord,
  type AttemptOutcome, type EvidenceFileRecord, type MergedRunResult,
  type NativeReportReconciliation, type ShardResult
} from '@azerish25-ux/forgeqa-core';
import { readFinalizedShard } from './journal.js';

const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
const MAX_BLOB_BYTES = 512 * 1024 * 1024;
const MAX_JSON_BYTES = 64 * 1024 * 1024;

interface InspectedFile extends EvidenceFileRecord { absolutePath: string; }
export interface ValidatedShardEvidence {
  root: string;
  shard: ShardResult;
  finalizedReport: InspectedFile;
  journal: InspectedFile;
  completionMarker: InspectedFile;
  nativeBlob: InspectedFile;
  entries: ArtifactManifestEntry[];
}
export interface MergedEvidence {
  manifest: ArtifactManifest;
  manifestPath: string;
  nativeBlobPaths: string[];
}

function inside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
function normalizedRelative(root: string, absolutePath: string): string {
  const rel = relative(root, absolutePath);
  if (!inside(root, absolutePath) || rel.includes('\0')) throw new IntegrityError(`Evidence path escapes its owned root: ${absolutePath}`);
  return rel.replace(/\\/g, '/');
}
async function inspectFile(root: string, candidate: string, maxBytes: number, allowEmpty = false): Promise<InspectedFile> {
  if (!candidate || candidate.includes('\0')) throw new IntegrityError('Evidence path is empty or invalid.');
  const absolutePath = isAbsolute(candidate) ? resolve(candidate) : resolve(root, candidate);
  const path = normalizedRelative(resolve(root), absolutePath);
  const stat = await lstat(absolutePath);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new IntegrityError(`Evidence is not a regular owned file: ${path}`);
  if ((!allowEmpty && stat.size === 0) || stat.size > maxBytes) throw new IntegrityError(`Evidence size is invalid for ${path}: ${stat.size} bytes.`);
  const realRoot = await realpath(resolve(root));
  const realFile = await realpath(absolutePath);
  if (!inside(realRoot, realFile)) throw new IntegrityError(`Evidence resolves outside its owned root: ${path}`);
  const bytes = await readFile(absolutePath);
  return { path, size: stat.size, sha256: sha256(bytes), absolutePath };
}
async function atomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  await rename(temporary, path);
}
async function readJson(path: string): Promise<unknown> {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_JSON_BYTES) throw new IntegrityError(`Invalid JSON evidence: ${path}`);
  try { return JSON.parse(await readFile(path, 'utf8')) as unknown; }
  catch (error) { throw new IntegrityError(`Unreadable JSON evidence: ${path}`, { cause: error instanceof Error ? error.message : String(error) }); }
}
async function collectBlobFiles(path: string, files: string[] = []): Promise<string[]> {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = resolve(path, entry.name);
    if (entry.isSymbolicLink()) throw new IntegrityError(`Symbolic links are forbidden in blob evidence: ${child}`);
    if (entry.isDirectory()) await collectBlobFiles(child, files);
    else if (entry.isFile() && entry.name.endsWith('.zip')) files.push(child);
  }
  return files;
}
function markerObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new IntegrityError('Shard completion marker must be an object.');
  return value as Record<string, unknown>;
}

export async function validateShardEvidence(finalizedPath: string): Promise<ValidatedShardEvidence> {
  const absoluteFinalizedPath = resolve(finalizedPath);
  const root = dirname(absoluteFinalizedPath);
  const shard = await readFinalizedShard(absoluteFinalizedPath);
  const finalizedReport = await inspectFile(root, absoluteFinalizedPath, MAX_JSON_BYTES);
  const journalPath = absoluteFinalizedPath.replace(/\.final\.json$/, '');
  if (journalPath === absoluteFinalizedPath) throw new IntegrityError('Expected an attempts.ndjson.final.json shard report.');
  const journal = await inspectFile(root, journalPath, MAX_JSON_BYTES);
  if (journal.sha256 !== shard.journalSha256) throw new IntegrityError(`Shard ${shard.shardId} journal checksum mismatch.`);

  const completionPath = resolve(root, 'shard-complete.json');
  const completionMarker = await inspectFile(root, completionPath, MAX_JSON_BYTES);
  const marker = markerObject(await readJson(completionPath));
  if (marker['schemaVersion'] !== RESULT_SCHEMA_VERSION || marker['runId'] !== shard.runId || marker['shardId'] !== shard.shardId || marker['shardIndex'] !== shard.shardIndex || marker['shardTotal'] !== shard.shardTotal || marker['selectionHash'] !== shard.selectionHash || marker['configHash'] !== shard.configHash || marker['reportSha256'] !== finalizedReport.sha256) {
    throw new IntegrityError(`Shard ${shard.shardId} completion marker is incompatible with its finalized report.`);
  }

  const blobDirectory = resolve(root, 'blob-report');
  const blobFiles = await collectBlobFiles(blobDirectory);
  if (blobFiles.length !== 1) throw new IntegrityError(`Shard ${shard.shardId} must contain exactly one Playwright blob report; found ${blobFiles.length}.`);
  const nativeBlob = await inspectFile(root, blobFiles[0]!, MAX_BLOB_BYTES);

  const entries: ArtifactManifestEntry[] = [];
  const capturedPaths = new Set<string>();
  for (const attempt of shard.attempts) {
    for (const artifact of attempt.artifacts ?? []) {
      const sourcePath = artifact.path.replace(/\\/g, '/');
      const base = {
        shardId: shard.shardId,
        shardIndex: shard.shardIndex,
        attemptId: attempt.attemptId,
        executionId: attempt.executionId,
        logicalTestId: attempt.logicalTestId,
        type: artifact.type,
        state: artifact.state,
        path: sourcePath,
        sourcePath
      } satisfies Omit<ArtifactManifestEntry, 'size' | 'sha256'>;
      if (artifact.state !== 'captured') {
        entries.push({ ...base, ...(artifact.size === undefined ? {} : { size: artifact.size }), ...(artifact.sha256 === undefined ? {} : { sha256: artifact.sha256 }) });
        continue;
      }
      if (!sourcePath) throw new IntegrityError(`Captured artifact ${attempt.attemptId}/${artifact.type} has no path.`);
      if (capturedPaths.has(sourcePath)) throw new IntegrityError(`Shard ${shard.shardId} declares duplicate captured artifact path ${sourcePath}.`);
      capturedPaths.add(sourcePath);
      const file = await inspectFile(root, sourcePath, MAX_ARTIFACT_BYTES, true);
      if (artifact.size !== undefined && artifact.size !== file.size) throw new IntegrityError(`Artifact size changed after capture: ${sourcePath}`);
      if (artifact.sha256 !== undefined && artifact.sha256 !== file.sha256) throw new IntegrityError(`Artifact checksum changed after capture: ${sourcePath}`);
      entries.push({ ...base, path: file.path, sourcePath: file.path, size: file.size, sha256: file.sha256 });
    }
  }
  entries.sort((a, b) => a.attemptId.localeCompare(b.attemptId) || a.type.localeCompare(b.type) || a.sourcePath.localeCompare(b.sourcePath));
  return { root, shard, finalizedReport, journal, completionMarker, nativeBlob, entries };
}

async function copyChecked(source: InspectedFile, destination: string): Promise<InspectedFile> {
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  await copyFile(source.absolutePath, destination, constants.COPYFILE_EXCL);
  const copied = await inspectFile(dirname(destination), basename(destination), Math.max(source.size, 1), source.size === 0);
  if (copied.size !== source.size || copied.sha256 !== source.sha256) throw new IntegrityError(`Copied evidence failed verification: ${destination}`);
  return { ...copied, absolutePath: destination };
}
function stateCounts(): ArtifactManifest['counts'] {
  return { captured: 0, missing: 0, disabled: 0, inapplicable: 0, unavailable: 0 };
}

export async function mergeShardEvidence(evidence: ValidatedShardEvidence[], output: string, run: MergedRunResult): Promise<MergedEvidence> {
  if (!evidence.length) throw new IntegrityError('No validated shard evidence was supplied.');
  const outputRoot = resolve(output);
  await mkdir(outputRoot, { recursive: true, mode: 0o700 });
  const attempts = new Map(run.attempts.map(attempt => [attempt.attemptId, attempt]));
  const entries: ArtifactManifestEntry[] = [];
  const nativeBlobs: ArtifactManifest['nativeBlobs'] = [];
  const nativeBlobPaths: string[] = [];
  const counts = stateCounts();

  for (const item of [...evidence].sort((a, b) => a.shard.shardIndex - b.shard.shardIndex)) {
    const shardName = `shard-${item.shard.shardIndex}-of-${item.shard.shardTotal}`;
    const blobDestination = resolve(outputRoot, 'native-blob-reports', `${shardName}-${basename(item.nativeBlob.path)}`);
    const copiedBlob = await copyChecked(item.nativeBlob, blobDestination);
    nativeBlobPaths.push(copiedBlob.absolutePath);
    nativeBlobs.push({ shardId: item.shard.shardId, shardIndex: item.shard.shardIndex, path: normalizedRelative(outputRoot, copiedBlob.absolutePath), size: copiedBlob.size, sha256: copiedBlob.sha256 });

    for (const entry of item.entries) {
      counts[entry.state] += 1;
      if (entry.state !== 'captured') { entries.push(entry); continue; }
      const source = await inspectFile(item.root, entry.sourcePath, MAX_ARTIFACT_BYTES, true);
      const destination = resolve(outputRoot, 'artifacts', shardName, entry.sourcePath);
      if (!inside(outputRoot, destination)) throw new IntegrityError(`Merged artifact destination escapes output: ${entry.sourcePath}`);
      const copied = await copyChecked(source, destination);
      const destinationPath = normalizedRelative(outputRoot, copied.absolutePath);
      const attempt = attempts.get(entry.attemptId);
      const artifact = attempt?.artifacts?.find(candidate => candidate.state === 'captured' && candidate.type === entry.type && candidate.path.replace(/\\/g, '/') === entry.sourcePath);
      if (!artifact) throw new IntegrityError(`Merged run is missing artifact ownership for ${entry.attemptId}/${entry.sourcePath}.`);
      artifact.path = destinationPath;
      artifact.size = copied.size;
      artifact.sha256 = copied.sha256;
      entries.push({ ...entry, path: destinationPath, size: copied.size, sha256: copied.sha256 });
    }
  }

  const manifest: ArtifactManifest = {
    schemaVersion: RESULT_SCHEMA_VERSION,
    runId: run.runId,
    generatedAt: new Date().toISOString(),
    entries: entries.sort((a, b) => a.shardIndex - b.shardIndex || a.attemptId.localeCompare(b.attemptId) || a.type.localeCompare(b.type)),
    nativeBlobs,
    counts
  };
  const manifestPath = resolve(outputRoot, 'artifact-manifest.json');
  await atomicJson(manifestPath, manifest);
  return { manifest, manifestPath, nativeBlobPaths };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function asArray(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function outcome(status: unknown, expectedStatus: unknown): AttemptOutcome {
  if (status === 'skipped') return 'skipped';
  if (status === 'interrupted') return 'cancelled';
  if (status === 'passed') return expectedStatus === 'passed' || expectedStatus === undefined ? 'passed' : 'unexpected-pass';
  if (status === expectedStatus) return 'expected-failure';
  if (status === 'timedOut') return 'timed-out';
  return 'failed';
}
function outcomeCounts(): Record<AttemptOutcome, number> {
  return { passed: 0, failed: 0, 'timed-out': 0, skipped: 0, 'expected-failure': 0, 'unexpected-pass': 0, cancelled: 0 };
}
function sortedRecord(record: Record<string, number>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b))));
}

export function reconcileNativeJson(run: MergedRunResult, nativeJson: unknown): NativeReportReconciliation {
  const root = asRecord(nativeJson);
  if (!root) throw new IntegrityError('Native Playwright JSON report must be an object.');
  let nativeTests = 0;
  let nativeAttempts = 0;
  const nativeOutcomes = outcomeCounts();
  const nativeProjects: Record<string, number> = {};
  const visitSuite = (value: unknown): void => {
    const suite = asRecord(value);
    if (!suite) return;
    for (const child of asArray(suite['suites'])) visitSuite(child);
    for (const specValue of asArray(suite['specs'])) {
      const spec = asRecord(specValue);
      if (!spec) continue;
      for (const testValue of asArray(spec['tests'])) {
        const nativeTest = asRecord(testValue);
        if (!nativeTest) continue;
        nativeTests += 1;
        const project = typeof nativeTest['projectName'] === 'string' ? nativeTest['projectName'] : '';
        nativeProjects[project] = (nativeProjects[project] ?? 0) + 1;
        for (const resultValue of asArray(nativeTest['results'])) {
          const result = asRecord(resultValue);
          if (!result) continue;
          nativeAttempts += 1;
          nativeOutcomes[outcome(result['status'], nativeTest['expectedStatus'])] += 1;
        }
      }
    }
  };
  for (const suite of asArray(root['suites'])) visitSuite(suite);

  const forgeOutcomes = outcomeCounts();
  for (const attempt of run.attempts) forgeOutcomes[attempt.outcome] += 1;
  const executions = new Map<string, string>();
  for (const attempt of run.attempts) executions.set(attempt.executionId, attempt.project ?? '');
  const forgeProjects: Record<string, number> = {};
  for (const project of executions.values()) forgeProjects[project] = (forgeProjects[project] ?? 0) + 1;
  const forgeTests = executions.size;
  const forgeAttempts = run.attempts.length;
  if (nativeTests !== forgeTests || nativeAttempts !== forgeAttempts || sortedRecord(nativeOutcomes) !== sortedRecord(forgeOutcomes) || sortedRecord(nativeProjects) !== sortedRecord(forgeProjects)) {
    throw new IntegrityError('Native Playwright report disagrees with the canonical Deadpan result.', { nativeTests, forgeTests, nativeAttempts, forgeAttempts, nativeOutcomes, forgeOutcomes, nativeProjects, forgeProjects });
  }
  return { status: 'MATCHED', forgeqaTests: forgeTests, nativeTests, forgeqaAttempts: forgeAttempts, nativeAttempts, outcomes: forgeOutcomes, projects: forgeProjects };
}
