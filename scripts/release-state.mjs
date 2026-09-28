import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';

export const RELEASE_PACKAGES = Object.freeze(['core', 'api', 'test-data', 'reporter', 'flake-analysis', 'playwright', 'github', 'cli'].map(name => `@azerish25-ux/forgeqa-${name}`));
export const CANDIDATE_CHANNEL = 'forgeqa-candidate';
export function artifactDigests(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new Error('A non-empty complete tarball is required.');
  return { size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` };
}

export function validateReleaseManifest(manifest) {
  if (manifest?.schemaVersion !== 2 || manifest.kind !== 'forgeqa-release-candidate' || !/^[a-f0-9]{40}$/.test(manifest.sourceSha ?? '')) throw new Error('Invalid release source or schema.');
  const version = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(manifest.version ?? '');
  if (!version || version[4]?.split('.').some(part => /^0\d+$/.test(part)) || manifest.channel !== CANDIDATE_CHANNEL) throw new Error('Invalid version or forbidden publication channel.');
  if (!Array.isArray(manifest.entries) || manifest.entries.length !== RELEASE_PACKAGES.length) throw new Error('All eight release packages are required.');
  const seen = new Set(), filenames = new Set();
  for (const entry of manifest.entries) {
    if (!RELEASE_PACKAGES.includes(entry.name) || seen.has(entry.name) || entry.version !== manifest.version) throw new Error('Missing, duplicate or non-lockstep package.');
    seen.add(entry.name);
    if (filenames.has(entry.filename) || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.tgz$/.test(entry.filename ?? '') || !Number.isSafeInteger(entry.size) || entry.size < 1 || entry.size > 5 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(entry.sha256 ?? '') || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(entry.integrity ?? '')) throw new Error('Invalid complete-tarball metadata.');
    filenames.add(entry.filename);
  }
  return manifest;
}

export function assertArtifact(entry, bytes) {
  const observed = artifactDigests(bytes);
  if (Object.keys(observed).some(key => observed[key] !== entry[key])) throw new Error(`Immutable artifact mismatch: ${entry.name}@${entry.version}`);
  return observed;
}

export async function saveManifestAtomically(path, manifest) {
  validateReleaseManifest(manifest);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(manifest, null, 2)}\n`);
    await handle.sync();
    await handle.close(); handle = undefined;
    await rename(temporary, path);
  } finally {
    await handle?.close();
    await rm(temporary, { force: true });
  }
}

/** Transport adapters must throw on network/auth failures and return null ONLY for
 * a confirmed absent version. This core never moves dist-tags or action aliases.
 * A real registry transport and account authorization are separate release gates.
 */
export async function reconcileCandidate(input, transport, { allowPublish = false } = {}) {
  validateReleaseManifest(input);
  const manifest = structuredClone(input);
  const staged = new Map();
  // Verify the complete set BEFORE any registry write, including on resumption.
  for (const entry of manifest.entries) {
    const bytes = await transport.readStaged(entry);
    assertArtifact(entry, bytes); staged.set(entry.name, bytes);
  }
  for (const entry of manifest.entries) {
    const published = await transport.lookup(entry.name, entry.version);
    if (published === null) entry.status = 'pending';
    else {
      if (published?.name !== entry.name || published?.version !== entry.version) throw new Error('Registry identity mismatch.');
      assertArtifact(entry, await transport.readPublished(published));
      entry.status = 'verified';
    }
  }
  manifest.status = manifest.entries.every(e => e.status === 'verified') ? 'candidate-verified' : 'partial';
  await transport.save(manifest);
  if (!allowPublish && manifest.status !== 'candidate-verified') return manifest;
  for (const entry of manifest.entries.filter(e => e.status === 'pending')) {
    entry.status = 'publishing';
    await transport.save(manifest);
    try {
      await transport.publish(entry, staged.get(entry.name), { tag: CANDIDATE_CHANNEL });
      const published = await transport.lookup(entry.name, entry.version);
      if (!published || published.name !== entry.name || published.version !== entry.version) throw new Error('Published version is not independently visible.');
      assertArtifact(entry, await transport.readPublished(published));
      entry.status = 'verified';
      await transport.save(manifest);
    } catch (error) {
      entry.status = 'unconfirmed';
      manifest.status = 'partial';
      await transport.save(manifest);
      throw new Error(`Candidate remains partial after ${entry.name}; resume by reconciling the registry.`, { cause: error });
    }
  }
  manifest.status = 'candidate-verified';
  await transport.save(manifest);
  return manifest;
}

export function assertStablePromotion(manifest, evidence) {
  validateReleaseManifest(manifest);
  if (manifest.status !== 'candidate-verified' || manifest.entries.some(e => e.status !== 'verified')) throw new Error('Partial publication cannot be promoted.');
  for (const gate of ['platform', 'teamboardRegistry', 'ledgerguardRegistry', 'immutableAction', 'documentation', 'benchmarks', 'lifecycle', 'semanticVersion']) {
    const result = evidence?.[gate];
    if (result?.status !== 'PASS' || result.sourceSha !== manifest.sourceSha || result.version !== manifest.version) throw new Error(`Stable promotion blocked: ${gate}.`);
  }
  return true;
}
