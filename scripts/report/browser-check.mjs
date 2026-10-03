import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, firefox, webkit, expect } from '@playwright/test';
import { toHtmlReport } from '@azerish25-ux/forgeqa-reporter';
import { reportFixture } from './fixture.mjs';

const output = 'evidence/report-browser';
await mkdir(output, { recursive: true });
const run = reportFixture();
const states = {
  '/': run,
  '/empty': {
    ...run,
    attempts: [],
    missingExecutions: ['unobserved-execution'],
    completion: 'incomplete',
    gate: undefined
  },
  '/unevaluated': { ...run, gate: undefined },
  '/passed': { ...run, attempts: [run.attempts[0]], gate: { outcome: 'pass', violations: [] } },
  '/hostile': {
    ...run,
    attempts: [
      {
        ...run.attempts[0],
        title: '<img src=x onerror="alert(1)">',
        logicalTestId: '</script><script>alert(2)</script>'
      }
    ],
    evidence: {
      nativeReport: 'javascript:alert(3)',
      nativeJson: '//evil.invalid/a',
      artifactManifest: '../private.json',
      reconciliation: { status: 'MATCHED' },
      nativeBlobCount: 0,
      capturedArtifacts: 0,
      missingArtifacts: 0,
      unavailableArtifacts: 0
    }
  }
};
const server = createServer((request, response) => {
  const path = new URL(request.url, 'http://127.0.0.1').pathname;
  if (path === '/artifacts/diagnostic.txt') {
    response.writeHead(200, { 'content-type': 'text/plain' }).end('Synthetic diagnostic fixture.');
    return;
  }
  if (path === '/favicon.ico') {
    response.writeHead(204).end();
    return;
  }
  if (!states[path]) {
    response.writeHead(404).end();
    return;
  }
  response
    .writeHead(200, {
      'content-type': 'text/html',
      'content-security-policy':
        "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"
    })
    .end(toHtmlReport(states[path]));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const requested = (process.env.FORGEQA_REPORT_BROWSERS || 'chromium,firefox,webkit').split(',');
const engines = { chromium, firefox, webkit };
const results = [];
try {
  for (const name of requested) {
    assert(engines[name], `Unknown browser engine: ${name}`);
    const browser = await engines[name].launch(
      process.env.FORGEQA_BROWSER_EXECUTABLE ? { executablePath: process.env.FORGEQA_BROWSER_EXECUTABLE } : {}
    );
    let page;
    const errors = [],
      network = [],
      dialogs = [];
    try {
      page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('request', (request) => {
        if (!request.url().startsWith(origin)) network.push(request.url());
      });
      page.on('dialog', (dialog) => {
        dialogs.push(dialog.message());
        void dialog.dismiss();
      });
      await page.goto(origin);
      await expect(
        page.getByRole('heading', { name: 'This run needs attention.', exact: true })
      ).toBeVisible();
      await expect(page.getByRole('status')).toHaveText('7 of 7 executions');
      await expect(page.getByRole('button', { name: 'Clear filters', exact: true })).toBeDisabled();
      await page.keyboard.press('Tab');
      await expect(page.getByRole('link', { name: 'Skip to executions' })).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('heading', { name: 'Current executions' })).toBeFocused();
      await page.screenshot({ path: `${output}/${name}-desktop.png`, fullPage: true });
      const first = page.locator('.execution').first();
      assert.equal(await first.getAttribute('data-attention'), '1');
      await page.getByLabel('Search tests', { exact: true }).fill('  CHECKOUT  ');
      await expect(page.getByRole('status')).toHaveText('1 of 7 executions');
      await page.getByLabel('Outcome', { exact: true }).selectOption('failed');
      await expect(page.getByRole('heading', { name: 'No matching executions' })).toBeVisible();
      await page.getByRole('button', { name: 'Reset filters' }).click();
      await expect(page.getByLabel('Search tests', { exact: true })).toBeFocused();
      await expect(page.getByRole('status')).toHaveText('7 of 7 executions');
      await page.getByLabel('Search tests', { exact: true }).fill('payments');
      await page.getByLabel('Outcome', { exact: true }).selectOption('flaky');
      await page.reload();
      await expect(page.getByRole('status')).toHaveText('1 of 7 executions');
      await expect(page.getByLabel('Search tests', { exact: true })).toHaveValue('payments');
      const recovered = page.locator('.execution[data-outcome="flaky"]');
      await recovered.locator('summary').focus();
      await recovered.locator('summary').press('Enter');
      await expect(recovered.locator('details')).toHaveAttribute('open', '');
      await recovered.locator('summary').press('Enter');
      await expect(recovered.locator('details')).not.toHaveAttribute('open', '');
      await recovered.locator('summary').press('Enter');
      await expect(
        recovered.getByRole('heading', { name: 'Attempt 1 · failed · 1.64 s', exact: true })
      ).toBeVisible();
      await expect(
        recovered.getByRole('heading', { name: 'Attempt 2 · passed · 410 ms', exact: true })
      ).toBeVisible();
      await recovered.getByRole('link', { name: 'artifacts/diagnostic.txt', exact: true }).click();
      await expect(page.locator('body')).toContainText('Synthetic diagnostic fixture.');
      await page.goBack();
      await expect(page.getByRole('status')).toHaveText('1 of 7 executions');
      await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
      await page.getByLabel('Sort by', { exact: true }).selectOption('duration');
      await expect(page.locator('.execution').first()).toHaveAttribute('data-duration', '5200');
      await page.getByLabel('Sort by', { exact: true }).selectOption('name');
      const names = await page
        .locator('.execution')
        .evaluateAll((rows) => rows.map((row) => row.dataset.search));
      assert.deepEqual(
        names,
        [...names].sort((a, b) => a.localeCompare(b))
      );
      await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: `${output}/${name}-mobile.png`, fullPage: true });
      for (const width of [320, 390, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        assert(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          `Horizontal overflow at ${width}px in ${name}`
        );
      }
      await page.setViewportSize({ width: 390, height: 844 });
      const disclosure = page.locator('.execution[data-outcome="flaky"] details');
      if (!(await disclosure.evaluate((element) => element.open)))
        await disclosure.locator('summary').click();
      await expect(
        disclosure.getByRole('heading', { name: 'Attempt 1 · failed · 1.64 s', exact: true })
      ).toBeVisible();
      assert(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        'Expanded evidence overflows mobile viewport'
      );
      await page.screenshot({ path: `${output}/${name}-evidence.png`, fullPage: true });
      await page.goto(`${origin}/?outcome=untrusted&sort=untrusted&q=nomatch`);
      await expect(page.getByLabel('Outcome', { exact: true })).toHaveValue('all');
      await expect(page.getByLabel('Sort by', { exact: true })).toHaveValue('attention');
      await page.getByRole('button', { name: 'Reset filters' }).click();
      await page.goto(`${origin}/empty`);
      await expect(page.getByRole('heading', { name: 'The evidence is incomplete.' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'No executions recorded' })).toBeVisible();
      await expect(page.getByText('unobserved-execution', { exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'No matching executions' })).toBeHidden();
      await page.goto(`${origin}/unevaluated`);
      await expect(page.getByRole('heading', { name: 'The gate is not evaluated.' })).toBeVisible();
      await page.goto(`${origin}/passed`);
      await expect(page.getByRole('heading', { name: 'The evidence checks out.' })).toBeVisible();
      await page.goto(`${origin}/hostile`);
      await expect(
        page.getByRole('heading', { name: '<img src=x onerror="alert(1)">', exact: true })
      ).toBeVisible();
      assert.equal(await page.locator('a[href^="javascript:"], a[href^="//"], a[href^="../"]').count(), 0);
      assert(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        'Hostile long text overflows'
      );
      const plain = await browser.newContext({
        javaScriptEnabled: false,
        viewport: { width: 390, height: 844 }
      });
      const noJs = await plain.newPage();
      await noJs.goto(origin);
      assert.equal(await noJs.locator('.execution:visible').count(), 7);
      await expect(noJs.getByRole('search')).toBeHidden();
      await noJs.locator('.execution[data-outcome="flaky"] summary').click();
      await expect(
        noJs.getByRole('heading', { name: 'Attempt 1 · failed · 1.64 s', exact: true })
      ).toBeVisible();
      await plain.close();
      assert.deepEqual(errors, [], `${name} page errors`);
      assert.deepEqual(network, [], `${name} unexpected network requests`);
      assert.deepEqual(dialogs, [], `${name} active injected content`);
      results.push({
        browser: name,
        status: 'PASS',
        executable: process.env.FORGEQA_BROWSER_EXECUTABLE
          ? 'explicit-local-browser'
          : 'pinned-playwright-browser',
        cases: [
          'filter-intersection',
          'empty-reset-focus',
          'reload-and-back',
          'sort',
          'original-attempts',
          'local-artifact-link',
          'five-responsive-widths',
          'mobile-expanded-evidence',
          'missing-and-unevaluated-states',
          'hostile-content',
          'no-javascript',
          'no-external-requests'
        ]
      });
      console.log(
        `${name}: report interactions, accessibility semantics, responsive layout and security checks passed.`
      );
    } catch (error) {
      if (page)
        await page.screenshot({ path: `${output}/${name}-failure.png`, fullPage: true }).catch(() => {});
      throw error;
    } finally {
      await browser.close();
    }
  }
  await writeFile(
    `${output}/acceptance.json`,
    `${JSON.stringify({ schemaVersion: 1, kind: 'report-browser-acceptance', sourceSha: process.env.FORGEQA_SOURCE_SHA ?? null, syntheticFixture: true, results }, null, 2)}\n`
  );
} finally {
  await new Promise((resolve) => server.close(resolve));
}
