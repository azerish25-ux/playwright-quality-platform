import { type AttemptRecord, type ShardResult } from '@azerish25-ux/forgeqa-core';
export declare class ResultJournal {
    #private;
    readonly path: string;
    readonly finalPath: string;
    constructor(path: string);
    start(metadata: Omit<ShardResult, 'attempts' | 'completion' | 'finalizedAt' | 'journalSha256'>): Promise<void>;
    attempt(attempt: AttemptRecord): Promise<void>;
    finalize(result: ShardResult): Promise<void>;
}
export declare function readFinalizedShard(path: string): Promise<ShardResult>;
//# sourceMappingURL=journal.d.ts.map