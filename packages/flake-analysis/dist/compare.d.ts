import type { MergedRunResult } from '@azerish25-ux/forgeqa-core';
export interface RunComparison {
    status: 'COMPARABLE' | 'NO_BASELINE';
    added: string[];
    removed: string[];
    shared: string[];
    currentFailures: string[];
    baselineFailures: string[];
}
export declare function compareRuns(current: MergedRunResult, baseline?: MergedRunResult): RunComparison;
//# sourceMappingURL=compare.d.ts.map