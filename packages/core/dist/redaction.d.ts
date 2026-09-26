export interface RedactionOptions {
    replacement?: string;
    extraKeys?: RegExp[];
    allowedKeys?: string[];
}
export declare function redactText(input: string, replacement?: string): string;
export declare function redactUrl(input: string, replacement?: string): string;
export declare function redactValue(value: unknown, options?: RedactionOptions, path?: string[]): unknown;
//# sourceMappingURL=redaction.d.ts.map