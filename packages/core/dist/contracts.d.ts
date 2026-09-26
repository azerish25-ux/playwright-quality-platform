export declare const RESULT_SCHEMA_VERSION: 1;
export type CompletionState = 'complete' | 'incomplete' | 'cancelled' | 'infrastructure-failure';
export type AttemptOutcome = 'passed' | 'failed' | 'timed-out' | 'skipped' | 'expected-failure' | 'unexpected-pass' | 'cancelled';
export interface SourceRevision {
    repository: string;
    sourceCommit: string;
    testedCommit: string;
    branch?: string;
    prHeadSha?: string;
    prBaseSha?: string;
    prMergeSha?: string;
}
export interface AttemptRecord {
    schemaVersion: typeof RESULT_SCHEMA_VERSION;
    attemptId: string;
    executionId: string;
    logicalTestId: string;
    retry: number;
    outcome: AttemptOutcome;
    startedAt: string;
    durationMs: number;
    error?: {
        name: string;
        message: string;
        stack?: string;
        fingerprint?: string;
    };
    artifacts?: ArtifactRecord[];
}
export interface ArtifactRecord {
    path: string;
    type: 'trace' | 'screenshot' | 'video' | 'log' | 'attachment' | 'report';
    state: 'captured' | 'missing' | 'disabled' | 'inapplicable' | 'unavailable';
    size?: number;
    sha256?: string;
    url?: string;
}
export interface ExpectedExecution {
    executionId: string;
    logicalTestId: string;
    project: string;
    browser?: string;
    environment: string;
    shardIndex: number;
    shardTotal: number;
}
export interface SelectionManifest {
    schemaVersion: typeof RESULT_SCHEMA_VERSION;
    runId: string;
    selectionHash: string;
    configHash: string;
    expected: ExpectedExecution[];
}
export interface ShardResult {
    schemaVersion: typeof RESULT_SCHEMA_VERSION;
    runId: string;
    shardId: string;
    shardIndex: number;
    shardTotal: number;
    selectionHash: string;
    configHash: string;
    completion: CompletionState;
    revision: SourceRevision;
    attempts: AttemptRecord[];
    finalizedAt?: string;
    journalSha256?: string;
}
export interface MergedRunResult {
    schemaVersion: typeof RESULT_SCHEMA_VERSION;
    runId: string;
    completion: CompletionState;
    selectionHash: string;
    configHash: string;
    revision: SourceRevision;
    attempts: AttemptRecord[];
    missingExecutions: string[];
    unexpectedExecutions: string[];
    duplicateExecutions: string[];
    shardIds: string[];
}
export interface QuarantineRecord {
    schemaVersion: typeof RESULT_SCHEMA_VERSION;
    testId: string;
    owner: string;
    reason: string;
    issue: string;
    createdAt: string;
    expiresAt: string;
    projects?: string[];
}
//# sourceMappingURL=contracts.d.ts.map