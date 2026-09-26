export interface CleanupEntry {
    id: string;
    ownerNamespace: string;
    description: string;
    cleanup: () => Promise<void>;
}
export interface CleanupResult {
    attempted: number;
    succeeded: number;
    failures: Array<{
        id: string;
        message: string;
    }>;
}
export declare class CleanupRegistry {
    #private;
    readonly namespace: string;
    constructor(namespace: string);
    register(entry: CleanupEntry): void;
    run(): Promise<CleanupResult>;
}
//# sourceMappingURL=cleanup.d.ts.map