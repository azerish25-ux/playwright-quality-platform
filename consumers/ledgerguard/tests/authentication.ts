import { request, type TestInfo } from '@playwright/test';
import { ownResource } from '@azerish25-ux/forgeqa-core';
import type { AuthenticationAdapter, AuthenticationIdentity, ForgeWorkerContext } from '@azerish25-ux/forgeqa-playwright';
import { LedgerGuardClient } from '../src/client.js';
import type { Actor } from './fixtures.js';

export function ledgerguardIdentity(forge: ForgeWorkerContext, info: TestInfo, role: 'CUSTOMER' | 'ADMIN', sequence: number): AuthenticationIdentity {
  return { application: 'ledgerguard', environment: forge.config.environment, role, project: info.project.name,
    configHash: forge.config.configHash, namespace: `${forge.namespace}-${sequence}`, runId: forge.runId,
    shard: info.config.shard?.current ?? 1, parallelIndex: info.parallelIndex, workerIndex: info.workerIndex,
    testId: info.testId, attempt: info.retry };
}

/** CSRF renewal and the application's real identity/role checks remain in this consumer. */
export function ledgerguardAuthentication(baseURL: string, credentials: { email: string; password: string; displayName?: string }): AuthenticationAdapter<Actor> {
  return {
    id: 'ledgerguard-session-v1',
    async authenticate(identity, scope, signal) {
      if (!['CUSTOMER', 'ADMIN'].includes(identity.role)) throw new Error('Unsupported LedgerGuard authentication role.');
      const context = await ownResource(scope, 'request-context', await request.newContext({ baseURL, timeout: 20_000 }), value => value.dispose());
      signal.throwIfAborted();
      const client = new LedgerGuardClient(context);
      if (identity.role === 'CUSTOMER') {
        if (!credentials.displayName) throw new Error('A new LedgerGuard customer requires a display name.');
        const registered = await client.registerAndLogin({ ...credentials, displayName: credentials.displayName });
        return { context, client, identity: registered };
      }
      const result = await client.login(credentials.email, credentials.password);
      if (result.status !== 200 || result.body.role !== 'ADMIN') throw new Error(`LedgerGuard administrator login failed with HTTP ${result.status}.`);
      // The seeded administrator is borrowed. Only its request context is owned here;
      // the acceptance harness owns database/container cleanup after reconciliation.
      return { context, client, identity: result.body };
    },
    async validate(actor, identity, signal) {
      signal.throwIfAborted();
      const current = await actor.client.me();
      if (current.status === 401) return false;
      if (current.status !== 200) throw new Error(`LedgerGuard session validation failed with HTTP ${current.status}.`);
      return 'id' in current.body && current.body.id === actor.identity.id && current.body.role === identity.role;
    },
    async storageState(actor, signal) { signal.throwIfAborted(); return actor.context.storageState(); },
  };
}
