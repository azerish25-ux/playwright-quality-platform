# LedgerGuard integration contract

The executable, packed-package LedgerGuard consumer lives at [`consumers/ledgerguard`](../../consumers/ledgerguard). This compatibility directory remains outside the executable package and records the historical requirement location used by ForgeQA's delivery ledger.

The required CI lane pins `azerish25-ux/transaction-reliability-lab` to verified P07A source `9478663f97f9dc65d0c85117f244e1b8b80c37cb`, runs the real PostgreSQL/RabbitMQ/API/worker/scheduler topology, installs ForgeQA tarballs through independent npm and pnpm consumers, executes twelve API journeys, reconciles financial state, and removes owned infrastructure before passing.

No mock service, copied TeamBoard application, fabricated browser UI, intercepted success response, invented endpoint, or permanent skip is accepted.
