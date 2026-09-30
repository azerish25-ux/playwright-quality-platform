# LedgerGuard external consumer

This directory is Deadpan's genuine second-consumer harness for the real [`azerish25-ux/transaction-reliability-lab`](https://github.com/azerish25-ux/transaction-reliability-lab) application. The application is now branded Bad Penny and supplies a genuine React product interface. This consumer preserves its LedgerGuard protocol names and tests both real API and browser behavior. No mock service, copied TeamBoard application, intercepted success response, invented endpoint, or permanent skip is used.

## Pinned application boundary

The acceptance lane checks out LedgerGuard at exact product-gate-verified source:

```text
d8d365690d961580d22105feb15ddec3267185ae
```

That revision passed the required product campaign job `109700516992` in run `36656046918`. The separate internal fault-lab job failed at that source; this is not represented as a completely green application workflow. The ordinary product topology is the consumer boundary; `compose.lab.yaml` is not used. The Deadpan harness refuses a different checkout rather than silently following LedgerGuard's moving `main` branch.

## What the suite proves

Twelve API tests plus four genuine UI journeys on each of Chromium, Firefox and WebKit (24 executions per package manager) exercise the live Compose topology through public Deadpan packages:

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
npx --no-install playwright install --with-deps chromium firefox webkit
npm run test:ledgerguard
```

The acceptance harness:

1. creates private one-run credentials and starts PostgreSQL, RabbitMQ, the API, genuine frontend, outbox publisher, two payment workers, and two schedule workers;
2. seeds only the synthetic LedgerGuard fixtures;
3. packs all eight Deadpan packages from the tested source;
4. installs and type-checks isolated npm and pnpm consumers without workspace links or private source imports;
5. runs the same 24-execution identity inventory through the public Deadpan CLI;
6. validates canonical evidence and strict quality gates;
7. reconciles every balance, journal, and active hold;
8. captures genuine browser screenshots and logs, then removes all test containers, volumes and networks.

Durable evidence is written beneath `evidence/ledgerguard/`. It records both source SHAs, package checksums, manager-specific reports, reconciliation status, and cleanup status without storing generated credentials.

## Browser boundaries

The browser journeys cover registration, zero-balance wallet creation, sign-out and
reauthentication; transfer review dismissal and actual committed-response loss with
same-key replay and one economic effect; asynchronous payment settlement with a
real journal; and administrator/session boundaries. The transfer interruption calls
the real backend before dropping the response; it never fulfills a fabricated success.
Each browser journey retains a screenshot from synthetic, owned data. Traces, videos
and serialized credential state remain excluded. API tests and global balance/hold
reconciliation still run, with no retry recovery accepted as a clean pass.

This extension passed exact-source hosted consumer acceptance at Deadpan `b65257f86785ee67969081c843f9b1444e787a30`, CI `36675733584` and job `109760164775`; the scoped receipt is `docs/delivery/browser-consumer-acceptance.json`.
The application source and test count are never changed merely to make CI pass.
