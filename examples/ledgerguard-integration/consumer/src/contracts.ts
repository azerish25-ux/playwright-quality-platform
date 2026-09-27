export interface Problem {
  code: string;
  [key: string]: unknown;
}

export interface Identity {
  id: string;
  email: string;
  displayName: string;
  role: 'CUSTOMER' | 'ADMIN';
}

export interface Page<T> {
  items: T[];
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface Account {
  id: string;
  publicRef: string;
  name: string;
  currency: string;
  postedMinor: string;
  reservedMinor: string;
  availableMinor: string;
  version: string;
  updatedAt: string;
}

export interface TransferReceipt {
  id: string;
  kind: 'TRANSFER';
  state: 'SETTLED';
  amountMinor: string;
  currency: string;
  journalId: string;
}

export interface Payment {
  id: string;
  direction: 'OUTGOING' | 'INCOMING';
  accountId: string;
  counterpartyRef: string;
  amountMinor: string;
  currency: string;
  state: 'PENDING' | 'SETTLED' | 'FAILED' | 'CANCELLED';
  adjustmentState: 'NONE' | 'PARTIALLY_REFUNDED' | 'FULLY_REFUNDED' | 'REVERSED';
  journalId: string | null;
  projectionState: string | null;
  projectionVersion: string | null;
}

export interface Adjustment {
  id: string;
  paymentId: string;
  kind: 'REFUND' | 'REVERSAL';
  amountMinor: string;
  currency: string;
  journalId: string;
  reason: string;
}

export interface Schedule {
  id: string;
  sourceId: string;
  recipientRef: string;
  amountMinor: string;
  currency: string;
  intendedLocal: string;
  zoneId: string;
  recurrence: 'ONCE' | 'DAILY' | 'WEEKLY';
  version: number;
  eventVersion: number;
  nextInstant: string;
  status: 'ACTIVE' | 'PAUSED' | 'CANCELLED' | 'FINISHED';
}

export interface Occurrence {
  id: string;
  scheduleId: string;
  scheduleVersion: number;
  intendedLocal: string;
  dueAt: string;
  outcome: 'SUCCEEDED' | 'REJECTED' | 'SKIPPED_LATE';
  operationId: string | null;
  journalId: string | null;
  errorCode: string | null;
}
