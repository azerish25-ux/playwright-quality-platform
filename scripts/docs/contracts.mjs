import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export function safeRelative(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0') ||
      isAbsolute(value) || value.split('/').some((part) => !part || part === '.' || part === '..') ||
      !/^[\w./-]+$/.test(value)) throw new Error(`Unsafe documentation path: ${value}`);
  return value;
}
export function within(root, path) {
  const rel = relative(resolve(root), resolve(path));
  return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`);
}
export async function readOwned(root, path) {
  const target = resolve(root, safeRelative(path));
  const info = await lstat(target);
  if (!info.isFile() || info.isSymbolicLink() || !within(await realpath(root), await realpath(target))) {
    throw new Error(`Documentation file is not an owned regular file: ${path}`);
  }
  if (info.size > 2 * 1024 * 1024) throw new Error(`Oversized documentation file: ${path}`);
  return readFile(target, 'utf8');
}
export function validateVersions(value) {
  if (!value || value.schemaVersion !== 1 || value.current !== 'next' || !Array.isArray(value.releases)) {
    throw new Error('Invalid documentation version manifest.');
  }
  if (value.releases.length > 100) throw new Error('Too many documentation versions.');
  const seen = new Set();
  for (const entry of value.releases) {
    if (!entry || typeof entry.version !== 'string' || !/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(entry.version) ||
        !/^[0-9a-f]{40}$/.test(entry.sourceSha ?? '') || !/^[0-9a-f]{64}$/.test(entry.manifestSha256 ?? '') || seen.has(entry.version)) {
      throw new Error('Invalid or duplicate released documentation version.');
    }
    seen.add(entry.version);
  }
  return value;
}
async function filesUnder(root, path = '') {
  const files = [];
  for (const item of await readdir(resolve(root, path), { withFileTypes: true })) {
    const name = path ? `${path}/${item.name}` : item.name;
    safeRelative(name);
    if (item.isSymbolicLink()) throw new Error(`Snapshot contains symbolic link: ${name}`);
    if (item.isDirectory()) files.push(...await filesUnder(root, name));
    else if (item.isFile()) files.push(name);
    else throw new Error(`Snapshot contains non-regular entry: ${name}`);
  }
  return files.sort();
}
export async function readSnapshot(root, release) {
  const directory = `docs/versions/${release.version}`;
  const raw = await readOwned(root, `${directory}/manifest.json`);
  if (sha256(raw) !== release.manifestSha256) throw new Error('Snapshot manifest checksum mismatch.');
  const manifest = JSON.parse(raw);
  if (manifest.schemaVersion !== 1 || manifest.sourceSha !== release.sourceSha ||
      !manifest.files || Array.isArray(manifest.files) || typeof manifest.files !== 'object') {
    throw new Error('Invalid frozen documentation manifest.');
  }
  const names = Object.keys(manifest.files).sort();
  if (!names.includes('index.md') || names.length > 1000) throw new Error('Snapshot needs an index and a bounded inventory.');
  for (const name of names) {
    safeRelative(name);
    if (!name.endsWith('.md') || !/^[0-9a-f]{64}$/.test(manifest.files[name])) throw new Error('Invalid snapshot file contract.');
  }
  const actual = (await filesUnder(resolve(root, directory))).filter((path) => path !== 'manifest.json');
  if (JSON.stringify(actual) !== JSON.stringify(names)) throw new Error('Snapshot file inventory mismatch.');
  const files = {};
  for (const name of names) {
    const text = await readOwned(root, `${directory}/${name}`);
    if (sha256(text) !== manifest.files[name]) throw new Error(`Frozen documentation changed: ${name}`);
    files[name] = text;
  }
  return files;
}
export function assertSourceSha(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/.test(value)) throw new Error('Documentation requires an exact source SHA.');
  return value;
}
export function validateBase(value) {
  if (typeof value !== 'string' || !/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(value)) throw new Error('Invalid documentation mount path.');
  return value;
}
export async function expandIncludes(text, root) {
  return (await Promise.all(text.split('\n').map(async (line) => {
    const match = /^<!-- forgeqa:include ([^ ]+) -->$/.exec(line);
    if (!match) {
      if (line.includes('forgeqa:include')) throw new Error('Malformed documentation snippet include.');
      return line;
    }
    const path = safeRelative(match[1]);
    if (!path.startsWith('docs/snippets/') || !/\.(?:ts|mjs)$/.test(path)) throw new Error('Snippet outside the tested documentation directory.');
    return `\`\`\`${path.endsWith('.ts') ? 'ts' : 'js'}\n${(await readOwned(root, path)).trimEnd()}\n\`\`\``;
  }))).join('\n');
}
