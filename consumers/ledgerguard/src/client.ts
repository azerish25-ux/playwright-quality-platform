import type { APIRequestContext, APIResponse } from '@playwright/test';
import type {
  Account,
  AdjustmentReceipt,
  CancellationReceipt,
  CommandResult,
  PageResult,
  PaymentAdjustment,
  PaymentReceipt,
  PaymentRecord,
  Problem,
  RegisteredIdentity,
  ScheduleOccurrence,
  ScheduleView,
  Session,
  TransferReceipt,
  TransferRecord
} from './types.js';

interface RawRequestOptions {
  method?: 'GET' | 'POST' | 'PUT';
  data?: unknown;
  idempotencyKey?: string;
}

export class LedgerGuardClient {
  private csrf: string | undefined;

  public constructor(private readonly context: APIRequestContext) {}

  public async refreshCsrf(): Promise<void> {
    const result = await this.raw<{ headerName: string; token: string }>('/api/v1/auth/csrf');
    if (result.status !== 200 || result.body.headerName !== 'X-XSRF-TOKEN' || !result.body.token) {
      throw new Error(`LedgerGuard CSRF acquisition failed with HTTP ${result.status}.`);
    }
    this.csrf = result.body.token;
  }

  public async register(input: { email: string; password: string; displayName: string }): Promise<CommandResult<RegisteredIdentity>> {
    return this.command<RegisteredIdentity>('/api/v1/auth/register', input);
  }

  public async login(email: string, password: string): Promise<CommandResult<Session>> {
    const result = await this.command<Session>('/api/v1/auth/login', { email, password });
    if (result.status === 200) {
      this.csrf = undefined;
      await this.refreshCsrf();
    }
    return result;
  }

  public async registerAndLogin(input: { email: string; password: string; displayName: string }): Promise<RegisteredIdentity> {
    const registration = await this.register(input);
    if (registration.status !== 201) {
      throw new Error(`LedgerGuard registration failed with HTTP ${registration.status}.`);
    }
    const session = await this.login(input.email, input.password);
    if (session.status !== 200 || session.body.role !== 'CUSTOMER') {
      throw new Error(`LedgerGuard login failed with HTTP ${session.status}.`);
    }
    return registration.body;
  }

  public async logout(): Promise<CommandResult<undefined>> {
    const result = await this.command<undefined>('/api/v1/auth/logout', undefined);
    this.csrf = undefined;
    if (result.status === 204) await this.refreshCsrf();
    return result;
  }

  public me(): Promise<CommandResult<Session | Problem>> {
    return this.raw<Session | Problem>('/api/v1/auth/me');
  }

  public adminSecurityEvents(): Promise<CommandResult<PageResult<unknown> | Problem>> {
    return this.raw<PageResult<unknown> | Problem>('/api/v1/admin/security-events?limit=10&offset=0');
  }

  public accounts(limit = 50, offset = 0): Promise<CommandResult<PageResult<Account>>> {
    return this.raw<PageResult<Account>>(`/api/v1/accounts?limit=${limit}&offset=${offset}`);
  }

  public account(id: string): Promise<CommandResult<Account | Problem>> {
    return this.raw<Account | Problem>(`/api/v1/accounts/${encodeURIComponent(id)}`);
  }

  public createAccount(name: string): Promise<CommandResult<Account>> {
    return this.command<Account>('/api/v1/accounts', { name, currency: 'CAD' });
  }

  public transfer(
    input: { sourceId: string; recipientRef: string; amountMinor: string; currency: 'CAD' },
    idempotencyKey: string
  ): Promise<CommandResult<TransferReceipt | Problem>> {
    return this.command<TransferReceipt | Problem>('/api/v1/transfers', input, idempotencyKey);
  }

  public transferById(id: string): Promise<CommandResult<TransferRecord | Problem>> {
    return this.raw<TransferRecord | Problem>(`/api/v1/transfers/${encodeURIComponent(id)}`);
  }

  public transfers(limit = 50, offset = 0): Promise<CommandResult<PageResult<TransferRecord>>> {
    return this.raw<PageResult<TransferRecord>>(`/api/v1/transfers?limit=${limit}&offset=${offset}`);
  }

  public payment(
    input: { sourceId: string; recipientRef: string; amountMinor: string; currency: 'CAD' },
    idempotencyKey: string
  ): Promise<CommandResult<PaymentReceipt | Problem>> {
    return this.command<PaymentReceipt | Problem>('/api/v1/payments', input, idempotencyKey);
  }

  public paymentById(id: string): Promise<CommandResult<PaymentRecord | Problem>> {
    return this.raw<PaymentRecord | Problem>(`/api/v1/payments/${encodeURIComponent(id)}`);
  }

  public cancelPayment(id: string, idempotencyKey: string, reason?: string): Promise<CommandResult<CancellationReceipt | Problem>> {
    return this.command<CancellationReceipt | Problem>(
      `/api/v1/payments/${encodeURIComponent(id)}/cancel`,
      reason === undefined ? {} : { reason },
      idempotencyKey
    );
  }

