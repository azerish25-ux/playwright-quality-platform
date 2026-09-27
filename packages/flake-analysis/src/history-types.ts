import type { MergedRunResult } from '@azerish25-ux/forgeqa-core';
import type { RunComparison } from './compare.js';
import type { ReliabilityMetrics, TestReliability } from './metrics.js';

export type HistoryProvenance = 'trusted-default-branch' | 'untrusted-pr' | 'synthetic' | 'diagnostic';

export interface HistoryRecord {
  schemaVersion: 1;
  importKey: string;
  provenance: HistoryProvenance;
  importedAt: string;
  observedAt: string;
  result: MergedRunResult;
  checksum: string;
}

export interface HistoryManifestEntry {
  importKey: string;
  file: string;
  runId: string;
  repository: string;
  testedCommit: string;
  provenance: HistoryProvenance;
  observedAt: string;
  checksum: string;
}

export interface HistoryManifest {
  schemaVersion: 1;
  updatedAt: string;
  entries: HistoryManifestEntry[];
  checksum: string;
}

export interface ImportHistoryOptions {
  provenance?: HistoryProvenance;
  now?: Date;
  maxBytes?: number;
  maxRecords?: number;
  maxAgeDays?: number;
}

export interface ImportHistoryResult {
  imported: number;
  skipped: number;
  pruned: number;
  manifestPath: string;
  importedKeys: string[];
}

export interface HistorySelectionOptions {
  provenance?: HistoryProvenance;
  windowDays?: number;
  maxRuns?: number;
  now?: Date;
}

export interface HistorySelection {
  records: HistoryRecord[];
  rejected: Record<string, number>;
  windowStart: string;
  windowEnd: string;
}

export interface HistoryAnalysis {
  status: 'COMPARABLE' | 'NO_BASELINE' | 'INSUFFICIENT_HISTORY' | 'HISTORY_INCOMPLETE';
  currentRunId: string;
  comparableRuns: number;
  rejectedRuns: Record<string, number>;
  observationWindow: { start: string; end: string };
  metrics: ReliabilityMetrics;
  tests: Record<string, TestReliability>;
  comparison: RunComparison;
}
