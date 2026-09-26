import { ConfigurationError } from '@azerish25-ux/forgeqa-core';
export class GuardedPostgresAdapter {
    executor;
    databaseName;
    requiredPrefix;
    constructor(executor, databaseName, requiredPrefix = 'forgeqa_test_') {
        this.executor = executor;
        this.databaseName = databaseName;
        this.requiredPrefix = requiredPrefix;
        if (!databaseName.startsWith(requiredPrefix))
            throw new ConfigurationError(`Database ${databaseName} is not an authorized test target.`);
    }
    async health() { await this.executor.query('SELECT 1 AS ok'); }
    async provision(namespace) { const tenantId = `${namespace}-tenant`; await this.executor.query('INSERT INTO forgeqa_test_tenants (id, owner_namespace) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING', [tenantId, namespace]); return { namespace, tenantId }; }
    async cleanup(provision) { const result = await this.executor.query('DELETE FROM forgeqa_test_tenants WHERE id = $1 AND owner_namespace = $2', [provision.tenantId, provision.namespace]); if ((result.rowCount ?? 0) > 1)
        throw new Error('Cleanup affected more than one owned tenant.'); }
    async reclaimStale(beforeIso, expectedOwnerPrefix) { if (!expectedOwnerPrefix.startsWith('forgeqa-'))
        throw new ConfigurationError('Stale reclamation requires a forgeqa-owned prefix.'); const result = await this.executor.query('DELETE FROM forgeqa_test_tenants WHERE owner_namespace LIKE $1 AND created_at < $2', [`${expectedOwnerPrefix}%`, beforeIso]); return result.rowCount ?? 0; }
}
//# sourceMappingURL=postgres.js.map