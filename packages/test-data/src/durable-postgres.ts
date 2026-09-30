import { randomUUID } from 'node:crypto';
import { ConfigurationError, IntegrityError } from '@azerish25-ux/forgeqa-core';
import type { SqlExecutor } from './postgres.js';

/** Apply explicitly with a migration role in an authorized disposable database.
 * Runtime roles need SELECT/INSERT/UPDATE on owners, SELECT/INSERT/DELETE on tenants,
 * and column-level UPDATE(id) on tenants for the idempotent upsert.
 * Tombstones are retained deliberately: a sealed owner must never be resurrected.
 */
export const DURABLE_POSTGRES_SCHEMA = `
CREATE TABLE forgeqa_test_lease_owners (
  id uuid PRIMARY KEY,
  consumer text NOT NULL,
  namespace text NOT NULL,
  run_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'sealed'))
);
CREATE INDEX forgeqa_test_lease_expiry ON forgeqa_test_lease_owners (consumer, namespace, expires_at) WHERE state = 'active';
CREATE TABLE forgeqa_test_leased_tenants (
  id text PRIMARY KEY,
  owner_id uuid NOT NULL UNIQUE REFERENCES forgeqa_test_lease_owners(id)
);`;

export interface DurablePostgresIdentity { consumer: string; namespace: string; runId: string; }
export interface DurablePostgresLease extends DurablePostgresIdentity { id: string; }
export interface DurablePostgresTenant { id: string; ownerId: string; }
export interface DurableReclamation { dryRun: boolean; owners: string[]; tenantsRemoved: number; }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function label(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:@+-]{0,119}$/.test(value);
}
function identity(value: DurablePostgresIdentity): void {
  if (!value || ![value.consumer, value.namespace, value.runId].every(label)) throw new ConfigurationError('Durable recovery needs exact bounded consumer, namespace and run identifiers.');
}
function lease(value: DurablePostgresLease): unknown[] {
  identity(value);
  if (typeof value.id !== 'string' || !UUID.test(value.id)) throw new ConfigurationError('Invalid durable lease identity.');
  return [value.id, value.consumer, value.namespace, value.runId];
}
function duration(ttlMs: number): void {
  if (!Number.isSafeInteger(ttlMs) || ttlMs < 1000 || ttlMs > 86_400_000) throw new ConfigurationError('Lease duration must be 1000..86400000 milliseconds.');
}
const MATCH = 'id = $1::uuid AND consumer = $2 AND namespace = $3 AND run_id = $4';
const LIVE = "state = 'active' AND expires_at > clock_timestamp()";

/** PostgreSQL is the external ownership, clock and serialization authority.
 * No process IDs, runner disks, client timestamps or host-liveness guesses are used.
 * All supported tenant mutations lock the owner row in the same SQL statement.
 * This contract cannot fence unrelated application queries or external API writes.
 */
export class DurablePostgresAdapter {
  constructor(private readonly executor: SqlExecutor, private readonly databaseName: string) {
    if (typeof databaseName !== 'string' || !/^forgeqa_test(?:_[a-z0-9_]+)?$/.test(databaseName) || databaseName.length > 63) {
      throw new ConfigurationError('Durable recovery requires an explicitly authorized forgeqa_test database.');
    }
  }

  private async target(): Promise<void> {
    const result = await this.executor.query<{ database_name: string }>('SELECT current_database() AS database_name');
    if (result.rows.length !== 1 || result.rows[0]?.database_name !== this.databaseName) throw new ConfigurationError('Durable recovery database identity mismatch.');
  }

  async createOwner(value: DurablePostgresIdentity, ttlMs = 60_000): Promise<Readonly<DurablePostgresLease>> {
    identity(value); duration(ttlMs); await this.target();
    const owner = { id: randomUUID(), consumer: value.consumer, namespace: value.namespace, runId: value.runId };
    const result = await this.executor.query<{ id: string }>(`INSERT INTO forgeqa_test_lease_owners (id, consumer, namespace, run_id, expires_at)
      VALUES ($1::uuid, $2, $3, $4, clock_timestamp() + $5::double precision * interval '1 millisecond') RETURNING id`, [...lease(owner), ttlMs]);
    if (result.rows.length !== 1 || result.rows[0]?.id !== owner.id) throw new IntegrityError('Durable owner creation was not acknowledged.');
    return Object.freeze(owner);
  }

  async renew(owner: DurablePostgresLease, ttlMs = 60_000): Promise<void> {
    const values = lease(owner); duration(ttlMs); await this.target();
    const result = await this.executor.query<{ id: string }>(`UPDATE forgeqa_test_lease_owners
      SET expires_at = clock_timestamp() + $5::double precision * interval '1 millisecond'
      WHERE ${MATCH} AND ${LIVE} RETURNING id`, [...values, ttlMs]);
    if (result.rows.length !== 1 || result.rows[0]?.id !== owner.id) throw new IntegrityError('Durable owner expired, sealed or no longer matches. Create a new owner; do not resume stale work.');
  }

