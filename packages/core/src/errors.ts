export type ForgeExitCode = 0 | 1 | 2 | 3 | 130;
export class ForgeError extends Error {
  readonly code: string;
  readonly exitCode: ForgeExitCode;
  readonly details: Readonly<Record<string, unknown>>;
  constructor(code: string, message: string, exitCode: ForgeExitCode = 3, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ForgeError';
    this.code = code;
    this.exitCode = exitCode;
    this.details = Object.freeze({ ...details });
  }
}
export class ConfigurationError extends ForgeError {
  constructor(message: string, details: Record<string, unknown> = {}) { super('FORGEQA_CONFIG', message, 2, details); }
}
export class IntegrityError extends ForgeError {
  constructor(message: string, details: Record<string, unknown> = {}) { super('FORGEQA_INTEGRITY', message, 3, details); }
}
export class PolicyError extends ForgeError {
  constructor(message: string, details: Record<string, unknown> = {}) { super('FORGEQA_POLICY', message, 1, details); }
}
export function toForgeError(error: unknown): ForgeError {
  if (error instanceof ForgeError) return error;
  if (error instanceof Error) return new ForgeError('FORGEQA_INTERNAL', error.message, 3, { name: error.name });
  return new ForgeError('FORGEQA_INTERNAL', String(error), 3);
}
