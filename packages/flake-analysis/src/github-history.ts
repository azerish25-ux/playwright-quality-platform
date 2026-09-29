import { inflateRawSync } from 'node:zlib';
import { IntegrityError, sha256 } from '@azerish25-ux/forgeqa-core';
import { createHistoryRecord, validateHistoryResult } from './history-record.js';
import { importHistoryRecords } from './history-store.js';
import type {
  GitHubHistoryCoverageGap,
  GitHubHistoryImportOptions,
  GitHubHistoryImportResult,
  GitHubHistorySource,
  HistoryProvenance,
  HistoryRecord
} from './history-types.js';

interface GitHubRepositoryResponse { default_branch?: unknown; }
interface GitHubWorkflowRun {
  id?: unknown;
  run_attempt?: unknown;
  workflow_id?: unknown;
  event?: unknown;
  head_branch?: unknown;
  head_sha?: unknown;
  conclusion?: unknown;
  status?: unknown;
  created_at?: unknown;
}
interface GitHubRunsResponse { total_count?: unknown; workflow_runs?: unknown; }
interface GitHubArtifact {
  id?: unknown;
  name?: unknown;
  expired?: unknown;
  size_in_bytes?: unknown;
}
interface GitHubArtifactsResponse { total_count?: unknown; artifacts?: unknown; }
interface ZipEntry { name: string; bytes: Buffer; }

const DEFAULT_MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_EXPANDED_BYTES = 128 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 2_000;
const DEFAULT_ARTIFACT_PREFIX = 'forgeqa-merged-';

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new IntegrityError(`GitHub response is missing ${label}.`);
  return value;
}
function requiredInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new IntegrityError(`GitHub response has invalid ${label}.`);
  return Number(value);
}
function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}
function apiUrl(base: string, path: string): string {
  return `${base.replace(/\/$/, '')}${path}`;
}
function encodeWorkflow(value: string): string {
  return value.split('/').map(part => encodeURIComponent(part)).join('/');
}

async function request(
  fetchImpl: typeof fetch,
  url: string,
  token: string | undefined,
  accept: string
): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: accept,
    'User-Agent': 'Deadpan-history-import',
    'X-GitHub-Api-Version': '2022-11-28'
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  let response: Response;
  try {
    response = await fetchImpl(url, { headers, redirect: 'follow' });
  } catch (error) {
    throw new IntegrityError(`GitHub history request failed: ${url}`, {
      message: error instanceof Error ? error.message : String(error)
    });
  }
  if (!response.ok) {
    const diagnostic = (await response.text()).slice(0, 2_048);
    throw new IntegrityError(`GitHub history request returned HTTP ${response.status}.`, { url, diagnostic });
  }
  return response;
}

