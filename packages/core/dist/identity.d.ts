export declare function logicalTestIdentity(input: {
    explicitId?: string;
    relativePath: string;
    titlePath: string[];
}): string;
export declare function executionIdentity(input: {
    consumer: string;
    environment: string;
    project: string;
    repetition: number;
    logicalTestId: string;
}): string;
export declare function attemptIdentity(executionId: string, retry: number): string;
export declare function runIdentity(input: {
    repository: string;
    workflow: string;
    runNumber: string;
    runAttempt: string;
    testedCommit: string;
}): string;
export declare function shardIdentity(input: {
    runId: string;
    project: string;
    index: number;
    total: number;
}): string;
//# sourceMappingURL=identity.d.ts.map