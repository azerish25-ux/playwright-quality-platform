import type { MergedRunResult, QuarantineRecord } from './contracts.js';
export interface GateViolation {
    id: string;
    severity: 'error' | 'warning';
    message: string;
    observed?: unknown;
    threshold?: unknown;
    affected?: string[];
    remediation: string;
}
export interface GatePolicy {
    failOnRetryRecovered: boolean;
    unexpectedSkipBudget: number;
    requireCompleteShards: boolean;
    maxQuarantineEntries: number;
    requireArtifacts?: string[];
}
export interface GateDecision {
    outcome: 'pass' | 'fail';
    violations: GateViolation[];
}
export declare function evaluateGates(run: MergedRunResult, quarantines: QuarantineRecord[], policy: GatePolicy): GateDecision;
//# sourceMappingURL=gates.d.ts.map