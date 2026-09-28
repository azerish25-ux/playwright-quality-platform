import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { validateBase, within } from './contracts.mjs';

const root = await realpath('evidence/docs/site');
const base = validateBase(process.env.FORGEQA_DOCS_BASE || '/playwright-quality-platform/');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ico': 'image/x-icon' };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    if (!pathname.startsWith(base)) { response.writeHead(404).end(); return; }
    let path = resolve(root, pathname.slice(base.length) || '.');
    if (!within(root, path)) { response.writeHead(403).end(); return; }
    if ((await stat(path)).isDirectory()) path = resolve(path, 'index.html');
    if (!within(root, await realpath(path))) { response.writeHead(403).end(); return; }
    const data = await readFile(path);
    response.writeHead(200, { 'content-type': mime[extname(path)] || 'application/octet-stream' }).end(data);
  } catch { response.writeHead(404).end(); }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const failures = [];
try {
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', (error) => failures.push(error.message));
  page.on('response', (response) => { if (response.url().startsWith(origin) && response.status() >= 400) failures.push(`${response.status()} ${response.url()}`); });
  await page.goto(`${origin}${base}`, { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'ForgeQA', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Start with the quickstart', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Source-candidate quickstart', exact: true })).toBeVisible();
  assert(page.url().startsWith(`${origin}${base}next/quickstart/`));
  await page.screenshot({ path: 'evidence/docs/desktop.png', fullPage: true });
  await page.getByRole('link', { name: /Search/ }).first().click();
  await page.locator('#mkdocs-search-query').fill('quarantine');
  await expect(page.locator('#mkdocs-search-results a').first()).toBeVisible();
  await page.screenshot({ path: 'evidence/docs/search.png' });
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}${base}next/quickstart/`, { waitUntil: 'networkidle' });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'Mobile documentation overflows its viewport.');
  await page.screenshot({ path: 'evidence/docs/mobile.png', fullPage: true });
  assert.deepEqual(failures, [], 'Documentation browser or asset failures.');
  await writeFile('evidence/docs/browser.json', `${JSON.stringify({ schemaVersion: 1, status: 'PASS', base, navigation: true, localSearch: true, mobileOverflow: false, consoleErrors: failures, publicationClaimed: false }, null, 2)}\n`);
  console.log('Documentation navigation, local search, mobile layout and asset checks passed.');
} finally {
  if (browser) await browser.close();
  await new Promise((done) => server.close(done));
}
