import { readFile, writeFile, mkdir, mkdtemp, readdir, lstat, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { RELEASE_PACKAGES, artifactDigests, saveManifestAtomically } from './release-state.mjs';
import { validatePlan, sourceIdentity } from './release-version.mjs';
import { execute, runNpm, atomicJson } from './release-process.mjs';

export const packageDirectory = name => name.endsWith('-github') ? 'github-action' : name.slice('@azerish25-ux/forgeqa-'.length);
const check = (condition, message) => { if (!condition) throw new Error(message); };
export function rewritePackage(input, version) {
  check(RELEASE_PACKAGES.includes(input?.name) && input.private !== true, 'Only the eight public Deadpan packages may be prepared.');
  check(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version), 'Invalid prepared version.');
  const manifest = structuredClone(input);
  manifest.version = version;
  check(manifest.publishConfig?.access === 'public' && !manifest.publishConfig.registry && !manifest.publishConfig.tag, 'Package publication configuration may not override the coordinated registry/channel.');
  for (const group of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const [name, range] of Object.entries(manifest[group] ?? {})) {
      check(typeof range === 'string', 'Dependency ranges must be strings.');
      if (RELEASE_PACKAGES.includes(name)) {
        check(/^(?:workspace:)?(?:\*|[~^]?(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[\w.-]+)?|[~^])$/.test(range), 'Unsupported coordinated dependency range.');
        const operator = range.replace(/^workspace:/, '').match(/^[~^]/)?.[0] ?? '';
        manifest[group][name] = `${operator}${version}`;
      } else {
        check(!name.startsWith('@azerish25-ux/forgeqa-'), 'Unknown Deadpan package dependency.');
        check(!/^(?:workspace|file|link):/.test(range), 'External dependencies cannot use local protocols.');
      }
    }
  }
  return manifest;
}

function safeRelative(path) {
  return typeof path === 'string' && path.length > 0 && !isAbsolute(path) && !/[\\\0*?]/.test(path) && !path.split('/').some(part => !part || part === '.' || part === '..');
}
async function regularTree(path) {
  const info = await lstat(path);
  check(!info.isSymbolicLink(), 'Symlinks are forbidden in prepared package inputs.');
  if (info.isDirectory()) for (const entry of await readdir(path)) await regularTree(join(path, entry));
  else check(info.isFile(), 'Non-regular package input.');
}
function targets(value) { return typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(targets) : []; }

export function assertAuditedArtifact(bytes, record) {
  const actual = artifactDigests(bytes);
  check(actual.sha256 === record.sha256 && actual.size === record.size, 'Source package differs from the exact artifact accepted by hardening.');
  return actual;
}

export function inspectPackedMetadata(pack, manifest, acceptedFiles) {
  check(pack?.name === manifest.name && pack.version === manifest.version && Array.isArray(pack.files), 'Prepared package identity mismatch.');
  check(/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.tgz$/.test(pack.filename ?? ''), 'Unsafe prepared tarball name.');
  const files = pack.files.map(file => file.path).sort();
  check(files.length > 0 && files.length <= 500 && new Set(files).size === files.length, 'Invalid prepared tarball inventory.');
  for (const path of files) {
    check(safeRelative(path), 'Unsafe path in prepared tarball.');
    check(!/(?:^|\/)(?:src|tests?|node_modules|coverage|evidence|forgeqa-results|test-results|\.git|\.env|\.npmrc|\.auth)(?:\/|$)/i.test(path), 'Forbidden file in prepared package.');
  }
  for (const required of ['package.json', 'README.md', 'LICENSE', 'dist/index.js', 'dist/index.d.ts']) check(files.includes(required), 'Required prepared package file is missing.');
  for (const target of [...targets(manifest.exports), manifest.main, manifest.types, ...Object.values(manifest.bin ?? {})]) {
    check(typeof target === 'string' && target.startsWith('./') && files.includes(target.slice(2)), 'Prepared package export, declaration or executable is missing.');
  }
  check(JSON.stringify(files) === JSON.stringify([...acceptedFiles].sort()), 'Prepared file inventory differs from source hardening.');
  return files;
}

/** Copy build outputs into owned staging; never rewrite source package versions or
 * private workspace manifests. Final, version-rewritten tarballs are audited anew.
 */