  async provision(owner: DurablePostgresLease): Promise<DurablePostgresTenant> {
    const values = lease(owner); await this.target();
    // The row lock serializes provision with renewal/reclamation, even across hosts.
    // Conflict handling accepts only the identical owner and tenant. PostgreSQL
    // resolves concurrent inserts after the row lock without a stale snapshot read.
    const result = await this.executor.query<{ id: string; owner_id: string }>(`WITH owner AS MATERIALIZED (
      SELECT id FROM forgeqa_test_lease_owners WHERE ${MATCH} AND ${LIVE} FOR UPDATE
    ) INSERT INTO forgeqa_test_leased_tenants (id, owner_id)
      SELECT 'forgeqa-' || id::text || '-tenant', id FROM owner
      ON CONFLICT (owner_id) DO UPDATE SET id = EXCLUDED.id
      WHERE forgeqa_test_leased_tenants.id = EXCLUDED.id
      RETURNING id, owner_id`, values);
    const row = result.rows[0];
    if (result.rows.length !== 1 || row?.id !== `forgeqa-${owner.id}-tenant` || row.owner_id !== owner.id) {
      throw new IntegrityError('Durable provisioning refused an expired, sealed or conflicting owner.');
    }
    return { id: row.id, ownerId: row.owner_id };
  }

  async close(owner: DurablePostgresLease): Promise<number> {
    const values = lease(owner); await this.target();
    // Sealing is irreversible. The same atomic statement removes only owned data;
    // repeated close is safe, and a killed/retried caller needs no local checkpoint.
    const result = await this.executor.query<{ removed: number }>(`WITH owner AS (
      UPDATE forgeqa_test_lease_owners SET state = 'sealed' WHERE ${MATCH} RETURNING id
    ), removed AS (
      DELETE FROM forgeqa_test_leased_tenants tenant USING owner WHERE tenant.owner_id = owner.id RETURNING tenant.id
    ) SELECT count(*)::integer AS removed FROM removed`, values);
    return this.removed(result.rows);
  }

  async reclaimExpired(options: { consumer: string; namespace: string; limit?: number; apply?: boolean }): Promise<DurableReclamation> {
    const limit = options?.limit ?? 100;
    if (!options || !label(options.consumer) || !label(options.namespace) || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000
      || (options.apply !== undefined && typeof options.apply !== 'boolean')) throw new ConfigurationError('Reclamation needs exact consumer/namespace, a boolean apply and limit 1..1000.');
    await this.target();
    const values = [options.consumer, options.namespace, limit];
    const selection = `SELECT id FROM forgeqa_test_lease_owners WHERE consumer = $1 AND namespace = $2
      AND state = 'active' AND expires_at <= clock_timestamp() ORDER BY expires_at, id LIMIT $3`;
    if (!options.apply) {
      const result = await this.executor.query<{ id: string }>(selection, values);
      return { dryRun: true, owners: this.owners(result.rows.map(row => row.id), limit), tenantsRemoved: 0 };
    }
    const result = await this.executor.query<{ owners: string[]; removed: number }>(`WITH expired AS MATERIALIZED (
      ${selection} FOR UPDATE SKIP LOCKED
    ), sealed AS (
      UPDATE forgeqa_test_lease_owners owner SET state = 'sealed' FROM expired
      WHERE owner.id = expired.id RETURNING owner.id
    ), removed AS (
      DELETE FROM forgeqa_test_leased_tenants tenant USING sealed WHERE tenant.owner_id = sealed.id RETURNING tenant.id
    ) SELECT ARRAY(SELECT id::text FROM sealed ORDER BY id) AS owners, (SELECT count(*)::integer FROM removed) AS removed`, values);
    if (result.rows.length !== 1) throw new IntegrityError('Invalid durable reclamation receipt.');
    return { dryRun: false, owners: this.owners(result.rows[0]!.owners, limit), tenantsRemoved: this.removed(result.rows) };
  }

  private owners(ids: string[], limit: number): string[] {
    if (!Array.isArray(ids) || ids.length > limit || new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string' || !UUID.test(id))) throw new IntegrityError('Invalid durable owner inventory.');
    return [...ids].sort();
  }
  private removed(rows: Array<{ removed: number }>): number {
    if (rows.length !== 1 || !Number.isSafeInteger(rows[0]?.removed) || rows[0]!.removed < 0 || rows[0]!.removed > 1000) throw new IntegrityError('Invalid durable cleanup count.');
    return rows[0]!.removed;
  }
}
