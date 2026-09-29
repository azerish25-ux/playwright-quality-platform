import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { RELEASE_PACKAGES, CANDIDATE_CHANNEL } from '../../scripts/release-state.mjs';

/** Disposable protocol fixture: real npm CLI PUT/GET traffic, no external writes,
 * no upstream proxy and no claim that this is public npm acceptance.
 */
export async function startRegistry() {
  const packages = new Map(), requests = [], publications = [];
  const faults = { beforeUpload: null, afterUpload: null, readStatus: null, metadata: null };
  let url;
  const server = createServer((req, res) => {
    void (async () => {
      requests.push({ method: req.method, path: req.url });
      const send = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
      const path = decodeURIComponent(new URL(req.url, url).pathname).slice(1);
      if (req.method === 'PUT') {
        if (req.headers.authorization !== 'Bearer forgeqa-loopback-fixture') return send(401, { error: 'Fixture authentication required.' });
        if (faults.beforeUpload?.(publications.length, path)) { req.resume(); res.destroy(); return; }
        const chunks = []; let length = 0;
        for await (const chunk of req) { length += chunk.length; if (length > 8 * 1024 * 1024) return send(413, { error: 'Too large.' }); chunks.push(chunk); }
        const metadata = JSON.parse(Buffer.concat(chunks).toString());
        const versions = Object.keys(metadata.versions ?? {}), attachments = Object.entries(metadata._attachments ?? {}), tags = Object.keys(metadata['dist-tags'] ?? {});
        if (!RELEASE_PACKAGES.includes(path) || metadata.name !== path || versions.length !== 1 || attachments.length !== 1 || tags.length !== 1 || tags[0] !== CANDIDATE_CHANNEL || metadata['dist-tags'][CANDIDATE_CHANNEL] !== versions[0]) return send(400, { error: 'Invalid fixture publication.' });
        const version = versions[0], key = `${path}@${version}`, published = metadata.versions[version];
        if (packages.has(key)) return send(409, { error: 'Immutable version already exists.' });
        const [filename, attachment] = attachments[0], bytes = Buffer.from(attachment.data, 'base64');
        const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
        if (bytes.length !== attachment.length || published.name !== path || published.version !== version || published.dist?.integrity !== integrity) return send(400, { error: 'Invalid actual tarball.' });
        published.dist = { ...published.dist, tarball: `${url}${encodeURIComponent(path)}/-/${filename}`, integrity };
        packages.set(key, { metadata: published, bytes, filename }); publications.push(key);
        if (faults.afterUpload?.(publications.length, path)) { res.destroy(); return; }
        return send(201, { ok: true });
      }
      if (req.method !== 'GET') return send(405, { error: 'Unsupported fixture method.' });
      if (faults.readStatus) return send(faults.readStatus, { error: 'Injected read failure.' });
      const tar = path.match(/^(@[^/]+\/[^/]+)\/-\/(.+)$/);
      if (tar) {
        const entry = [...packages.values()].find(value => value.metadata.name === tar[1] && value.filename === tar[2]);
        if (!entry) return send(404, { error: 'Not found.' });
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': entry.bytes.length }); res.end(entry.bytes); return;
      }
      const match = path.match(/^(@[^/]+\/[^/]+)(?:\/(.+))?$/);
      if (!match || !RELEASE_PACKAGES.includes(match[1])) return send(404, { error: 'No upstream fixture access.' });
      if (match[2]) {
        const entry = packages.get(`${match[1]}@${match[2]}`);
        return entry ? send(200, faults.metadata ? faults.metadata(structuredClone(entry.metadata)) : entry.metadata) : send(404, { error: 'Not found.' });
      }
      const all = [...packages.values()].filter(entry => entry.metadata.name === match[1]);
      if (!all.length) return send(404, { error: 'Not found.' });
      send(200, { name: match[1], versions: Object.fromEntries(all.map(entry => [entry.metadata.version, entry.metadata])), 'dist-tags': { [CANDIDATE_CHANNEL]: all.at(-1).metadata.version } });
    })().catch(() => { if (!res.destroyed) { res.writeHead(500); res.end('{}'); } });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  url = `http://127.0.0.1:${server.address().port}/`;
  return { url, faults, packages, requests, publications,
    async close() { const closed = once(server, 'close'); server.close(); server.closeAllConnections(); await closed; } };
}
