export interface FailureInput {
    name?: string;
    message: string;
    stack?: string;
    location?: {
        file: string;
        line: number;
        column?: number;
    };
    applicationCode?: string;
}
export declare function fingerprintFailure(input: FailureInput): string;
//# sourceMappingURL=fingerprint.d.ts.map