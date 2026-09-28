import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { artifactDigests, RELEASE_PACKAGES, saveManifestAtomically } from './release-state.mjs';

// Staging is deliberately non-publishing. Semantic version calculation and live
// registry authorization must be accepted before connecting a production transport.
if (process.argv.length !== 3 || process.argv[2] !== '--dry-run') throw new Error('Only --dry-run candidate staging is supported; publication is not authorized here.');
const root = resolve('.');
const output = resolve(root, 'evidence/release-candidate');
const tarballs = resolve(output, 'tarballs');
function run(command, args) {
  const child = spawnSync(command, args, { cwd: root, encoding: 'utf8', env: process.env, timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
  if (child.error || child.status !== 0) throw new Error(`${command} failed while staging candidates: ${child.error?.message ?? child.stderr}`);
  return child.stdout;
}
const sourceSha = run('git', ['rev-parse', 'HEAD']).trim();
if (!/^[a-f0-9]{40}$/.test(sourceSha) || process.env.FORGEQA_SOURCE_SHA !== sourceSha) throw new Error('Candidate source must equal the verified checkout SHA.');
if (run('git', ['status', '--porcelain', '--untracked-files=no']).trim()) throw new Error('Refusing candidates from modified tracked source.');
const audit = JSON.parse(await readFile(resolve(root, 'evidence/hardening/package-audit.json'), 'utf8'));
if (audit.kind !== 'forgeqa-package-hardening' || audit.sourceSha !== sourceSha || audit.packageCount !== 8 || !Array.isArray(audit.packages) || audit.packages.length !== 8 || !Array.isArray(audit.consumers) || audit.consumers.length !== 2 || !['npm', 'pnpm'].every(manager => audit.consumers.some(c => c.manager === manager))) throw new Error('Exact-source tarball audit and both installed-package consumers are required. Run npm run hardening first.');
await mkdir(tarballs, { recursive: true, mode: 0o700 });
const entries = [];
let version;
for (const name of RELEASE_PACKAGES) {
  const accepted = audit.packages.filter(p => p.name === name);
  if (accepted.length !== 1) throw new Error(`Missing or duplicate audited package: ${name}`);
  const record = accepted[0];
  const directory = name.endsWith('-github') ? 'github-action' : name.slice('@azerish25-ux/forgeqa-'.length);
  const packagePath = resolve(root, 'packages', directory);
  const manifest = JSON.parse(await readFile(resolve(packagePath, 'package.json'), 'utf8'));
  version ??= manifest.version;
  if (manifest.name !== name || manifest.version !== version || record.version !== version || manifest.private === true) throw new Error('Candidate packages must be public, correctly named and lockstep.');
  for (const group of ['dependencies', 'peerDependencies', 'optionalDependencies']) for (const [dependency, range] of Object.entries(manifest[group] ?? {})) {
    if (/^(?:workspace|link|file):/.test(range)) throw new Error(`Unresolved dependency in ${name}.`);
    if (RELEASE_PACKAGES.includes(dependency) && ![version, `^${version}`, `~${version}`].includes(range)) throw new Error(`Non-lockstep internal dependency in ${name}.`);
  }
  const packed = JSON.parse(run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', tarballs, packagePath]));
  if (!Array.isArray(packed) || packed.length !== 1 || packed[0].name !== name || packed[0].version !== version || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.tgz$/.test(packed[0].filename)) throw new Error('npm pack returned incompatible metadata.');
  const pack = packed[0];
  const digests = artifactDigests(await readFile(resolve(tarballs, pack.filename)));
  if (digests.sha256 !== record.sha256 || digests.size !== record.size || digests.integrity !== pack.integrity) throw new Error(`Repacked candidate differs from the exact tarball accepted by npm/pnpm: ${name}`);
  entries.push({ name, version, filename: pack.filename, ...digests, status: 'staged', files: record.files });
}
const candidate = {
  schemaVersion: 2, kind: 'forgeqa-release-candidate', sourceSha, version, channel: 'forgeqa-candidate', status: 'staged',
  createdAt: new Date().toISOString(), publication: 'NOT_ATTEMPTED',
  acceptance: { packages: 'PASS', npmConsumer: 'PASS', pnpmConsumer: 'PASS', semanticVersion: 'NOT_RUN', registryAuthorization: 'NOT_VERIFIED' },
  entries
};
await saveManifestAtomically(resolve(output, 'release-manifest.json'), candidate);
await writeFile(resolve(output, 'SHA256SUMS'), entries.map(e => `${e.sha256}  tarballs/${e.filename}`).join('\n') + '\n');
console.log(JSON.stringify(candidate, null, 2));
