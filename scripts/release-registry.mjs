import { mkdtemp, readFile, writeFile, lstat, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { RELEASE_PACKAGES, artifactDigests, assertArtifact, saveManifestAtomically, CANDIDATE_CHANNEL } from './release-state.mjs';
import { runNpm } from './release-process.mjs';

const PUBLIC_REGISTRY = 'https://registry.npmjs.org/';
export function registryAddress(value, allowLoopback = false) {
  if (typeof allowLoopback !== 'boolean') throw new Error('Loopback permission must be an explicit boolean.');
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Registry must be an uncredentialed origin URL.');
  if (url.href !== PUBLIC_REGISTRY && !(allowLoopback && url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port)) throw new Error('Only public npm or an explicitly owned loopback test registry is permitted.');
  return url;
}
function packageIdentity(name, version) {
  if (!RELEASE_PACKAGES.includes(name) || typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error('Unsupported registry package identity.');
}
function within(parent, candidate) {
  const path = relative(parent, candidate);
  return path !== '' && path !== '..' && !path.startsWith('../') && !path.startsWith('..\\') && !isAbsolute(path);
}

/** Production npm publishing is delegated to its CLI so supported token/OIDC
 * authentication and provenance remain npm's responsibility. HTTP reads never
 * forward credentials or follow redirects to another origin.
 */
export function createRegistryTransport({ directory, registry = PUBLIC_REGISTRY, allowLoopback = false,
  authorizePublicPublish = false, npmUserConfig, timeoutMs = 15000, fetchImpl = fetch } = {}) {
  const base = registryAddress(registry, allowLoopback);
  if (typeof authorizePublicPublish !== 'boolean' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw new Error('Invalid registry transport policy.');
  if (typeof directory !== 'string') throw new Error('A retained release directory is required.');
  const root = resolve(directory), testRegistry = base.href !== PUBLIC_REGISTRY;
  async function request(url, maxBytes, allowMissing = false) {
    if (url.origin !== base.origin || url.username || url.password || url.hash || url.search) throw new Error('Registry artifact URL escaped the approved origin.');
    let response;
    try { response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(timeoutMs), headers: { Accept: 'application/json, application/octet-stream', 'Cache-Control': 'no-cache' } }); }
    catch { throw new Error('Registry read failed or exceeded its deadline.'); }
    if (response.status === 404 && allowMissing) { await response.body?.cancel(); return null; }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Registry read failed (HTTP ${response.status}); absence is not established.`); }
    const declared = response.headers.get('content-length');
    if ((declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) || !response.body) {
      await response.body?.cancel(); throw new Error('Invalid or oversized registry response.');
    }
    const chunks = []; let size = 0;
    try {
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > maxBytes) throw new Error('Response size exceeded.');
        chunks.push(Buffer.from(chunk));
      }
    } catch { throw new Error('Registry response was incomplete, oversized or timed out.'); }
    return Buffer.concat(chunks);
  }
  return {
    async readStaged(entry) {
      packageIdentity(entry.name, entry.version);
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.tgz$/.test(entry.filename ?? '')) throw new Error('Unsafe staged filename.');
      const parent = await realpath(root), path = join(root, 'tarballs', entry.filename);
      const stat = await lstat(path), canonical = await realpath(path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== entry.size || !within(parent, canonical)) throw new Error('Staged artifact escaped ownership or changed size.');
      return readFile(path);
    },
    async lookup(name, version) {
      packageIdentity(name, version);
      const bytes = await request(new URL(`${encodeURIComponent(name)}/${encodeURIComponent(version)}`, base), 1024 * 1024, true);
      if (bytes === null) return null;
      let value;
      try { value = JSON.parse(bytes); } catch { throw new Error('Invalid registry metadata JSON.'); }
      if (value.name !== name || value.version !== version || typeof value.dist?.tarball !== 'string' || typeof value.dist?.integrity !== 'string') throw new Error('Registry metadata identity/integrity is invalid.');
      const url = new URL(value.dist.tarball);
      if (url.origin !== base.origin || url.username || url.password || url.hash || url.search) throw new Error('Registry tarball URL escaped the approved origin.');
      return { name, version, tarball: url.href, integrity: value.dist.integrity };
    },
    async readPublished(published) {
      packageIdentity(published.name, published.version);
      const bytes = await request(new URL(published.tarball), 5 * 1024 * 1024);
      // Both registry metadata and the immutable prepared manifest must agree.
      if (artifactDigests(bytes).integrity !== published.integrity) throw new Error('Registry integrity metadata mismatch.');
      return bytes;
    },
    async publish(entry, bytes, options) {
      packageIdentity(entry.name, entry.version);
      assertArtifact(entry, bytes);
      if (options?.tag !== CANDIDATE_CHANNEL) throw new Error('Stable or arbitrary dist-tags are forbidden.');
      if (!testRegistry && !authorizePublicPublish) throw new Error('Public registry writes require verified release authorization.');
      const temporary = await mkdtemp(join(tmpdir(), 'forgeqa-npm-publish-'));
      try {
        const tarball = join(temporary, entry.filename);
        await writeFile(tarball, bytes, { flag: 'wx', mode: 0o600 });
        // Test credentials are meaningful only on this owned loopback origin.
        const userConfig = join(temporary, '.npmrc');
        if (testRegistry) await writeFile(userConfig, `//${base.host}/:_authToken=forgeqa-loopback-fixture\n`, { mode: 0o600 });
        else await writeFile(userConfig, npmUserConfig ? await readFile(npmUserConfig) : '', { mode: 0o600 });
        const env = { ...process.env, NPM_CONFIG_USERCONFIG: userConfig, NPM_CONFIG_GLOBALCONFIG: join(temporary, 'empty-global.npmrc'),
          NPM_CONFIG_REGISTRY: base.href, NPM_CONFIG_FETCH_RETRIES: '0', NPM_CONFIG_FETCH_TIMEOUT: String(timeoutMs),
          NPM_CONFIG_IGNORE_SCRIPTS: 'true', NPM_CONFIG_AUDIT: 'false', NPM_CONFIG_FUND: 'false' };
        await writeFile(env.NPM_CONFIG_GLOBALCONFIG, '', { mode: 0o600 });
        // Publishing a verified private copy removes a verify/read/replace race.
        await runNpm(['publish', tarball, '--registry', base.href, '--tag', CANDIDATE_CHANNEL, '--access', 'public', '--ignore-scripts',
          '--fetch-retries', '0', ...(testRegistry ? ['--provenance=false'] : ['--provenance'])], { cwd: temporary, env, timeoutMs: timeoutMs + 15000 });
      } catch { throw new Error('npm publication was not confirmed; reconcile registry bytes before retrying.'); }
      finally { await rm(temporary, { recursive: true, force: true }); }
    },
    async save(manifest) { await saveManifestAtomically(join(root, 'release-manifest.json'), manifest); }
  };
}