async function requestJson<T>(fetchImpl: typeof fetch, url: string, token?: string): Promise<T> {
  const response = await request(fetchImpl, url, token, 'application/vnd.github+json');
  try {
    return await response.json() as T;
  } catch (error) {
    throw new IntegrityError(`GitHub history response was not valid JSON: ${url}`, {
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

function crcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    table[index] = value >>> 0;
  }
  return table;
}
const CRC_TABLE = crcTable();
function crc32(bytes: Buffer): number {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff]! ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
function safeArchivePath(value: string): string {
  const name = value.replace(/\\/g, '/');
  if (!name || name.includes('\0') || name.startsWith('/') || /^[a-zA-Z]:/.test(name)) {
    throw new IntegrityError(`Unsafe GitHub artifact entry: ${value}`);
  }
  const candidate = name.endsWith('/') ? name.slice(0, -1) : name;
  const parts = candidate.split('/');
  if (!candidate || parts.some(part => part === '..' || part === '.' || part === '')) throw new IntegrityError(`Unsafe GitHub artifact entry: ${value}`);
  return name;
}
function findEndOfCentralDirectory(bytes: Buffer): number {
  const minimum = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new IntegrityError('GitHub artifact is not a supported ZIP archive.');
}

export function extractGitHubArtifactZip(
  bytes: Buffer,
  maxArchiveBytes = DEFAULT_MAX_ARCHIVE_BYTES,
  maxExpandedBytes = DEFAULT_MAX_EXPANDED_BYTES
): Map<string, Buffer> {
  if (bytes.length < 22 || bytes.length > maxArchiveBytes) throw new IntegrityError('GitHub artifact archive size is outside the allowed bounds.');
  const end = findEndOfCentralDirectory(bytes);
  const disk = bytes.readUInt16LE(end + 4);
  const directoryDisk = bytes.readUInt16LE(end + 6);
  const diskEntries = bytes.readUInt16LE(end + 8);
  const totalEntries = bytes.readUInt16LE(end + 10);
  const directorySize = bytes.readUInt32LE(end + 12);
  const directoryOffset = bytes.readUInt32LE(end + 16);
  if (disk !== 0 || directoryDisk !== 0 || diskEntries !== totalEntries || totalEntries === 0 || totalEntries > MAX_ZIP_ENTRIES) {
    throw new IntegrityError('GitHub artifact ZIP dimensions are unsupported.');
  }
  if (totalEntries === 0xffff || directoryOffset === 0xffffffff || directorySize === 0xffffffff) {
    throw new IntegrityError('ZIP64 GitHub artifacts are not supported.');
  }
  if (directoryOffset + directorySize > end || directoryOffset < 0) throw new IntegrityError('GitHub artifact central directory is out of bounds.');
  const output = new Map<string, Buffer>();
  let cursor = directoryOffset;
  let expanded = 0;
  for (let index = 0; index < totalEntries; index += 1) {
    if (cursor + 46 > bytes.length || bytes.readUInt32LE(cursor) !== 0x02014b50) throw new IntegrityError('GitHub artifact central directory is corrupt.');
    const flags = bytes.readUInt16LE(cursor + 8);
    const method = bytes.readUInt16LE(cursor + 10);
    const expectedCrc = bytes.readUInt32LE(cursor + 16);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const uncompressedSize = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const externalAttributes = bytes.readUInt32LE(cursor + 38);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    const endOfEntry = cursor + 46 + nameLength + extraLength + commentLength;
    if (endOfEntry > bytes.length) throw new IntegrityError('GitHub artifact central-directory entry is truncated.');
    if ((flags & 1) !== 0 || ![0, 8].includes(method)) throw new IntegrityError('Encrypted or unsupported GitHub artifact entries are refused.');
    const name = safeArchivePath(bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8'));
    cursor = endOfEntry;
    if (name.endsWith('/')) continue;
    const unixMode = externalAttributes >>> 16;
    const fileType = unixMode & 0xf000;
    if (fileType === 0xa000 || (fileType !== 0 && fileType !== 0x8000)) throw new IntegrityError(`GitHub artifact entry is not a regular file: ${name}`);
    if (uncompressedSize > maxExpandedBytes || expanded + uncompressedSize > maxExpandedBytes) throw new IntegrityError('GitHub artifact expanded size exceeds the allowed limit.');
    if (localOffset + 30 > bytes.length || bytes.readUInt32LE(localOffset) !== 0x04034b50) throw new IntegrityError(`GitHub artifact local header is corrupt: ${name}`);
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    if (dataOffset + compressedSize > bytes.length) throw new IntegrityError(`GitHub artifact entry is truncated: ${name}`);
    const compressed = bytes.subarray(dataOffset, dataOffset + compressedSize);
    let value: Buffer;
    try {
      value = method === 0 ? Buffer.from(compressed) : inflateRawSync(compressed, { maxOutputLength: maxExpandedBytes - expanded });
    } catch (error) {
      throw new IntegrityError(`GitHub artifact entry cannot be decompressed: ${name}`, {
        message: error instanceof Error ? error.message : String(error)
      });
    }
    if (value.length !== uncompressedSize || crc32(value) !== expectedCrc) throw new IntegrityError(`GitHub artifact entry checksum mismatch: ${name}`);
    if (output.has(name)) throw new IntegrityError(`GitHub artifact contains duplicate entry: ${name}`);
    output.set(name, value);
    expanded += value.length;
  }
  if (cursor !== directoryOffset + directorySize) throw new IntegrityError('GitHub artifact central-directory size is inconsistent.');
  return output;
}

function sibling(entries: Map<string, Buffer>, reportPath: string, name: string): Buffer | undefined {
  const slash = reportPath.lastIndexOf('/');
  const prefix = slash < 0 ? '' : reportPath.slice(0, slash + 1);
  return entries.get(`${prefix}${name}`);
}
function parseJson(bytes: Buffer, label: string): unknown {
  try {
    return JSON.parse(bytes.toString('utf8')) as unknown;
  } catch (error) {
    throw new IntegrityError(`${label} is not valid JSON.`, { message: error instanceof Error ? error.message : String(error) });
  }
}
function reportRecord(entries: Map<string, Buffer>): { result: ReturnType<typeof validateHistoryResult>; reportPath: string } {
  const reports = [...entries.keys()].filter(name => name === 'report.json' || name.endsWith('/report.json'));
  if (reports.length !== 1) throw new IntegrityError(`GitHub artifact must contain exactly one report.json; found ${reports.length}.`);
  const reportPath = reports[0]!;
  const reportBytes = entries.get(reportPath)!;
  const completeBytes = sibling(entries, reportPath, 'complete.json');
  if (!completeBytes) throw new IntegrityError('GitHub history artifact is missing complete.json beside report.json.');
  const complete = parseJson(completeBytes, 'complete.json');
  if (typeof complete !== 'object' || complete === null || Array.isArray(complete)) throw new IntegrityError('complete.json has an invalid shape.');
  const checksums = (complete as { checksums?: unknown }).checksums;
  if (typeof checksums !== 'object' || checksums === null || Array.isArray(checksums)) throw new IntegrityError('complete.json is missing output checksums.');
  const expected = (checksums as Record<string, unknown>)['report.json'];
  if (typeof expected !== 'string' || expected !== sha256(reportBytes)) throw new IntegrityError('GitHub history report checksum does not match complete.json.');
  return { result: validateHistoryResult(parseJson(reportBytes, 'report.json')), reportPath };
}

function provenanceFor(run: GitHubWorkflowRun, defaultBranch: string): HistoryProvenance {
  const event = requiredString(run.event, 'workflow event');
  const branch = optionalString(run.head_branch);
  if (event === 'pull_request' || event === 'pull_request_target' || branch !== defaultBranch) return 'untrusted-pr';
  return 'trusted-default-branch';
}
function sourceFor(repository: string, run: GitHubWorkflowRun, artifact: GitHubArtifact): GitHubHistorySource {
  return {
    provider: 'github-actions',
    repository,
    workflowId: requiredInteger(run.workflow_id, 'workflow id'),
    workflowRunId: requiredInteger(run.id, 'workflow run id'),
    workflowRunAttempt: requiredInteger(run.run_attempt, 'workflow run attempt'),
    artifactId: requiredInteger(artifact.id, 'artifact id'),
    artifactName: requiredString(artifact.name, 'artifact name'),
    event: requiredString(run.event, 'workflow event'),
    branch: optionalString(run.head_branch),
    conclusion: optionalString(run.conclusion),
    headSha: requiredString(run.head_sha, 'workflow head SHA'),
    createdAt: requiredString(run.created_at, 'workflow creation time')
  };
}

async function workflowRuns(options: Required<Pick<GitHubHistoryImportOptions, 'repository' | 'apiBaseUrl' | 'maxRuns'>> & GitHubHistoryImportOptions): Promise<GitHubWorkflowRun[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const encodedRepository = options.repository.split('/').map(encodeURIComponent).join('/');
  const segment = options.workflow ? `/actions/workflows/${encodeWorkflow(options.workflow)}/runs` : '/actions/runs';
  const runs: GitHubWorkflowRun[] = [];
  for (let page = 1; runs.length < options.maxRuns; page += 1) {
    const url = apiUrl(options.apiBaseUrl, `/repos/${encodedRepository}${segment}?status=completed&per_page=100&page=${page}`);
    const response = await requestJson<GitHubRunsResponse>(fetchImpl, url, options.token);
    if (!Array.isArray(response.workflow_runs)) throw new IntegrityError('GitHub workflow-runs response is invalid.');
    const pageRuns = response.workflow_runs as GitHubWorkflowRun[];
    runs.push(...pageRuns.slice(0, options.maxRuns - runs.length));
    const total = typeof response.total_count === 'number' ? response.total_count : undefined;
    if (!pageRuns.length || (total !== undefined && runs.length >= Math.min(total, options.maxRuns)) || pageRuns.length < 100 && total === undefined) break;
  }
  return runs;
}

async function runArtifacts(options: GitHubHistoryImportOptions & { repository: string; apiBaseUrl: string }, runId: number): Promise<GitHubArtifact[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const encodedRepository = options.repository.split('/').map(encodeURIComponent).join('/');
  const output: GitHubArtifact[] = [];
  for (let page = 1; ; page += 1) {
    const url = apiUrl(options.apiBaseUrl, `/repos/${encodedRepository}/actions/runs/${runId}/artifacts?per_page=100&page=${page}`);
    const response = await requestJson<GitHubArtifactsResponse>(fetchImpl, url, options.token);
    if (!Array.isArray(response.artifacts)) throw new IntegrityError('GitHub artifacts response is invalid.');
    const pageArtifacts = response.artifacts as GitHubArtifact[];
    output.push(...pageArtifacts);
    const total = typeof response.total_count === 'number' ? response.total_count : undefined;
    if (!pageArtifacts.length || (total !== undefined && output.length >= total) || pageArtifacts.length < 100 && total === undefined) break;
  }
  return output;
}

export async function importGitHubHistory(root: string, options: GitHubHistoryImportOptions): Promise<GitHubHistoryImportResult> {
  if (!/^[^/\s]+\/[^/\s]+$/.test(options.repository)) throw new IntegrityError('GitHub history repository must use owner/name.');
  const apiBaseUrl = options.apiBaseUrl ?? 'https://api.github.com';
  const maxRuns = options.maxRuns ?? 50;
  const artifactNamePrefix = options.artifactNamePrefix ?? DEFAULT_ARTIFACT_PREFIX;
  if (!Number.isInteger(maxRuns) || maxRuns < 1 || maxRuns > 500) throw new IntegrityError('GitHub history maxRuns must be between 1 and 500.');
  if (!artifactNamePrefix.trim()) throw new IntegrityError('GitHub history artifact prefix must not be empty.');
  const fetchImpl = options.fetchImpl ?? fetch;
  const encodedRepository = options.repository.split('/').map(encodeURIComponent).join('/');
  const repositoryResponse = await requestJson<GitHubRepositoryResponse>(
    fetchImpl,
    apiUrl(apiBaseUrl, `/repos/${encodedRepository}`),
    options.token
  );
  const defaultBranch = requiredString(repositoryResponse.default_branch, 'default branch');
  const runs = await workflowRuns({ ...options, repository: options.repository, apiBaseUrl, maxRuns });
  const records: HistoryRecord[] = [];
  const coverageGaps: GitHubHistoryCoverageGap[] = [];
  let artifactsScanned = 0;
  for (const run of runs) {
    const runId = requiredInteger(run.id, 'workflow run id');
    const artifacts = await runArtifacts({ ...options, repository: options.repository, apiBaseUrl }, runId);
    const matching = artifacts.filter(artifact => typeof artifact.name === 'string' && artifact.name.startsWith(artifactNamePrefix));
    if (!matching.length) {
      coverageGaps.push({ runId, reason: 'missing-artifact' });
      continue;
    }
    for (const artifact of matching) {
      artifactsScanned += 1;
      const artifactId = requiredInteger(artifact.id, 'artifact id');
      if (artifact.expired === true) {
        coverageGaps.push({ runId, artifactId, reason: 'expired-artifact' });
        continue;
      }
      const declaredSize = typeof artifact.size_in_bytes === 'number' ? artifact.size_in_bytes : 0;
      const maxArchiveBytes = options.maxArchiveBytes ?? DEFAULT_MAX_ARCHIVE_BYTES;
      if (declaredSize > maxArchiveBytes) throw new IntegrityError(`GitHub history artifact ${artifactId} exceeds the archive-size limit.`);
      const archiveResponse = await request(
        fetchImpl,
        apiUrl(apiBaseUrl, `/repos/${encodedRepository}/actions/artifacts/${artifactId}/zip`),
        options.token,
        'application/octet-stream'
      );
      const archive = Buffer.from(await archiveResponse.arrayBuffer());
      const entries = extractGitHubArtifactZip(archive, maxArchiveBytes, options.maxExpandedBytes ?? DEFAULT_MAX_EXPANDED_BYTES);
      const { result } = reportRecord(entries);
      const source = sourceFor(options.repository, run, artifact);
      if (result.revision.repository.toLowerCase() !== options.repository.toLowerCase()) throw new IntegrityError(`GitHub history artifact ${artifactId} belongs to a different repository.`);
      const revisions = [result.revision.testedCommit, result.revision.sourceCommit, result.revision.prHeadSha, result.revision.prMergeSha].filter(Boolean);
      if (!revisions.includes(source.headSha)) throw new IntegrityError(`GitHub history artifact ${artifactId} does not match workflow head SHA ${source.headSha}.`);
      records.push(createHistoryRecord(result, provenanceFor(run, defaultBranch), options.now?.toISOString(), source));
    }
  }
  if (!records.length) throw new IntegrityError('No complete Deadpan history artifacts were available.', { coverageGaps });
  const imported = await importHistoryRecords(root, records, {
    ...(options.now ? { now: options.now } : {}),
    ...(options.maxAgeDays !== undefined ? { maxAgeDays: options.maxAgeDays } : {}),
    ...(options.maxRecords !== undefined ? { maxRecords: options.maxRecords } : {})
  });
  return {
    ...imported,
    runsScanned: runs.length,
    artifactsScanned,
    recordsFound: records.length,
    coverageGaps
  };
}
