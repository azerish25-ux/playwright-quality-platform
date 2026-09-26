import { type MergedRunResult } from '@azerish25-ux/forgeqa-core';
export interface HistoryRecord {
    schemaVersion: 1;
    provenance: 'trusted-default-branch' | 'untrusted-pr' | 'synthetic' | 'diagnostic';
    importedAt: string;
    result: MergedRunResult;
    checksum: string;
}
export declare function writeHistory(root: string, result: MergedRunResult, provenance: HistoryRecord['provenance']): Promise<string>;
export declare function readHistory(file: string): Promise<HistoryRecord>;
//# sourceMappingURL=history.d.ts.map