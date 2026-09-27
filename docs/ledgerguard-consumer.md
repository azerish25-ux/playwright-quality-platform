# LedgerGuard second-consumer acceptance

ForgeQA validates its public API against two materially different applications. TeamBoard is a TypeScript SaaS application with browser journeys. LedgerGuard is a Java/Spring, PostgreSQL, RabbitMQ reliability laboratory whose verified P07A source is pinned at `9478663f97f9dc65d0c85117f244e1b8b80c37cb`.

## Trust and revision model

The CI lane performs a separate checkout of the public LedgerGuard repository at the exact SHA. `scripts/ledgerguard-acceptance.mjs` independently verifies that checkout before starting any service. The harness records both the ForgeQA and LedgerGuard SHAs in its acceptance record.

A later LedgerGuard revision is not adopted merely because it exists on `main`. It must first have equivalent permanent application evidence, then this pin and its consumer contract must be reviewed together.

## Topology

The P07A Compose topology contains:

- PostgreSQL 17;
- RabbitMQ;
- the LedgerGuard HTTP API;
- an outbox publisher;
- two independent asynchronous payment workers;
- two independent scheduled-transfer workers.

One-run credentials, signing material, ports, and the Compose project name are generated at execution time. Values are stored only in a mode-`0600` temporary environment file and are redacted from failure records. The lane removes its containers and named volumes before it can pass.

## Public ForgeQA adoption

All eight ForgeQA packages are packed from the tested repository revision. An isolated copy of `consumers/ledgerguard` is installed once with npm and once with pnpm. The consumers cannot use workspace links and compile only documented package entrypoints. Both package managers must execute the same logical test identity set with zero retries and a passing strict gate.

## Honest scope

This milestone claims real API and infrastructure acceptance. It does not claim LedgerGuard browser journeys because the pinned application has no React product UI. Adding a fabricated interface would weaken rather than strengthen the evidence. UI acceptance belongs to the LedgerGuard revision that introduces its genuine interface.

## Failure semantics

The lane fails for any of the following:

- source revision drift;
- unavailable or incomplete topology;
- malformed public-package installation;
- private ForgeQA imports;
- a missing, unexpected, duplicate, skipped, failed, or retry-recovered test execution;
- inconsistent npm/pnpm test inventories;
- financial reconciliation discrepancies;
- missing evidence;
- leaked containers or volumes.