export async function preparePackages(root, output, plan) {
  validatePlan(plan);
  root = resolve(root); output = resolve(output);
  await sourceIdentity(root, plan.sourceSha);
  const auditBytes = await readFile(join(root, 'evidence/hardening/package-audit.json'));
  const audit = JSON.parse(auditBytes);
  check(audit.kind === 'forgeqa-package-hardening' && audit.sourceSha === plan.sourceSha && audit.packageCount === 8 && audit.packages?.length === 8 &&
    audit.consumers?.length === 2 && ['npm', 'pnpm'].every(manager => audit.consumers.some(c => c.manager === manager)), 'Exact-source hardening and both original package consumers are required before preparation.');
  await mkdir(output, { mode: 0o700 }); // EEXIST intentionally refuses to destroy a partial release checkpoint.
  const staged = await mkdtemp(join(tmpdir(), 'forgeqa-prepared-'));
  try {
    const tarballs = join(output, 'tarballs'); await mkdir(tarballs, { mode: 0o700 });
    const entries = [];
    let sourceVersion;
    for (const name of RELEASE_PACKAGES) {
      const folder = packageDirectory(name), source = join(root, 'packages', folder), destination = join(staged, folder);
      const original = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
      sourceVersion ??= original.version;
      check(original.name === name && original.version === sourceVersion, 'Source packages must already be lockstep.');
      const audited = audit.packages.filter(entry => entry.name === name);
      check(audited.length === 1 && audited[0].version === sourceVersion, 'Missing or inconsistent source package audit.');
      // Ignored build outputs can change without making Git dirty. Repack and
      // match the hardening digest, then stage ONLY from that verified archive.
      const [sourcePack] = JSON.parse(await runNpm(['pack', source, '--json', '--ignore-scripts', '--pack-destination', staged], { cwd: root }));
      inspectPackedMetadata(sourcePack, original, audited[0].files);
      const sourceArchive = join(staged, sourcePack.filename);
      assertAuditedArtifact(await readFile(sourceArchive), audited[0]);
      const extractedRoot = join(staged, `${folder}-audited`); await mkdir(extractedRoot);
      await execute('tar', ['-xzf', sourceArchive, '-C', extractedRoot]);
      const acceptedSource = join(extractedRoot, 'package'); await regularTree(acceptedSource);
      check(JSON.stringify(JSON.parse(await readFile(join(acceptedSource, 'package.json')))) === JSON.stringify(original), 'Source package metadata changed after hardening.');
      const manifest = rewritePackage(original, plan.version);
      check(Array.isArray(manifest.files), 'An explicit package allowlist is required.');
      await mkdir(destination, { mode: 0o700 });
      for (const path of manifest.files) {
        check(safeRelative(path), 'Unsupported package file allowlist.');
        await regularTree(join(acceptedSource, path));
        await cp(join(acceptedSource, path), join(destination, path), { recursive: true, dereference: false });
      }
      await writeFile(join(destination, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
      const packed = JSON.parse(await runNpm(['pack', destination, '--json', '--ignore-scripts', '--pack-destination', tarballs], { cwd: staged }));
      check(Array.isArray(packed) && packed.length === 1, 'npm pack must return exactly one artifact.');
      const pack = packed[0], files = inspectPackedMetadata(pack, manifest, audited[0].files);
      const file = join(tarballs, pack.filename), bytes = await readFile(file), digests = artifactDigests(bytes);
      check(digests.size <= 5 * 1024 * 1024 && digests.size === pack.size && digests.integrity === pack.integrity, 'Prepared tarball integrity mismatch.');
      const extracted = JSON.parse(await execute('tar', ['-xOf', file, 'package/package.json']));
      check(JSON.stringify(extracted) === JSON.stringify(manifest), 'Packed package metadata differs from the prepared version.');
      entries.push({ name, version: plan.version, filename: pack.filename, ...digests, status: 'staged', files });
    }
    await sourceIdentity(root, plan.sourceSha);
    const manifest = { schemaVersion: 2, kind: 'forgeqa-release-candidate', sourceSha: plan.sourceSha, version: plan.version,
      channel: 'forgeqa-candidate', status: 'staged', publication: 'NOT_ATTEMPTED', createdAt: new Date().toISOString(),
      preparation: { sourceVersion, planSha256: plan.planSha256, sourceTree: plan.sourceTree, sourceAuditSha256: createHash('sha256').update(auditBytes).digest('hex') },
      acceptance: { semanticVersion: 'PASS', packages: 'PASS', npmConsumer: 'NOT_RUN', pnpmConsumer: 'NOT_RUN', registryAuthorization: 'NOT_VERIFIED' }, entries };
    await atomicJson(join(output, 'semantic-plan.json'), plan);
    await writeFile(join(output, 'release-notes.md'), plan.notes);
    await saveManifestAtomically(join(output, 'release-manifest.json'), manifest);
    await writeFile(join(output, 'SHA256SUMS'), entries.map(entry => `${entry.sha256}  tarballs/${entry.filename}`).join('\n') + '\n');
    return manifest;
  } finally { await rm(staged, { recursive: true, force: true }); }
}
