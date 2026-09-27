export type ActionEnvironment = Readonly<Record<string, string | undefined>>;
export declare function input(name: string, required?: boolean, env?: ActionEnvironment): string;
export declare function integerInput(name: string, fallback: number, min: number, max: number, env?: ActionEnvironment): number;
export declare function optionalIntegerInput(name: string, min: number, max: number, env?: ActionEnvironment): number | undefined;
export declare function booleanInput(name: string, fallback: boolean, env?: ActionEnvironment): boolean;
export declare function enumInput<T extends string>(name: string, values: readonly T[], fallback: T, env?: ActionEnvironment): T;
export declare function listInput(name: string, fallback: readonly string[], env?: ActionEnvironment): string[];
//# sourceMappingURL=input.d.ts.map