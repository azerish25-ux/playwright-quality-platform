import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import {
  ALLOWED_RESULTS,
  MAX_ARCHIVE_BYTES,
  MAX_DEPTH,
  MAX_ENTRIES,
  MAX_EXTRACTED_BYTES,
  MAX_FILES,
  MAX_REPORT_BYTES,
  REPORT_FILE,
  REPORT_KIND,
  REPORT_SCHEMA_VERSION,
  ReportingError,
  assert,
  exactKeys,
  integer,
  isObject,
  isoDate,
  within,
} from './shared.mjs';

export function validateReportDocument(value, context) {
  exactKeys(value, [
    'schemaVersion', 'kind', 'repository', 'workflow', 'workflowPath', 'runId', 'runAttempt',
    'pullRequestNumber', 'pullRequestHeadSha', 'pullRequestBaseSha', 'sourceHeadSha', 'testedSha',
    'aggregate', 'generatedAt',
  ], 'report');
  assert(value.schemaVersion === REPORT_SCHEMA_VERSION, 'Unsupported report schema version.');
  assert(value.kind === REPORT_KIND, 'Unexpected report kind.');
  assert(value.repository === context.repository, 'Report repository does not match the originating run.');
  assert(value.workflow === context.workflowName, 'Report workflow does not match the originating run.');
  assert(value.workflowPath === context.workflowPath, 'Report workflow path does not match the originating run.');
  assert(value.runId === context.runId, 'Report run id does not match the originating run.');
  assert(value.runAttempt === context.runAttempt, 'Report run attempt does not match the originating run.');
  assert(value.pullRequestNumber === context.prNumber, 'Report pull request number does not match the originating run.');
  assert(value.pullRequestHeadSha === context.headSha, 'Report head SHA does not match the originating run.');
  assert(value.pullRequestBaseSha === context.baseSha, 'Report base SHA does not match the originating run.');
  assert(value.sourceHeadSha === context.sourceSha, 'Report source head SHA does not match the originating run.');
  assert(value.testedSha === context.testedSha, 'Report tested merge SHA does not match the current pull request merge ref.');
  exactKeys(value.aggregate, ['verify', 'consumer', 'teamboard', 'action', 'gateStep'], 'report.aggregate');
  for (const name of ['verify', 'consumer', 'teamboard', 'action']) {
    assert(ALLOWED_RESULTS.has(value.aggregate[name]), `report.aggregate.${name} is invalid.`);
  }
  assert(['success', 'failure'].includes(value.aggregate.gateStep), 'report.aggregate.gateStep is invalid.');
  const expectedGate = ['verify', 'consumer', 'teamboard', 'action'].every((name) => value.aggregate[name] === 'success') ? 'success' : 'failure';
  assert(value.aggregate.gateStep === expectedGate, 'Report aggregate gate is inconsistent with required lanes.');
  const generated = isoDate(value.generatedAt, 'report.generatedAt');
  assert(generated >= Date.parse(context.runCreatedAt) - 60_000 && generated <= Date.parse(context.runUpdatedAt) + 10 * 60_000, 'Report timestamp is outside the originating run window.');
  return value;
}

async function walkDirectory(root, current, state, depth = 0) {
  assert(depth <= MAX_DEPTH, 'Report artifact directory nesting is too deep.');
  for (const entry of await readdir(current, { withFileTypes: true })) {
    state.entries += 1;
    assert(state.entries <= MAX_ENTRIES, 'Report artifact contains too many entries.');
    const path = resolve(current, entry.name);
    const metadata = await lstat(path);
    assert(!metadata.isSymbolicLink(), 'Report artifact contains a symbolic link.');
    const canonical = await realpath(path);
    assert(within(root, canonical), 'Report artifact path escapes its extraction directory.');
    if (metadata.isDirectory()) {
      await walkDirectory(root, canonical, state, depth + 1);
      continue;
    }
    assert(metadata.isFile(), 'Report artifact contains an unsupported entry type.');
    state.files.push(canonical);
    state.bytes += metadata.size;
    assert(state.files.length <= MAX_FILES, 'Report artifact contains too many files.');
    assert(state.bytes <= MAX_EXTRACTED_BYTES, 'Report artifact exceeds the extracted-size limit.');
  }
}

export async function readValidatedReport(directory, context) {
  const requestedRoot = resolve(directory);
  const requestedMetadata = await lstat(requestedRoot).catch(() => {
    throw new ReportingError('Downloaded report artifact directory is missing.');
  });
  assert(requestedMetadata.isDirectory() && !requestedMetadata.isSymbolicLink(), 'Report artifact root must be a real directory.');
  const root = await realpath(requestedRoot);
  const state = { files: [], bytes: 0, entries: 0 };
  await walkDirectory(root, root, state);
  assert(state.files.length === 1, 'Report artifact must contain exactly one regular file.');
  assert(state.files[0].endsWith(`${sep}${REPORT_FILE}`), `Report artifact must contain only ${REPORT_FILE}.`);
  const bytes = await readFile(state.files[0]);
  assert(bytes.byteLength <= MAX_REPORT_BYTES, 'Report JSON exceeds the size limit.');
  assert(!bytes.includes(0), 'Report JSON contains a NUL byte.');
  let document;
  try {
    document = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new ReportingError('Report JSON is malformed.', { cause: error });
  }
  validateReportDocument(document, context);
  return Object.freeze({ document, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.byteLength });
}

export function validateArtifactMetadata(artifacts, context) {
  assert(Array.isArray(artifacts), 'Artifact metadata must be an array.');
  const matches = artifacts.filter((artifact) => artifact?.name === context.artifactName);
  assert(matches.length === 1, 'Expected exactly one run-bound PR report artifact.');
  const artifact = matches[0];
  integer(artifact.id, 'artifact id');
  assert(artifact.expired === false, 'PR report artifact has expired.');
  assert(Number.isSafeInteger(artifact.size_in_bytes) && artifact.size_in_bytes > 0 && artifact.size_in_bytes <= MAX_ARCHIVE_BYTES, 'PR report archive exceeds its size bound.');
  if (isObject(artifact.workflow_run) && artifact.workflow_run.id !== undefined) {
    assert(artifact.workflow_run.id === context.runId, 'PR report artifact belongs to a different workflow run.');
  }
  if (artifact.expires_at !== undefined) {
    assert(isoDate(artifact.expires_at, 'artifact expires_at') > Date.now(), 'PR report artifact expiry is not in the future.');
  }
  return artifact;
}

export function assertTrustedWorkflowUnchanged(files, workflowPath) {
  assert(Array.isArray(files), 'Pull request files must be an array.');
  const changed = files.some((file) => file?.filename === workflowPath || file?.previous_filename === workflowPath);
  assert(!changed, `Pull request modifies the trusted originating workflow ${workflowPath}; its report cannot be published as authoritative.`);
}
