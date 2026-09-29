import { request, type APIRequestContext, type TestInfo } from '@playwright/test';
import { ownResource } from '@azerish25-ux/forgeqa-core';
import type { AuthenticationAdapter, AuthenticationIdentity, FeatureFlagAdapter, ForgeWorkerContext } from '@azerish25-ux/forgeqa-playwright';
import type { Tenant } from './fixtures.js';

export function teamboardIdentity(forge: ForgeWorkerContext, info: TestInfo, tenant: Tenant, role: string): AuthenticationIdentity {
  return { application: 'teamboard', environment: forge.config.environment, role, project: info.project.name,
    configHash: forge.config.configHash, namespace: tenant.namespace, runId: forge.runId,
    shard: info.config.shard?.current ?? 1, parallelIndex: info.parallelIndex, workerIndex: info.workerIndex,
    testId: info.testId, attempt: info.retry };
}

/** The application owns provisioning; ForgeQA owns the request/state-file lifecycle. */
export function teamboardAuthentication(baseURL: string, tenant: Tenant): AuthenticationAdapter<APIRequestContext> {
  return {
    id: 'teamboard-password-v1',
    async authenticate(identity, scope, signal) {
      if (!['owner', 'editor', 'viewer'].includes(identity.role) || identity.namespace !== tenant.namespace) throw new Error('TeamBoard authentication ownership or role mismatch.');
      const context = await ownResource(scope, 'request-context', await request.newContext({ baseURL, timeout: 10_000 }), value => value.dispose());
      signal.throwIfAborted();
      const account = tenant.accounts[identity.role as keyof Tenant['accounts']];
      const response = await context.post('/api/login', { data: { email: account.email, password: account.password } });
      if (response.status() !== 200) throw new Error(`TeamBoard login failed with HTTP ${response.status()}.`);
      return context;
    },
    async validate(context, identity, signal) {
      signal.throwIfAborted();
      const me = await context.get('/api/me');
      if (me.status() === 401) return false;
      if (me.status() !== 200) throw new Error(`TeamBoard session validation failed with HTTP ${me.status()}.`);
      const account = tenant.accounts[identity.role as keyof Tenant['accounts']];
      if ((await me.json()).id !== account?.id) return false;
      const response = await context.get('/api/workspaces');
      if (response.status() !== 200) throw new Error(`TeamBoard role validation failed with HTTP ${response.status()}.`);
      const workspaces = await response.json() as Array<{ id: string; role: string }>;
      return workspaces.some(workspace => workspace.id === tenant.workspaceId && workspace.role === identity.role);
    },
    async storageState(context, signal) { signal.throwIfAborted(); return context.storageState(); },
  };
}

export function teamboardFlags(context: APIRequestContext, tenant: Tenant): FeatureFlagAdapter {
  const check = (namespace: string) => { if (namespace !== tenant.namespace) throw new Error('Foreign TeamBoard flag namespace refused.'); };
  return {
    id: 'teamboard-workspace-flags', isolation: 'tenant',
    async read(namespace, signal) {
      check(namespace); signal.throwIfAborted();
      const response = await context.get('/api/workspaces');
      if (response.status() !== 200) throw new Error('Unable to read TeamBoard flags.');
      const rows = await response.json() as Array<{ id: string; attachments_enabled: boolean }>;
      const workspace = rows.find(row => row.id === tenant.workspaceId);
      if (!workspace) throw new Error('Owned TeamBoard workspace is missing.');
      return { attachments: workspace.attachments_enabled };
    },
    async replace(namespace, flags, signal) {
      check(namespace); signal.throwIfAborted();
      if (Object.keys(flags).length !== 1 || typeof flags.attachments !== 'boolean') throw new Error('Unsupported TeamBoard flag snapshot.');
      const response = await context.patch(`/api/workspaces/${tenant.workspaceId}/settings`, { data: { attachmentsEnabled: flags.attachments }, timeout: 4_000 });
      if (response.status() !== 200) throw new Error('Unable to replace TeamBoard flags.');
    },
  };
}
