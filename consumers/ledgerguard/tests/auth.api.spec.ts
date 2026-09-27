import { forgeId, forgeOwner } from '@azerish25-ux/forgeqa-playwright';
import { test, expect } from './fixtures.js';

test('customer session lifecycle revokes access after logout', {
  tag: '@release',
  annotation: [forgeId('ledgerguard-auth-session'), forgeOwner('platform-quality')]
}, async ({ customer }) => {
  const current = await customer.client.me();
  expect(current.status).toBe(200);
  expect('email' in current.body && current.body.email).toBe(customer.identity.email);
  expect('role' in current.body && current.body.role).toBe('CUSTOMER');

  const logout = await customer.client.logout();
  expect(logout.status).toBe(204);

  const revoked = await customer.client.me();
  expect(revoked.status).toBe(401);
});

test('customer and administrator authorization remain separated', {
  tag: '@release',
  annotation: [forgeId('ledgerguard-auth-role-separation'), forgeOwner('platform-quality')]
}, async ({ customer, admin }) => {
  const denied = await customer.client.adminSecurityEvents();
  expect(denied.status).toBe(403);

  const allowed = await admin.client.adminSecurityEvents();
  expect(allowed.status).toBe(200);
  expect('items' in allowed.body && Array.isArray(allowed.body.items)).toBe(true);
});

test('account ownership hides another customer resource', {
  tag: '@release',
  annotation: [forgeId('ledgerguard-account-owner-scope'), forgeOwner('platform-quality')]
}, async ({ customer, otherCustomer }) => {
  const created = await customer.client.createAccount('Owner-only wallet');
  expect(created.status).toBe(201);

  const ownerRead = await customer.client.account(created.body.id);
  expect(ownerRead.status).toBe(200);

  const outsiderRead = await otherCustomer.client.account(created.body.id);
  expect(outsiderRead.status).toBe(404);
});
