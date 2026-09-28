import { ForgeHttpClient } from '@azerish25-ux/forgeqa-api';
import { CleanupRegistry, defineDataFactory } from '@azerish25-ux/forgeqa-test-data';

export const customer = defineDataFactory('docs-customer', (context) => ({
  // Logical values reproduce across workers; physical keys remain run-owned.
  tier: context.pick(['standard', 'premium'] as const),
  externalId: `${context.namespace}-${context.sequence}`,
}));

export async function checkReadiness(baseUrl: string, signal?: AbortSignal) {
  const client = new ForgeHttpClient(baseUrl);
  return client.get<{ status: string }>('/health', { timeoutMs: 5000, signal });
}

export async function demonstrateOwnedCleanup() {
  const cleanup = new CleanupRegistry('docs-owned-namespace');
  let deleted = false;
  cleanup.register({
    id: 'example', ownerNamespace: 'docs-owned-namespace', description: 'In-memory example',
    cleanup: async () => { deleted = true; },
  });
  const result = await cleanup.run();
  if (result.failures.length || !deleted) throw new Error('Owned cleanup failed.');
  return result;
}
