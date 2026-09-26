export class ForgeError extends Error {
    code;
    exitCode;
    details;
    constructor(code, message, exitCode = 3, details = {}) {
        super(message);
        this.name = 'ForgeError';
        this.code = code;
        this.exitCode = exitCode;
        this.details = Object.freeze({ ...details });
    }
}
export class ConfigurationError extends ForgeError {
    constructor(message, details = {}) { super('FORGEQA_CONFIG', message, 2, details); }
}
export class IntegrityError extends ForgeError {
    constructor(message, details = {}) { super('FORGEQA_INTEGRITY', message, 3, details); }
}
export class PolicyError extends ForgeError {
    constructor(message, details = {}) { super('FORGEQA_POLICY', message, 1, details); }
}
export function toForgeError(error) {
    if (error instanceof ForgeError)
        return error;
    if (error instanceof Error)
        return new ForgeError('FORGEQA_INTERNAL', error.message, 3, { name: error.name });
    return new ForgeError('FORGEQA_INTERNAL', String(error), 3);
}
//# sourceMappingURL=errors.js.map