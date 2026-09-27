import { createServer, type ServerResponse } from 'node:http';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { ConfigurationError, IntegrityError } from '@azerish25-ux/forgeqa-core';

export interface ServeReportOptions {
  root: string;
  host: string;
  port: number;
  json: boolean;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.log': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
  '.webm': 'video/webm',
  '.xml': 'application/xml; charset=utf-8',
  '.zip': 'application/zip'
};

function inside(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}
function send(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'content-length': Buffer.byteLength(body) });
  response.end(body);
}
function securityHeaders(response: ServerResponse): void {
  response.setHeader('cache-control', 'no-store');
  response.setHeader('content-security-policy', "default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self'; font-src 'self' data:; connect-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  response.setHeader('cross-origin-resource-policy', 'same-origin');
  response.setHeader('referrer-policy', 'no-referrer');
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('x-frame-options', 'DENY');
}
function requestPath(url: string | undefined): string {
  let value: string;
  try { value = decodeURIComponent(new URL(url ?? '/', 'http://forgeqa.local').pathname); }
  catch { throw new ConfigurationError('Malformed report URL.'); }
  if (value.includes('\0') || value.includes('\\')) throw new ConfigurationError('Unsafe report path.');
  const segments = value.split('/').filter(Boolean);
  if (segments.some(segment => segment === '.' || segment === '..')) throw new ConfigurationError('Unsafe report path.');
  return segments.length ? segments.join('/') : 'index.html';
}

export async function serveReport(options: ServeReportOptions): Promise<void> {
  if (!LOOPBACK_HOSTS.has(options.host)) throw new ConfigurationError('Report serving is loopback-only; use 127.0.0.1, localhost, or ::1.');
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65_535) throw new ConfigurationError('Report server port must be an integer from 0 through 65535.');
  const root = await realpath(resolve(options.root));
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new ConfigurationError('Report root must be a real directory.');
  const index = resolve(root, 'index.html');
  const indexStat = await lstat(index);
  if (!indexStat.isFile() || indexStat.isSymbolicLink() || indexStat.size === 0) throw new IntegrityError('Report root does not contain a regular, non-empty index.html.');

  const server = createServer(async (request, response) => {
    securityHeaders(response);
    if (!['GET', 'HEAD'].includes(request.method ?? '')) { response.setHeader('allow', 'GET, HEAD'); send(response, 405, 'Method not allowed.\n'); return; }
    try {
      const path = requestPath(request.url);
      const candidate = resolve(root, path);
      if (!inside(root, candidate)) throw new ConfigurationError('Unsafe report path.');
      const stat = await lstat(candidate);
      if (!stat.isFile() || stat.isSymbolicLink()) { send(response, 404, 'Not found.\n'); return; }
      const canonical = await realpath(candidate);
      if (!inside(root, canonical)) throw new ConfigurationError('Unsafe report path.');
      const body = request.method === 'HEAD' ? undefined : await readFile(canonical);
      response.writeHead(200, {
        'content-type': CONTENT_TYPES[extname(canonical).toLowerCase()] ?? 'application/octet-stream',
        'content-length': stat.size
      });
      response.end(body);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') { send(response, 404, 'Not found.\n'); return; }
      if (error instanceof ConfigurationError) { send(response, 400, 'Unsafe request.\n'); return; }
      send(response, 500, 'Report evidence could not be read.\n');
    }
  });

  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host, () => { server.off('error', reject); resolveListen(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string') { server.close(); throw new IntegrityError('Report server did not expose a TCP address.'); }
  const displayHost = options.host === '::1' ? '[::1]' : options.host;
  const url = `http://${displayHost}:${address.port}/`;
  process.stdout.write(options.json ? `${JSON.stringify({ root, host: options.host, port: address.port, url })}\n` : `ForgeQA report: ${url}\nServing ${root}\n`);

  await new Promise<void>((done) => {
    let closing = false;
    const close = (): void => {
      if (closing) return;
      closing = true;
      server.close(() => done());
      server.closeAllConnections();
    };
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
    server.once('close', () => {
      process.off('SIGINT', close);
      process.off('SIGTERM', close);
      done();
    });
  });
}
