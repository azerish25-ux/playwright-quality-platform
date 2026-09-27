export interface Problem {
  code: string;
  message?: string;
  correlationId?: string;
}

export interface Session {
  id: string;
  email: string;
  displayName: string;
  role: 'CUSTOMER' | 'ADMIN';
  expiresAt: string;
}

export interface RegisteredIdentity {
  id: string;
  email: string;
  displayName: string;
  role: 'CUSTOMER';
}

export interface Account {
  id: string;
  publicRef: string;
  name: string;
  currency: 'CAD';
  postedMinor: string;
  reservedMinor: string;
  availableMinor: string;
  version: string;
  updatedAt: string;
}

export interface PageResult<T> {
  items: T[];
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface TransferReceipt {
  id: string;
  kind: 'TRANSFER';
  state: 'SETTLED';
  journalId: string;
  amountMinor: string;
  currency: 'CAD';
}

export interface TransferRecord {
  id: string;
  sourceId: string;
  recipientRef: string;
  amountMinor: string;
  currency: 'CAD';
  state: 'SETTLED';
  journalId: string;
  createdAt: string;
}

export interface PaymentReceipt {
  id: string;
  kind: 'PAYMENT';
  state: 'PENDING';
  amountMinor: string;
  currency: 'CAD';
}

export interface PaymentRecord {
  id: string;
  direction: 'OUTGOING' | 'INCOMING';
  accountId: string;
  counterpartyRef: string;
  amountMinor: string;
  currency: 'CAD';
  state: 'PENDING' | 'SETTLED' | 'FAILED' | 'CANCELLED';
  version: string;
  adjustmentState: 'NONE' | 'PARTIALLY_REFUNDED' | 'FULLY_REFUNDED' | 'REVERSED';
  journalId?: string;
  failureCode?: string;
  projectionState?: 'PENDING' | 'SETTLED' | 'FAILED' | 'CANCELLED';
  projectionVersion?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CancellationReceipt {
  id: string;
  state: 'CANCELLED';
}

export interface AdjustmentReceipt {
  id: string;
  paymentId: string;
  kind: 'REFUND' | 'REVERSAL';
  amountMinor: string;
  currency: 'CAD';
  journalId: string;
}

export interface PaymentAdjustment extends AdjustmentReceipt {
  reason: string;
  createdAt: string;
}

export interface ScheduleView {
  id: string;
  sourceId: string;
  recipientRef: string;
  amountMinor: string;
  currency: 'CAD';
  intendedLocal: string;
  zoneId: string;
  recurrence: 'ONCE' | 'DAILY' | 'WEEKLY' | 'MONTHLY';
  version: number;
  eventVersion: number;
  nextInstant: string;
  status: 'ACTIVE' | 'PAUSED' | 'CANCELLED' | 'FINISHED';
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleOccurrence {
  id: string;
  scheduleId: string;
  scheduleVersion: number;
  intendedLocal: string;
  dueAt: string;
  outcome: 'SUCCEEDED' | 'REJECTED';
  operationId?: string;
  journalId?: string;
  errorCode?: string;
  createdAt: string;
}

export interface CommandResult<T> {
  status: number;
  body: T;
  replayed: boolean;
  headers: Record<string, string>;
}
