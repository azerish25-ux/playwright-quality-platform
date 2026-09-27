# LedgerGuard second-consumer acceptance

ForgeQA's second consumer is the independently maintained LedgerGuard transaction-reliability
application. The integration is deliberately API-first because the pinned application revision has no
React product interface. No copied application, mock server, response interception, private ForgeQA
source import, fixed sleep, or permanent skip is accepted as evidence.

## Trust and revision boundary

- Repository: `azerish25-ux/transaction-reliability-lab`
- Exact source: `9478663f97f9dc65d0c85117f244e1b8b80c37cb`
- Application milestone: verified P07A scheduled transfers
- ForgeQA interface: public packages and CLI only
- LedgerGuard interface: public HTTP API only

CI checks out that exact SHA into a separate directory. It starts the real PostgreSQL, RabbitMQ, API,
outbox publisher, two payment workers, and two competing schedule workers. The source SHA is checked
before startup and is embedded in retained evidence.

## Exercised behavior

The nine-test ForgeQA inventory proves readiness/OpenAPI contracts, session authentication and logout,
customer/admin boundaries, account ownership, immediate transfers, exact idempotent replay,
changed-intent conflicts, insufficient-funds atomicity, asynchronous settlement with bounded polling,
partial/full refunds, administrative reversal, single-effect schedule occurrence execution, and
versioned schedule lifecycle commands. All money assertions use integer minor-unit strings.

After the workspace run, the same inventory is executed from isolated npm and pnpm installations built
from the exact ForgeQA source tarballs. Stable logical/project/environment identities—not counts alone—
must match the workspace run. Retry recovery cannot satisfy acceptance.

The job finally runs LedgerGuard's independent accounting reconciliation, captures service and ForgeQA
evidence, and removes the complete Compose project and volumes. Any startup, test, evidence, revision,
reconciliation, or teardown failure remains blocking in the aggregate `forgeqa-quality` job.

## Honest boundary

LedgerGuard's own verified P06 acceptance covers deterministic cancellation while workers are stopped.
This initial ForgeQA slice does not claim that scenario as second-consumer coverage because manipulating
application workers from inside a public-package consumer would couple the suite to LedgerGuard's
private orchestration. It also makes no UI claim until LedgerGuard has a real product interface.
