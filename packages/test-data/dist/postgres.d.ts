export interface SqlExecutor {
    query<T = unknown>(text: string, values?: unknown[]): Promise<{
        rows: T[];
        rowCount?: number;
    }>;
}
export interface PostgresProvision {
    namespace: string;
    tenantId: string;
}
export declare class GuardedPostgresAdapter {
    private readonly executor;
    private readonly databaseName;
    private readonly requiredPrefix;
    constructor(executor: SqlExecutor, databaseName: string, requiredPrefix?: string);
    health(): Promise<void>;
    provision(namespace: string): Promise<PostgresProvision>;
    cleanup(provision: PostgresProvision): Promise<void>;
    reclaimStale(beforeIso: string, expectedOwnerPrefix: string): Promise<number>;
}
//# sourceMappingURL=postgres.d.ts.map