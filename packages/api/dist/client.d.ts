import { ForgeError } from '@azerish25-ux/forgeqa-core';
export type SchemaValidator<T> = (value: unknown) => T;
export interface RequestOptions<T> {
    method?: string;
    path: string;
    headers?: Record<string, string>;
    body?: unknown;
    timeoutMs?: number;
    signal?: AbortSignal;
    validate?: SchemaValidator<T>;
    retry?: {
        attempts: number;
        baseDelayMs: number;
        idempotencyKey?: string;
        explicitlyIdempotent?: boolean;
    };
}
export interface ForgeResponse<T> {
    status: number;
    headers: Headers;
    data: T;
    correlationId: string;
}
export declare class ForgeHttpError extends ForgeError {
    readonly status: number;
    readonly response: unknown;
    constructor(status: number, message: string, response: unknown, details?: Record<string, unknown>);
}
export declare class ForgeHttpClient {
    readonly baseUrl: URL;
    readonly defaultHeaders: Record<string, string>;
    constructor(baseUrl: string, defaultHeaders?: Record<string, string>);
    request<T = unknown>(options: RequestOptions<T>): Promise<ForgeResponse<T>>;
    get<T>(path: string, options?: Omit<RequestOptions<T>, 'path' | 'method'>): Promise<ForgeResponse<T>>;
    post<T>(path: string, body: unknown, options?: Omit<RequestOptions<T>, 'path' | 'method' | 'body'>): Promise<ForgeResponse<T>>;
}
//# sourceMappingURL=client.d.ts.map