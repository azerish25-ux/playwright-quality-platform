import type { Page } from '@playwright/test';
import { stableHash } from '@azerish25-ux/forgeqa-core';
import { forgeId, forgeOwner } from '@azerish25-ux/forgeqa-playwright';
import { test, expect, type Actor } from './fixtures.js';
import type { PaymentReceipt, TransferReceipt } from '../src/types.js';

const pageErrors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = []; pageErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
});
test.afterEach(async ({ page }, info) => {
  // Synthetic disposable identities only. Traces/videos and credential state stay disabled.
  await info.attach('screenshot', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  expect(pageErrors.get(page)).toEqual([]);
});
async function authenticateBrowser(page: Page, actor: Actor): Promise<void> {
  // Real API-issued cookies, never a mocked auth endpoint or a fabricated session.
  await page.context().addCookies((await actor.context.storageState()).cookies);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: `Welcome, ${actor.identity.displayName}` })).toBeVisible();
}

test('real browser registration, zero-balance wallet, logout and sign-in preserve ownership', {
  tag: '@release', annotation: [forgeId('ledgerguard-ui-auth-wallet'), forgeOwner('platform-quality')]
}, async ({ page, forge }, info) => {
  const suffix = stableHash({ run: forge.runId, project: info.project.name, test: info.testId }).slice(0, 16);
  const name = `Deadpan ${suffix}`, email = `deadpan-ui-${suffix}@example.test`, password = `Fq!${suffix}Aa9`;
  await page.goto('/register');
  await page.getByLabel('Display name').fill(name);
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password').fill(password);
  await page.getByRole('button', { name: 'Create customer' }).click();
  await expect(page.getByRole('heading', { name: `Welcome, ${name}` })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No wallets yet' })).toBeVisible();
  await page.getByLabel('Account name').fill('Deadpan browser wallet');
  await page.getByLabel('Currency').selectOption('CAD');
  await page.getByRole('button', { name: 'Open wallet' }).click();
  const wallet = page.getByRole('article', { name: 'Deadpan browser wallet' });
  await expect(wallet.getByText('CAD 0.00', { exact: true })).toHaveCount(3);
  const accountResponse = await page.request.get('/api/v1/accounts');
  expect(accountResponse.status()).toBe(200);
  const accounts = await accountResponse.json();
  expect(accounts.items).toHaveLength(1); expect(accounts.items[0].postedMinor).toBe('0'); expect(accounts.items[0].reservedMinor).toBe('0');
  expect((await page.context().cookies()).find(cookie => cookie.name === 'LG-SESSION')?.httpOnly).toBe(true);
  expect(await page.evaluate(() => Object.keys(localStorage).filter(key => /session|csrf|token|password/i.test(key)))).toEqual([]);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  expect((await page.request.get('/api/v1/auth/me')).status()).toBe(401);
  await page.getByLabel('Email address').fill(email); await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in securely' }).click();
  await expect(wallet).toBeVisible();
});

test('real transfer confirmation and lost-response replay produce one economic effect', {
  tag: '@release', annotation: [forgeId('ledgerguard-ui-transfer-recovery'), forgeOwner('platform-quality')]
}, async ({ page, fundedPair, lab }) => {
  await authenticateBrowser(page, fundedPair.payer);
  await page.goto('/transfers/new');
  await page.getByLabel('Source wallet').selectOption(fundedPair.source.id);
  await page.getByLabel('Recipient reference').fill(fundedPair.destination.publicRef);
  await page.getByLabel(/^Amount/).fill('25.00');
  await page.getByRole('button', { name: 'Review transfer' }).click();
  const dialog = page.getByRole('dialog', { name: 'Confirm transfer' });
  await expect(dialog).toBeVisible(); await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible();
  expect((await fundedPair.payer.client.transfers()).body.items).toHaveLength(0);
  let committed: TransferReceipt | undefined;
  await page.route('**/api/v1/transfers', async route => {
    if (route.request().method() === 'POST' && !committed) {
      const response = await route.fetch(); expect(response.status()).toBe(201);
      committed = await response.json() as TransferReceipt;
      await route.abort('failed');
    } else await route.continue();
  });
  await page.getByRole('button', { name: 'Review transfer' }).click();
  await dialog.getByRole('button', { name: 'Confirm and transfer' }).click();
  await expect(page.getByRole('heading', { name: 'Outcome not yet confirmed' }).last()).toBeVisible();
  await page.getByRole('button', { name: 'Retry same transfer' }).click();
  await expect(page.getByRole('heading', { name: 'Transfer receipt' })).toBeVisible();
  await expect(page.getByText('Recovered by safe replay.')).toBeVisible();
  await expect(page.getByText('Settled', { exact: true })).toBeVisible();
  await expect(page.getByText(fundedPair.destination.publicRef, { exact: true })).toBeVisible();
  if (!committed) throw new Error('The real transfer was never committed.');
  expect(lab.transferEffectCounts(committed.id)).toBe('1:1:1');
  expect((await fundedPair.payer.client.transfers()).body.items).toHaveLength(1);
  expect((await fundedPair.payer.client.account(fundedPair.source.id)).body).toMatchObject({ postedMinor: '47500', reservedMinor: '0', availableMinor: '47500' });
  expect((await fundedPair.recipient.client.account(fundedPair.destination.id)).body).toMatchObject({ postedMinor: '2500', reservedMinor: '0', availableMinor: '2500' });
});

test('real payment UI resolves asynchronous settlement and retains its authoritative journal', {
  tag: '@release', annotation: [forgeId('ledgerguard-ui-payment-settlement'), forgeOwner('platform-quality')]
}, async ({ page, fundedPair, lab }) => {
  await authenticateBrowser(page, fundedPair.payer);
  await page.goto('/payments/new');
  await page.getByLabel('Source wallet').selectOption(fundedPair.source.id);
  await page.getByLabel('Recipient reference').fill(fundedPair.destination.publicRef);
  await page.getByLabel(/^Amount/).fill('15.00');
  await page.getByRole('button', { name: 'Review payment' }).click();
  const dialog = page.getByRole('dialog', { name: 'Confirm payment' });
  await expect(dialog).toBeVisible();
  const responsePromise = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/v1/payments');
  await dialog.getByRole('button', { name: 'Confirm payment', exact: true }).click();
  const response = await responsePromise; expect(response.status()).toBe(202);
  const receipt = await response.json() as PaymentReceipt; expect(receipt.state).toBe('PENDING');
  await expect(page.getByRole('heading', { name: 'Payment details' })).toBeVisible();
  await expect(page.getByText('Settled', { exact: true })).toBeVisible({ timeout: 70000 });
  await expect(page.getByText('Settlement journal', { exact: true })).toBeVisible();
  expect((await fundedPair.payer.client.paymentById(receipt.id)).body).toMatchObject({ state: 'SETTLED', amountMinor: '1500' });
  expect(lab.paymentEffectCounts(receipt.id)).toBe('1:1:1');
  expect((await fundedPair.payer.client.account(fundedPair.source.id)).body).toMatchObject({ postedMinor: '48500', reservedMinor: '0', availableMinor: '48500' });
  await page.reload(); await expect(page.getByText('Settled', { exact: true })).toBeVisible();
});

test('customer browser cannot enter administration and expired sessions cannot retain financial access', {
  tag: '@release', annotation: [forgeId('ledgerguard-ui-role-session-boundary'), forgeOwner('platform-quality')]
}, async ({ page, customer }, info) => {
  await authenticateBrowser(page, customer);
  await page.goto('/admin/transactions');
  await expect(page.getByRole('heading', { name: 'Administrator access required', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Administrator investigation', exact: true })).toHaveCount(0);
  expect((await page.request.get('/api/v1/admin/transactions')).status()).toBe(403);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Refresh balances' })).toBeVisible();
  await page.context().clearCookies(); await page.getByRole('button', { name: 'Refresh balances' }).click();
  const dialog = page.getByRole('dialog', { name: 'Your session ended' });
  await expect(dialog).toBeVisible();
  await info.attach('screenshot', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  await dialog.getByRole('button', { name: 'Continue to sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible();
  expect((await page.request.get('/api/v1/accounts')).status()).toBe(401);
});
