import { ConfigurationError } from '@azerish25-ux/forgeqa-core';
export interface SqlExecutor { query<T=unknown>(text:string, values?:unknown[]):Promise<{rows:T[];rowCount?:number}>; }
export interface PostgresProvision { namespace:string; tenantId:string; }
export class GuardedPostgresAdapter {
  constructor(private readonly executor:SqlExecutor, private readonly databaseName:string, private readonly requiredPrefix='forgeqa_test_') { if(!databaseName.startsWith(requiredPrefix)) throw new ConfigurationError(`Database ${databaseName} is not an authorized test target.`); }
  async health():Promise<void>{await this.executor.query('SELECT 1 AS ok');}
  async provision(namespace:string):Promise<PostgresProvision>{ const tenantId=`${namespace}-tenant`; await this.executor.query('INSERT INTO forgeqa_test_tenants (id, owner_namespace) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING',[tenantId,namespace]); return {namespace,tenantId}; }
  async cleanup(provision:PostgresProvision):Promise<void>{ const result=await this.executor.query('DELETE FROM forgeqa_test_tenants WHERE id = $1 AND owner_namespace = $2',[provision.tenantId,provision.namespace]); if((result.rowCount??0)>1) throw new Error('Cleanup affected more than one owned tenant.'); }
  async reclaimStale(beforeIso:string, expectedOwnerPrefix:string):Promise<number>{ if(!expectedOwnerPrefix.startsWith('forgeqa-')) throw new ConfigurationError('Stale reclamation requires a forgeqa-owned prefix.'); const result=await this.executor.query('DELETE FROM forgeqa_test_tenants WHERE owner_namespace LIKE $1 AND created_at < $2',[`${expectedOwnerPrefix}%`,beforeIso]); return result.rowCount??0; }
}
