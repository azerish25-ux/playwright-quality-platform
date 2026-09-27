import type { APIRequestContext, APIResponse } from '@playwright/test';
import type { Identity } from './contracts.js';

export interface LedgerResponse<T> {
  status: number;
  body: T;
  headers: Record<string, string>;
}

export interface LedgerRequest {
  body?: unknown;
  idempotencyKey?: string;
  headers?: Record<string, string>;
}

async function bodyOf<T>(response: APIResponse): Promise<T> {
  const text = await response.text();
  if (!text) return undefined as T;
  const contentType = response.headers()['content-type'] ?? '';
  return (contentType.includes('application/json') ? JSON.parse(text) : text) as T;
}

export class LedgerSession {
  readonly context: APIRequestContext;
  private csrfHeader = 'X-XSRF-TOKEN';
  private csrfToken: string | undefined;

  constructor(context: APIRequestContext) {
    this.context = context;
  }

  async csrf(): Promise<void> {
    const response = await this.context.get('/api/v1/auth/csrf');
    const body = await bodyOf<{ headerName: string; token: string }>(response);
    if (response.status() !== 200 || !body?.headerName || !body.token) {
      throw new Error(`LedgerGuard CSRF acquisition failed with HTTP ${response.status()}.`);
    }
    this.csrfHeader = body.headerName;
    this.csrfToken = body.token;
  }

  async login(email: string, password: string): Promise<LedgerResponse<Identity | Record<string, unknown>>> {
    await this.csrf();
    const result = await this.request<Identity | Record<string, unknown>>('POST', '/api/v1/auth/login', {
      body: { email, password },
    });
    if (result.status === 200) await this.csrf();
    return result;
  }

  async logout(): Promise<LedgerResponse<undefined | Record<string, unknown>>> {
    const result = await this.request<undefined | Record<string, unknown>>('POST', '/api/v1/auth/logout');
    this.csrfToken = undefined;
    return result;
  }

  async request<T>(method: string, path: string, options: LedgerRequest = {}): Promise<LedgerResponse<T>> {
    const normalized = method.toUpperCase();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(normalized) && !this.csrfToken) await this.csrf();
    const headers: Record<string, string> = { accept: 'application/json', ...options.headers };
    if (this.csrfToken && !['GET', 'HEAD', 'OPTIONS'].includes(normalized)) {
      headers[this.csrfHeader] = this.csrfToken;
    }
    if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
    const response = await this.context.fetch(path, {
      method: normalized,
      headers,
      ...(options.body === undefined ? {} : { data: options.body }),
      timeout: 30_000,
      failOnStatusCode: false,
    });
    return { status: response.status(), body: await bodyOf<T>(response), headers: response.headers() };
  }
}
