import { randomUUID } from 'node:crypto';
import { ConfigurationError, ForgeError, redactValue } from '@azerish25-ux/forgeqa-core';
export class ForgeHttpError extends ForgeError {
    status;
    response;
    constructor(status, message, response, details = {}) {
        super('FORGEQA_HTTP', message, 1, details);
        this.status = status;
        this.response = response;
    }
}
function methodIsNaturallyRetryable(method) { return ['GET', 'HEAD', 'OPTIONS'].includes(method); }
function mergeSignals(signals) {
    const controller = new AbortController();
    const abort = (event) => controller.abort(event?.target?.reason);
    for (const signal of signals) {
        if (!signal)
            continue;
        if (signal.aborted) {
            controller.abort(signal.reason);
            break;
        }
        signal.addEventListener('abort', abort, { once: true });
    }
    return controller.signal;
}
export class ForgeHttpClient {
    baseUrl;
    defaultHeaders;
    constructor(baseUrl, defaultHeaders = {}) {
        this.baseUrl = new URL(baseUrl);
        if (!['http:', 'https:'].includes(this.baseUrl.protocol))
            throw new ConfigurationError('HTTP client base URL must use HTTP or HTTPS.');
        this.defaultHeaders = { ...defaultHeaders };
    }
    async request(options) {
        const method = (options.method ?? 'GET').toUpperCase();
        const url = new URL(options.path, this.baseUrl);
        if (url.origin !== this.baseUrl.origin)
            throw new ConfigurationError(`Cross-origin request refused: ${url.origin}`);
        const retry = options.retry ?? { attempts: 1, baseDelayMs: 100 };
        if (!Number.isInteger(retry.attempts) || retry.attempts < 1 || retry.attempts > 5)
            throw new ConfigurationError('Retry attempts must be between 1 and 5.');
        const safeWriteRetry = methodIsNaturallyRetryable(method) || (retry.explicitlyIdempotent === true && Boolean(retry.idempotencyKey));
        if (retry.attempts > 1 && !safeWriteRetry)
            throw new ConfigurationError(`Automatic retry refused for ${method}; declare explicit idempotency and provide an idempotency key.`);
        const correlationId = randomUUID();
        let lastError;
        for (let attempt = 1; attempt <= retry.attempts; attempt += 1) {
            const timeout = AbortSignal.timeout(options.timeoutMs ?? 30_000);
            const signal = mergeSignals([options.signal, timeout]);
            const headers = new Headers({ accept: 'application/json', ...this.defaultHeaders, ...options.headers, 'x-correlation-id': correlationId });
            if (retry.idempotencyKey)
                headers.set('idempotency-key', retry.idempotencyKey);
            let body;
            if (options.body !== undefined) {
                headers.set('content-type', 'application/json');
                body = JSON.stringify(options.body);
            }
            try {
                const init = { method, headers, signal, redirect: 'error' };
                if (body !== undefined)
                    init.body = body;
                const response = await fetch(url, init);
                const contentType = response.headers.get('content-type') ?? '';
                const payload = contentType.includes('application/json') ? await response.json() : await response.text();
                if (!response.ok)
                    throw new ForgeHttpError(response.status, `${method} ${url.pathname} returned HTTP ${response.status}.`, redactValue(payload), { correlationId, method, path: url.pathname });
                const data = options.validate ? options.validate(payload) : payload;
                return { status: response.status, headers: response.headers, data, correlationId };
            }
            catch (error) {
                lastError = error;
                if (error instanceof ForgeHttpError || attempt === retry.attempts || signal.aborted)
                    throw error;
                await new Promise((resolve) => setTimeout(resolve, Math.min(retry.baseDelayMs * 2 ** (attempt - 1), 2_000)));
            }
        }
        throw lastError;
    }
    get(path, options = {}) { return this.request({ ...options, path, method: 'GET' }); }
    post(path, body, options = {}) { return this.request({ ...options, path, method: 'POST', body }); }
}
//# sourceMappingURL=client.js.map