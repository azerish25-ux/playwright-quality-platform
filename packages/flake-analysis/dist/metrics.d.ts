import type { AttemptRecord } from '@azerish25-ux/forgeqa-core';
export interface ReliabilityMetrics {
    N: number;
    F: number;
    I: number;
    P: number;
    retryObservedFlakeRate: number | null;
    firstAttemptFailureRate: number | null;
    persistentFailureRate: number | null;
    retryRecoveryRate: number | null;
    sufficientSamples: boolean;
}
export declare function calculateReliability(attempts: AttemptRecord[], minimumSamples?: number): ReliabilityMetrics;
//# sourceMappingURL=metrics.d.ts.map