import { readFile, stat } from 'node:fs/promises';
import {
  ConfigurationError,
  IntegrityError,
  sha256,
  stableHash,
  stableStringify,
  type MergedRunResult
} from '@azerish25-ux/forgeqa-core';
import type { HistoryManifest, HistoryManifestEntry, HistoryProvenance, HistoryRecord, HistorySource } from './history-types.js';

export const DEFAULT_HISTORY_MAX_BYTES = 16 * 1024 * 1024;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function latestAttemptTime(result: MergedRunResult): string | undefined {
  let latest: string | undefined;
  for (const attempt of result.attempts) {
    if (!Number.isFinite(Date.parse(attempt.startedAt))) continue;
    if (!latest || Date.parse(attempt.startedAt) > Date.parse(latest)) latest = attempt.startedAt;
  }
  return latest;
}

export function validateHistoryResult(value: unknown): MergedRunResult {
  if (!isObject(value) || value.schemaVersion !== 1 || typeof value.runId !== 'string' || !value.runId) {
    throw new IntegrityError('History source is not a supported ForgeQA result.');
  }
  if (!isObject(value.revision) || typeof value.revision.repository !== 'string' || typeof value.revision.testedCommit !== 'string') {
    throw new IntegrityError('History source is missing revision identity.');
  }
  if (typeof value.configHash !== 'string' || typeof value.selectionHash !== 'string' || !Array.isArray(value.attempts)) {
    throw new IntegrityError('History source is missing configuration, selection, or attempts.');
  }
  return value as unknown as MergedRunResult;
}

function validateHistorySource(value: unknown): HistorySource {
  if (!isObject(value) || value.provider !== 'github-actions') throw new IntegrityError('History source metadata is invalid.');
  const integers = ['workflowId', 'workflowRunId', 'workflowRunAttempt', 'artifactId'] as const;
  for (const key of integers) if (!Number.isSafeInteger(value[key]) || Number(value[key]) < 1) throw new IntegrityError(`History source ${key} is invalid.`);
  const strings = ['repository', 'artifactName', 'event', 'headSha', 'createdAt'] as const;
  for (const key of strings) if (typeof value[key] !== 'string' || !value[key]) throw new IntegrityError(`History source ${key} is invalid.`);
  if (value.branch !== null && typeof value.branch !== 'string') throw new IntegrityError('History source branch is invalid.');
  if (value.conclusion !== null && typeof value.conclusion !== 'string') throw new IntegrityError('History source conclusion is invalid.');
  if (!Number.isFinite(Date.parse(String(value.createdAt)))) throw new IntegrityError('History source creation time is invalid.');
  return value as unknown as HistorySource;
}

function recordChecksum(result: MergedRunResult): string {
  return sha256(stableStringify(result));
}

function importIdentity(result: MergedRunResult, provenance: HistoryProvenance, source?: HistorySource): string {
  if (source?.provider === 'github-actions') {
    return stableHash({
      provider: source.provider,
      repository: source.repository,
      workflowRunId: source.workflowRunId,
      workflowRunAttempt: source.workflowRunAttempt,
      artifactId: source.artifactId,
      artifactName: source.artifactName,
      provenance
    });
  }
  return stableHash({
    repository: result.revision.repository,
    runId: result.runId,
    testedCommit: result.revision.testedCommit,
    provenance
  });
}

export function createHistoryRecord(
  result: MergedRunResult,
  provenance: HistoryProvenance,
  importedAt = new Date().toISOString(),
  source?: HistorySource
): HistoryRecord {
  validateHistoryResult(result);
  if (!Number.isFinite(Date.parse(importedAt))) throw new ConfigurationError('History import time must be a valid ISO timestamp.');
  if (source) validateHistorySource(source);
  return {
    schemaVersion: 1,
    importKey: importIdentity(result, provenance, source),
    provenance,
    importedAt,
    observedAt: latestAttemptTime(result) ?? source?.createdAt ?? importedAt,
    result,
    checksum: recordChecksum(result),
    ...(source ? { source } : {})
  };
}

export function validateHistoryRecord(value: unknown): HistoryRecord {
  if (!isObject(value) || value.schemaVersion !== 1) throw new IntegrityError('Unsupported history schema.');
  if (typeof value.importKey !== 'string' || typeof value.provenance !== 'string' || typeof value.importedAt !== 'string' || typeof value.observedAt !== 'string' || typeof value.checksum !== 'string') {
    throw new IntegrityError('History record metadata is incomplete.');
  }
  if (!['trusted-default-branch', 'untrusted-pr', 'synthetic', 'diagnostic'].includes(value.provenance)) {
    throw new IntegrityError('History provenance is invalid.');
  }
  const result = validateHistoryResult(value.result);
  const record = value as unknown as HistoryRecord;
  const source = value.source === undefined ? undefined : validateHistorySource(value.source);
  if (recordChecksum(result) !== record.checksum) throw new IntegrityError('History checksum mismatch.');
  if (importIdentity(result, record.provenance, source) !== record.importKey) throw new IntegrityError('History import identity mismatch.');
  if (!Number.isFinite(Date.parse(record.importedAt)) || !Number.isFinite(Date.parse(record.observedAt))) {
    throw new IntegrityError('History timestamps are invalid.');
  }
  return record;
}

export function historyManifestChecksum(entries: HistoryManifestEntry[]): string {
  return sha256(stableStringify(entries));
}

export function emptyHistoryManifest(now: Date): HistoryManifest {
  const entries: HistoryManifestEntry[] = [];
  return { schemaVersion: 1, updatedAt: now.toISOString(), entries, checksum: historyManifestChecksum(entries) };
}

export function validateHistoryManifest(value: unknown): HistoryManifest {
  if (!isObject(value) || value.schemaVersion !== 1 || typeof value.updatedAt !== 'string' || !Array.isArray(value.entries) || typeof value.checksum !== 'string') {
    throw new IntegrityError('History manifest is invalid.');
  }
  const manifest = value as unknown as HistoryManifest;
  const keys = new Set<string>();
  for (const entry of manifest.entries) {
    if (!entry.importKey || !entry.file || !entry.runId || !entry.repository || !entry.testedCommit || !entry.observedAt || !entry.checksum) {
      throw new IntegrityError('History manifest entry is incomplete.');
    }
    if (entry.source) validateHistorySource(entry.source);
    if (keys.has(entry.importKey)) throw new IntegrityError('History manifest contains duplicate import identities.');
    keys.add(entry.importKey);
  }
  if (historyManifestChecksum(manifest.entries) !== manifest.checksum) throw new IntegrityError('History manifest checksum mismatch.');
  return manifest;
}

export async function readBoundedHistoryJson(path: string, maxBytes = DEFAULT_HISTORY_MAX_BYTES): Promise<unknown> {
  const fileStat = await stat(path);
  if (!fileStat.isFile() || fileStat.size < 2 || fileStat.size > maxBytes) {
    throw new IntegrityError(`History source is not a bounded regular JSON file: ${path}`);
  }
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown;
  } catch (error) {
    throw new IntegrityError(`History source is not valid JSON: ${path}`, { message: error instanceof Error ? error.message : String(error) });
  }
}

export function isHistoryRecordValue(value: unknown): boolean {
  return isObject(value) && value.schemaVersion === 1 && 'result' in value && 'checksum' in value && 'importKey' in value;
}
