import { type QuarantineRecord } from '@azerish25-ux/forgeqa-core';
export interface QuarantineValidation {
    valid: boolean;
    errors: string[];
    warnings: string[];
}
export declare function validateQuarantine(records: QuarantineRecord[], knownTests: Iterable<string>, now?: Date, maxDays?: number): QuarantineValidation;
//# sourceMappingURL=quarantine.d.ts.map