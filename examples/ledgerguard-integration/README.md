# LedgerGuard integration

This directory contains ForgeQA's genuine second-consumer harness. It exercises the real
`azerish25-ux/transaction-reliability-lab` application through its public HTTP contract; it does not
copy LedgerGuard source, invent endpoints, intercept responses, or import ForgeQA implementation files.

The hosted lane checks out LedgerGuard at the exact verified P07A source revision recorded in
[`contract.json`](contract.json), starts its PostgreSQL/RabbitMQ/API/outbox/payment-worker/two-scheduler
Docker topology, and then runs the nested [`consumer`](consumer) package in three forms:

1. the ForgeQA workspace distribution;
2. an isolated npm consumer installed only from packed ForgeQA tarballs;
3. an isolated pnpm consumer installed only from the same tarballs.

The API-first suite covers authentication, customer/admin separation, account ownership, immediate
transfers, idempotent replay and changed-intent rejection, insufficient funds, asynchronous payment
settlement, partial/full refunds, administrative reversal, scheduled occurrence execution, schedule
lifecycle commands, exact minor-unit balances, and scoped OpenAPI contracts. LedgerGuard has no React
product interface at the pinned revision, so this milestone makes no false UI-testing claim.

Run it only with the real LedgerGuard topology and these environment variables:

```bash
LEDGERGUARD_ORIGIN=http://127.0.0.1:8080
LEDGERGUARD_SOURCE_SHA=9478663f97f9dc65d0c85117f244e1b8b80c37cb
LEDGER_DEMO_PASSWORD=<value from LedgerGuard .ledgerguard/runtime.env>
npm run test:ledgerguard
npm run test:consumers -- ledgerguard
```

The CI job performs final database reconciliation, captures checksummed ForgeQA evidence and service
logs, and destroys the complete test-owned Compose project and volumes after every result.
