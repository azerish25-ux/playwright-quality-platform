# LedgerGuard external consumer

This directory is Deadpan's genuine second-consumer harness for the real [`azerish25-ux/transaction-reliability-lab`](https://github.com/azerish25-ux/transaction-reliability-lab) application. It is intentionally API-first because the verified LedgerGuard revision has no React product interface. No mock service, copied TeamBoard application, intercepted success response, invented endpoint, or permanent skip is used.

## Pinned application boundary

The acceptance lane checks out LedgerGuard at exact verified P07A source:

```text
9478663f97f9dc65d0c85117f244e1b8b80c37cb
```

That revision passed LedgerGuard workflow run `36319414655`. The Deadpan harness refuses a different checkout rather than silently following LedgerGuard's moving `main` branch.

## What the suite proves

Twelve tagged release tests exercise the live Compose topology through public Deadpan packages:

- registration, CSRF-protected login/logout, session revocation, and customer/administrator separation;
- customer account ownership and cross-customer denial;
- immediate transfers, exact integer money, durable replay, changed-intent conflicts, and insufficient-funds atomicity;
- asynchronous payment settlement and terminal projection consistency;
- payer cancellation with hold release and no settlement journal;
- recipient-authorized partial/full refunds and immutable original settlement journals;
- administrator reversal as one compensating effect;
- one-time scheduled transfer execution under two competing scheduler processes;
- schedule edit, replay, pause, resume, cancellation, occurrence history, and reconciliation.

The suite runs with one Playwright worker because several scenarios deliberately stop and restart shared payment workers to prove durable cancellation semantics. It uses bounded polling against observable API state; fixed sleeps are not used as correctness evidence.

## External-consumer acceptance

Run from the Deadpan repository root after checking out the pinned LedgerGuard revision at `.tmp/ledgerguard`:

```bash
npm ci --ignore-scripts
npm run build
npm run test:ledgerguard
```

The acceptance harness:

1. creates private one-run credentials and starts PostgreSQL, RabbitMQ, the API, outbox publisher, two payment workers, and two schedule workers;
2. seeds only the synthetic LedgerGuard fixtures;
3. packs all eight Deadpan packages from the tested source;
4. installs and type-checks isolated npm and pnpm consumers without workspace links or private source imports;
5. runs the same 12-test identity inventory through the public Deadpan CLI;
6. validates canonical evidence and strict quality gates;
7. reconciles every balance, journal, and active hold;
8. captures logs and removes all test containers and volumes.

Durable evidence is written beneath `evidence/ledgerguard/`. It records both source SHAs, package checksums, manager-specific reports, reconciliation status, and cleanup status without storing generated credentials.
