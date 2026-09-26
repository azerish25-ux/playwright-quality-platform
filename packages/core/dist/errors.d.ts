export type ForgeExitCode = 0 | 1 | 2 | 3 | 130;
export declare class ForgeError extends Error {
    readonly code: string;
    readonly exitCode: ForgeExitCode;
    readonly details: Readonly<Record<string, unknown>>;
    constructor(code: string, message: string, exitCode?: ForgeExitCode, details?: Record<string, unknown>);
}
export declare class ConfigurationError extends ForgeError {
    constructor(message: string, details?: Record<string, unknown>);
}
export declare class IntegrityError extends ForgeError {
    constructor(message: string, details?: Record<string, unknown>);
}
export declare class PolicyError extends ForgeError {
    constructor(message: string, details?: Record<string, unknown>);
}
export declare function toForgeError(error: unknown): ForgeError;
//# sourceMappingURL=errors.d.ts.map