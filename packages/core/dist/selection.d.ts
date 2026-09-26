export interface SelectionReason {
    testId: string;
    reason: string;
}
export interface SelectionPlan {
    mode: 'changed' | 'full' | 'docs-only';
    selected: string[];
    reasons: SelectionReason[];
    warnings: string[];
}
export interface SelectionInput {
    changedFiles?: string[];
    allTests: string[];
    smokeTests: string[];
    mapping: Record<string, string[]>;
    newTests?: string[];
    baselineAvailable: boolean;
}
export declare function planChangedArea(input: SelectionInput): SelectionPlan;
//# sourceMappingURL=selection.d.ts.map