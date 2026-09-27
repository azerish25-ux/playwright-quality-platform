import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INTEGER = /^-?[0-9]+$/;

export class LedgerGuardLab {
  private readonly root = resolve(required('LEDGERGUARD_ROOT'));
  private readonly envFile = resolve(required('LEDGERGUARD_ENV_FILE'));
  private readonly ownerPassword = required('LEDGER_OWNER_PASSWORD');
  private readonly database = required('POSTGRES_DB');

  public runningServices(): Set<string> {
    return new Set(this.compose(['ps', '--status', 'running', '--services']).split(/\s+/).filter(Boolean));
  }

  public stop(...services: string[]): void {
    validateServices(services);
    this.compose(['stop', ...services]);
  }

  public up(...services: string[]): void {
    validateServices(services);
    this.compose(['up', '-d', ...services]);
  }

  public fundAccount(accountId: string, amountMinor: bigint): void {
    const account = uuid(accountId, 'account');
    if (amountMinor < 1n || amountMinor > 1_000_000_000_000n) throw new Error('Invalid synthetic funding amount.');
    const asset = randomUUID();
    const operation = randomUUID();
    this.sql(
      `BEGIN; `
      + `INSERT INTO ledger.accounts(id,label,currency,kind) VALUES('${asset}','ForgeQA synthetic asset','CAD','SANDBOX_FUNDING_ASSET'); `
      + `INSERT INTO ledger.account_balances(account_id) VALUES('${asset}'); `
      + `SELECT ledger._post('${operation}','FUNDING','${asset}','${account}',${amountMinor},'CAD'); `
      + 'COMMIT;'
    );
  }

  public transferEffectCounts(operationId: string): string {
    const operation = uuid(operationId, 'transfer');
    return this.scalar(
      `SELECT (SELECT count(*) FROM ledger.transfers WHERE id='${operation}')||':'||`
      + `(SELECT count(*) FROM ledger.journals WHERE operation_id='${operation}')||':'||`
      + `(SELECT count(*) FROM ledger.audit_records WHERE aggregate_id='${operation}');`
    );
  }

  public paymentEffectCounts(paymentId: string): string {
    const payment = uuid(paymentId, 'payment');
    return this.scalar(
      `SELECT (SELECT count(*) FROM ledger.payments WHERE id='${payment}')||':'||`
      + `(SELECT count(*) FROM ledger.journals WHERE operation_id='${payment}')||':'||`
      + `(SELECT count(*) FROM ledger.holds WHERE payment_id='${payment}');`
    );
  }

  public paymentCancellationState(paymentId: string): string {
    const payment = uuid(paymentId, 'payment');
    return this.scalar(
      `SELECT (SELECT state FROM ledger.payments WHERE id='${payment}')||':'||`
      + `(SELECT state FROM ledger.holds WHERE payment_id='${payment}')||':'||`
      + `(SELECT count(*) FROM ledger.journals WHERE operation_id='${payment}');`
    );
  }

  public adjustmentCount(paymentId: string, kind?: 'REFUND' | 'REVERSAL'): number {
    const payment = uuid(paymentId, 'payment');
    const filter = kind === undefined ? '' : ` AND kind='${kind}'`;
    return integer(this.scalar(`SELECT count(*) FROM ledger.adjustments WHERE payment_id='${payment}'${filter};`));
  }

  public journalEntryCount(journalId: string): number {
    return integer(this.scalar(`SELECT count(*) FROM ledger.journal_entries WHERE journal_id='${uuid(journalId, 'journal')}';`));
  }

  public scheduleEffectCounts(scheduleId: string, operationId: string): string {
    const schedule = uuid(scheduleId, 'schedule');
    const operation = uuid(operationId, 'operation');
    return this.scalar(
      `SELECT (SELECT count(*) FROM ledger.schedule_occurrences WHERE schedule_id='${schedule}')||':'||`
      + `(SELECT count(*) FROM ledger.transfers WHERE id='${operation}')||':'||`
      + `(SELECT count(*) FROM ledger.journals WHERE operation_id='${operation}');`
    );
  }

  public reconciliationDiscrepancies(): number {
    return integer(this.scalar(
      "SELECT count(*) FROM ledger.account_balances b JOIN ledger.accounts a ON a.id=b.account_id "
      + "WHERE b.posted_minor::numeric<>(SELECT coalesce(sum(CASE WHEN a.kind='WALLET_LIABILITY' "
      + "THEN CASE WHEN e.side='CREDIT' THEN e.amount_minor::numeric ELSE -e.amount_minor::numeric END "
      + "ELSE CASE WHEN e.side='DEBIT' THEN e.amount_minor::numeric ELSE -e.amount_minor::numeric END END),0) "
      + "FROM ledger.journal_entries e WHERE e.account_id=a.id) "
      + "OR b.reserved_minor::numeric<>(SELECT coalesce(sum(h.amount_minor::numeric),0) "
      + "FROM ledger.holds h WHERE h.account_id=a.id AND h.state='ACTIVE');"
    ));
  }

  public scalar(query: string): string {
    return this.sql(query).trim();
  }

  private sql(query: string): string {
    return execFileSync('docker', [
      'compose', '--ansi', 'never', '--env-file', this.envFile,
      '-f', resolve(this.root, 'compose.yaml'),
      '-f', resolve(this.root, 'compose.p07.yaml'),
      'exec', '-T', '-e', 'PGPASSWORD',
      'postgres', 'psql', '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1',
      '-U', 'ledger_owner', '-d', this.database, '-c', query
    ], {
      cwd: this.root,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, PGPASSWORD: this.ownerPassword },
      timeout: 60_000
    });
  }

  private compose(args: string[]): string {
    return execFileSync('docker', [
      'compose', '--ansi', 'never', '--env-file', this.envFile,
      '-f', resolve(this.root, 'compose.yaml'),
      '-f', resolve(this.root, 'compose.p07.yaml'),
      ...args
    ], { cwd: this.root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 90_000 });
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required LedgerGuard acceptance variable ${name}.`);
  return value;
}

function uuid(value: string, label: string): string {
  if (!UUID.test(value)) throw new Error(`Invalid ${label} UUID.`);
  return value.toLowerCase();
}

function integer(value: string): number {
  if (!INTEGER.test(value)) throw new Error(`Expected an integer SQL result, received ${JSON.stringify(value)}.`);
  return Number(value);
}

function validateServices(services: string[]): void {
  const allowed = new Set(['outbox-publisher', 'payment-worker-a', 'payment-worker-b', 'scheduler-a', 'scheduler-b']);
  if (!services.length || services.some(service => !allowed.has(service))) throw new Error('Invalid LedgerGuard service selection.');
}
