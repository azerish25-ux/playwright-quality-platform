# LedgerGuard second-consumer acceptance

Deadpan validates its public API against two materially different applications. TeamBoard is a TypeScript SaaS application with browser journeys. The LedgerGuard protocol is now implemented by Bad Penny, a Java/Spring, PostgreSQL and RabbitMQ application with a genuine React frontend. The current product-gate-verified source is pinned at `d8d365690d961580d22105feb15ddec3267185ae`. Its product campaign passed job `109700516992` in run `36656046918`; the separate internal fault-lab failure at that source is not represented as a green overall workflow.

## Trust and revision model

The CI lane performs a separate checkout of the public LedgerGuard repository at the exact SHA. `scripts/ledgerguard-acceptance.mjs` independently verifies that checkout before starting any service. The harness records both the Deadpan and LedgerGuard SHAs in its acceptance record.

A later LedgerGuard revision is not adopted merely because it exists on `main`. It must first have equivalent permanent application evidence, then this pin and its consumer contract must be reviewed together.

## Topology

The normal product Compose topology plus its P07 overlay contains:

- PostgreSQL 17;
- RabbitMQ;
- the LedgerGuard HTTP API and real same-origin frontend;
- an outbox publisher;
- two independent asynchronous payment workers;
- two independent scheduled-transfer workers.

One-run credentials, signing material, ports, and the Compose project name are generated at execution time. Values are stored only in a mode-`0600` temporary environment file and are redacted from failure records. The lane removes its containers and named volumes before it can pass.

## Public Deadpan adoption

All eight Deadpan packages are packed from the tested repository revision. An isolated copy of `consumers/ledgerguard` is installed once with npm and once with pnpm. The consumers cannot use workspace links and compile only documented package entrypoints. Both package managers must execute the same logical test identity set with zero retries and a passing strict gate.

## Honest scope

The previously accepted P07A slice remains API-first historical evidence. The current extension executes 12 API cases plus four browser journeys on each of Chromium, Firefox and WebKit, for 24 executions per isolated npm/pnpm consumer. It is implemented pending exact-source hosted acceptance. Browser coverage uses real registration, wallets, transfer confirmation and committed-response recovery, asynchronous settlement, and administrator/session boundaries. No fake frontend or successful response is substituted; the separate fault-lab Compose overlay is not part of the consumer. Each UI execution must retain an actual screenshot, and the financial reconciliation and zero-leak gates remain mandatory.

## Failure semantics

The lane fails for any of the following:

- source revision drift;
- unavailable or incomplete topology;
- malformed public-package installation;
- private Deadpan imports;
- a missing, unexpected, duplicate, skipped, failed, or retry-recovered test execution;
- inconsistent npm/pnpm test inventories;
- financial reconciliation discrepancies;
- missing evidence;
- leaked containers or volumes.