  public refundPayment(
    id: string,
    amountMinor: string,
    idempotencyKey: string,
    reason?: string
  ): Promise<CommandResult<AdjustmentReceipt | Problem>> {
    const data: { amountMinor: string; reason?: string } = { amountMinor };
    if (reason !== undefined) data.reason = reason;
    return this.command<AdjustmentReceipt | Problem>(
      `/api/v1/payments/${encodeURIComponent(id)}/refunds`,
      data,
      idempotencyKey
    );
  }

  public reversePayment(id: string, reason: string, idempotencyKey: string): Promise<CommandResult<AdjustmentReceipt | Problem>> {
    return this.command<AdjustmentReceipt | Problem>(
      `/api/v1/payments/${encodeURIComponent(id)}/reversal`,
      { reason },
      idempotencyKey
    );
  }

  public paymentAdjustments(id: string, limit = 50, offset = 0): Promise<CommandResult<PageResult<PaymentAdjustment> | Problem>> {
    return this.raw<PageResult<PaymentAdjustment> | Problem>(
      `/api/v1/payments/${encodeURIComponent(id)}/adjustments?limit=${limit}&offset=${offset}`
    );
  }

  public createSchedule(
    input: {
      sourceId: string;
      recipientRef: string;
      amountMinor: string;
      currency: 'CAD';
      intendedLocal: string;
      zoneId: string;
      recurrence: 'ONCE' | 'DAILY' | 'WEEKLY' | 'MONTHLY';
    },
    idempotencyKey: string
  ): Promise<CommandResult<ScheduleView | Problem>> {
    return this.command<ScheduleView | Problem>('/api/v1/schedules', input, idempotencyKey);
  }

  public editSchedule(
    id: string,
    input: {
      sourceId: string;
      recipientRef: string;
      amountMinor: string;
      currency: 'CAD';
      intendedLocal: string;
      zoneId: string;
      recurrence: 'ONCE' | 'DAILY' | 'WEEKLY' | 'MONTHLY';
      expectedVersion: number;
    },
    idempotencyKey: string
  ): Promise<CommandResult<ScheduleView | Problem>> {
    return this.command<ScheduleView | Problem>(`/api/v1/schedules/${encodeURIComponent(id)}`, input, idempotencyKey, 'PUT');
  }

  public schedule(id: string): Promise<CommandResult<ScheduleView | Problem>> {
    return this.raw<ScheduleView | Problem>(`/api/v1/schedules/${encodeURIComponent(id)}`);
  }

  public scheduleOccurrences(id: string, limit = 50, offset = 0): Promise<CommandResult<PageResult<ScheduleOccurrence> | Problem>> {
    return this.raw<PageResult<ScheduleOccurrence> | Problem>(
      `/api/v1/schedules/${encodeURIComponent(id)}/occurrences?limit=${limit}&offset=${offset}`
    );
  }

  public scheduleState(
    id: string,
    action: 'pause' | 'resume' | 'cancel',
    expectedVersion: number,
    idempotencyKey: string
  ): Promise<CommandResult<ScheduleView | Problem>> {
    return this.command<ScheduleView | Problem>(
      `/api/v1/schedules/${encodeURIComponent(id)}/${action}`,
      { expectedVersion },
      idempotencyKey
    );
  }

  public async command<T>(
    path: string,
    data: unknown,
    idempotencyKey?: string,
    method: 'POST' | 'PUT' = 'POST'
  ): Promise<CommandResult<T>> {
    if (!this.csrf) await this.refreshCsrf();
    return this.raw<T>(path, { method, data, ...(idempotencyKey === undefined ? {} : { idempotencyKey }) });
  }

  public async raw<T>(path: string, options: RawRequestOptions = {}): Promise<CommandResult<T>> {
    const method = options.method ?? 'GET';
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (method !== 'GET') {
      if (!this.csrf) throw new Error('CSRF token is required for LedgerGuard state changes.');
      headers['X-XSRF-TOKEN'] = this.csrf;
      headers['Content-Type'] = 'application/json';
    }
    if (options.idempotencyKey !== undefined) headers['Idempotency-Key'] = options.idempotencyKey;

    const response = await this.context.fetch(path, {
      method,
      headers,
      ...(options.data === undefined ? {} : { data: options.data }),
      timeout: 20_000,
      failOnStatusCode: false
    });
    const body = await responseBody<T>(response);
    const responseHeaders = response.headers();
    return {
      status: response.status(),
      body,
      replayed: responseHeaders['idempotency-replayed']?.toLowerCase() === 'true',
      headers: responseHeaders
    };
  }
}

async function responseBody<T>(response: APIResponse): Promise<T> {
  if (response.status() === 204) return undefined as T;
  const text = await response.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`LedgerGuard returned non-JSON data for HTTP ${response.status()}.`);
  }
}
