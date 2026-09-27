import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { deflateRawSync } from 'node:zlib';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  extractGitHubArtifactZip,
  importGitHubHistory,
  readHistoryRecords
} from '@azerish25-ux/forgeqa-flake-analysis';
import { RESULT_SCHEMA_VERSION } from '@azerish25-ux/forgeqa-core';

function crcTable() {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    table[index] = value >>> 0;
  }
  return table;
}
const table = crcTable();
function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = table[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const nameBytes = Buffer.from(name);
    const value = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const compressed = deflateRawSync(value);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(value), 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(value.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const localRecord = Buffer.concat([local, nameBytes, compressed]);
    locals.push(localRecord);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc32(value), 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(value.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, nameBytes]));
    offset += localRecord.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(centrals.length, 8);
  end.writeUInt16LE(centrals.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
function run(runId, sha, outcome = 'passed') {
  return {
    schemaVersion: RESULT_SCHEMA_VERSION,
    runId,
    completion: 'complete',
    selectionHash: 'selection-a',
    configHash: 'config-a',
    revision: { repository: 'example/repo', sourceCommit: sha, testedCommit: sha, branch: 'main' },
    attempts: [{
      schemaVersion: RESULT_SCHEMA_VERSION,
      attemptId: `${runId}-attempt`,
      executionId: `${runId}-execution`,
      logicalTestId: 'checkout',
      retry: 0,
      outcome,
      startedAt: '2026-09-26T12:00:00.000Z',
      durationMs: 10,
      project: 'chromium',
      browser: 'chromium',
      environment: 'ci'
    }],
    missingExecutions: [],
    unexpectedExecutions: [],
    duplicateExecutions: [],
    shardIds: [`${runId}-shard`]
  };
}
function artifact(result) {
  const report = Buffer.from(`${JSON.stringify(result)}\n`);
  const checksum = createHash('sha256').update(report).digest('hex');
  const complete = Buffer.from(`${JSON.stringify({ schemaVersion: 1, checksums: { 'report.json': checksum } })}\n`);
  return zip({ 'forgeqa/report.json': report, 'forgeqa/complete.json': complete });
}
function json(value) {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
}

function mockGitHub(archives) {
  const runs = [
    { id: 101, run_attempt: 1, workflow_id: 9, event: 'push', head_branch: 'main', head_sha: 'a'.repeat(40), conclusion: 'success', status: 'completed', created_at: '2026-09-26T12:00:00Z' },
    { id: 102, run_attempt: 1, workflow_id: 9, event: 'push', head_branch: 'main', head_sha: 'b'.repeat(40), conclusion: 'failure', status: 'completed', created_at: '2026-09-26T13:00:00Z' },
    { id: 103, run_attempt: 2, workflow_id: 9, event: 'pull_request', head_branch: 'feature/test', head_sha: 'c'.repeat(40), conclusion: 'failure', status: 'completed', created_at: '2026-09-26T14:00:00Z' }
  ];
  return async url => {
    const parsed = new URL(url);
    if (parsed.pathname === '/repos/example/repo') return json({ default_branch: 'main' });
    if (parsed.pathname === '/repos/example/repo/actions/runs') {
      const page = Number(parsed.searchParams.get('page'));
      return json({ total_count: 3, workflow_runs: page === 1 ? runs.slice(0, 2) : page === 2 ? runs.slice(2) : [] });
    }
    const artifactList = /^\/repos\/example\/repo\/actions\/runs\/(\d+)\/artifacts$/.exec(parsed.pathname);
    if (artifactList) {
      const id = Number(artifactList[1]);
      return json({ total_count: 1, artifacts: [{ id: id + 1_000, name: `forgeqa-merged-${id}`, expired: false, size_in_bytes: archives.get(id).length }] });
    }
    const download = /^\/repos\/example\/repo\/actions\/artifacts\/(\d+)\/zip$/.exec(parsed.pathname);
    if (download) {
      const runId = Number(download[1]) - 1_000;
      return new Response(archives.get(runId), { status: 200, headers: { 'content-type': 'application/zip' } });
    }
    return new Response('not found', { status: 404 });
  };
}

test('GitHub history import paginates completed runs, includes failed runs, and separates PR provenance', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'forgeqa-github-history-'));
  const archives = new Map([
    [101, artifact(run('run-success', 'a'.repeat(40), 'passed'))],
    [102, artifact(run('run-failed', 'b'.repeat(40), 'failed'))],
    [103, artifact(run('run-pr', 'c'.repeat(40), 'failed'))]
  ]);
  const result = await importGitHubHistory(resolve(root, 'store'), {
    repository: 'example/repo',
    fetchImpl: mockGitHub(archives),
    apiBaseUrl: 'https://api.example.test',
    maxRuns: 10,
    now: new Date('2026-09-27T00:00:00Z'),
    maxAgeDays: 365
  });
  assert.deepEqual({ runs: result.runsScanned, found: result.recordsFound, imported: result.imported }, { runs: 3, found: 3, imported: 3 });
  const records = await readHistoryRecords(resolve(root, 'store'));
  assert.equal(records.find(value => value.result.runId === 'run-failed')?.result.attempts[0].outcome, 'failed');
  assert.equal(records.find(value => value.result.runId === 'run-pr')?.provenance, 'untrusted-pr');
  assert.equal(records.filter(value => value.provenance === 'trusted-default-branch').length, 2);
  assert.equal(records[0].source?.provider, 'github-actions');
});

test('GitHub history import fails closed when complete.json does not authenticate report.json', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'forgeqa-github-history-bad-'));
  const value = run('run-success', 'a'.repeat(40));
  const report = Buffer.from(`${JSON.stringify(value)}\n`);
  const bad = zip({
    'forgeqa/report.json': report,
    'forgeqa/complete.json': JSON.stringify({ schemaVersion: 1, checksums: { 'report.json': '0'.repeat(64) } })
  });
  await assert.rejects(
    importGitHubHistory(resolve(root, 'store'), {
      repository: 'example/repo',
      fetchImpl: mockGitHub(new Map([[101, bad], [102, bad], [103, bad]])),
      apiBaseUrl: 'https://api.example.test',
      maxRuns: 1,
      now: new Date('2026-09-27T00:00:00Z')
    }),
    error => error?.code === 'FORGEQA_INTEGRITY' && /checksum/.test(error.message)
  );
});

test('GitHub artifact extraction rejects path traversal before reading evidence', () => {
  const archive = zip({ '../report.json': '{}' });
  assert.throws(() => extractGitHubArtifactZip(archive), error => error?.code === 'FORGEQA_INTEGRITY' && /Unsafe/.test(error.message));
});
