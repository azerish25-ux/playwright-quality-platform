export interface NamespaceInput {
    consumer: string;
    runId: string;
    shardIndex: number;
    project: string;
    repetition: number;
    parallelIndex: number;
    attempt?: number;
}
export declare function allocateNamespace(input: NamespaceInput): string;
export declare function assertOwnedIdentifier(identifier: string, namespace: string): void;
//# sourceMappingURL=namespace.d.ts.map