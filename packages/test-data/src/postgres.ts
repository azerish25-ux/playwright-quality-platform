import { ConfigurationError, type RecoveryAdapter, type RecoveryJournal, type RecoveryRecord } from '@azerish25-ux/forgeqa-core';

export interface SqlExecutor { query<T = unknown>(text: string, values?: unknown[]): Promise<{ rows: T[]; rowCount?: number }>; }
export interface PostgresProvision { namespace: string; tenantId: string; }
interface TenantRow { id: string; owner_namespace: string; }

function namespaceValue(value: string): void {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/.test(value)) {
    throw new ConfigurationError('A bounded, non-empty namespace using letters, numbers, hyphens or underscores is required.');
  }
}
function affectedRows(value: number | undefined): number {
  if (!Number.isSafeInteger(value) || value! < 0) throw new Error('PostgreSQL cleanup did not return a valid affected-row count.');
  return value!;
}

export class GuardedPostgresAdapter {
  constructor(private readonly executor: SqlExecutor, private readonly databaseName: string, private readonly requiredPrefix = 'forgeqa_test_') {
    if (!requiredPrefix || !/^[a-zA-Z0-9_]{1,63}$/.test(databaseName) || !databaseName.startsWith(requiredPrefix)) {
      throw new ConfigurationError(`Database ${databaseName} is not an authorized test target.`);
    }
  }

  private async verifyTarget(): Promise<void> {
    const result = await this.executor.query<{ database_name: string }>('SELECT current_database() AS database_name');
    if (result.rows.length !== 1 || result.rows[0]?.database_name !== this.databaseName) {
      throw new ConfigurationError('The connected PostgreSQL database does not match the authorized test target.');
    }
  }

  async health(): Promise<void> { await this.verifyTarget(); }

  async provision(namespace: string): Promise<PostgresProvision> {
    namespaceValue(namespace);
    await this.verifyTarget();
    const tenantId = `${namespace}-tenant`;
    const inserted = await this.executor.query<TenantRow>(
      'INSERT INTO forgeqa_test_tenants (id, owner_namespace) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING RETURNING id, owner_namespace',
      [tenantId, namespace]
    );
    const rows = inserted.rows.length ? inserted.rows : (await this.executor.query<TenantRow>(
      'SELECT id, owner_namespace FROM forgeqa_test_tenants WHERE id = $1', [tenantId]
    )).rows;
    if (rows.length !== 1 || rows[0]?.id !== tenantId || rows[0]?.owner_namespace !== namespace) {
      throw new ConfigurationError('Provisioning collided with a tenant not owned by the requested namespace.');
    }
    return { namespace, tenantId };
  }

  async cleanup(provision: PostgresProvision): Promise<void> {
    namespaceValue(provision?.namespace);
    if (provision.tenantId !== `${provision.namespace}-tenant`) throw new ConfigurationError('Cleanup tenant identity does not belong to its declared namespace.');
    await this.verifyTarget();
    const result = await this.executor.query('DELETE FROM forgeqa_test_tenants WHERE id = $1 AND owner_namespace = $2', [provision.tenantId, provision.namespace]);
    if (affectedRows(result.rowCount) > 1) throw new Error('Cleanup affected more than one owned tenant.');
  }

  /** Uses exact owned tenant identity; credentials are supplied by this trusted adapter, never the journal. */
  recoveryAdapter(): RecoveryAdapter {
    return {
      id: 'forgeqa-postgres-tenant-v1', target: this.databaseName,
      reclaim: async (record, owner, signal) => {
        signal.throwIfAborted();
        if (record.ownerId !== owner.id || record.adapter !== 'forgeqa-postgres-tenant-v1'
          || record.target !== this.databaseName || record.key !== `forgeqa-${owner.id}-tenant`) {
          throw new ConfigurationError('PostgreSQL recovery requires the exact owned tenant and authorized target.');
        }
        await this.cleanup({ namespace: `forgeqa-${owner.id}`, tenantId: record.key });
      },
    };
  }

  /** The durable intent precedes INSERT, including failures before the provisioning response arrives. */
  async provisionRecoverable(journal: RecoveryJournal): Promise<{ provision: PostgresProvision; record: Readonly<RecoveryRecord> }> {
    const namespace = `forgeqa-${journal.owner.id}`;
    namespaceValue(namespace);
    const record = await journal.reserve({ adapter: 'forgeqa-postgres-tenant-v1', target: this.databaseName, key: `${namespace}-tenant` });
    const provision = await journal.acquire(record, () => this.provision(namespace));
    return { provision, record };
  }

  async reclaimStale(beforeIso: string, expectedOwnerPrefix: string): Promise<number> {
    if (typeof expectedOwnerPrefix !== 'string' || !/^forgeqa-[a-zA-Z0-9][a-zA-Z0-9_-]{1,111}$/.test(expectedOwnerPrefix)) {
      throw new ConfigurationError('Stale reclamation requires a specific, literal forgeqa-owned prefix.');
    }
    if (typeof beforeIso !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(beforeIso)) {
      throw new ConfigurationError('Stale reclamation requires a valid UTC cutoff that is not in the future.');
    }
    const cutoff = Date.parse(beforeIso);
    const canonical = beforeIso.length === 20 ? beforeIso.replace('Z', '.000Z') : beforeIso;
    if (!Number.isFinite(cutoff) || new Date(cutoff).toISOString() !== canonical || cutoff > Date.now()) {
      throw new ConfigurationError('Stale reclamation requires a valid UTC cutoff that is not in the future.');
    }
    await this.verifyTarget();
    // Unlike LIKE, literal prefix comparison cannot treat underscores as wildcards.
    const result = await this.executor.query(
      'DELETE FROM forgeqa_test_tenants WHERE left(owner_namespace, length($1::text)) = $1 AND created_at < $2::timestamptz',
      [expectedOwnerPrefix, beforeIso]
    );
    return affectedRows(result.rowCount);
  }
}
