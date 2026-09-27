# ForgeQA — Reusable Test Infrastructure for SaaS Teams

ForgeQA is an open-source TypeScript quality platform built around Playwright Test rather than replacing it. It provides validated configuration, deterministic identities and data, guarded API/database helpers, normalized shard evidence, strict report merging, transparent flake statistics, accountable quarantine metadata, centralized quality gates, a scaffolding CLI, and a GitHub Action entrypoint.

> **First-consumer milestone:** native execution, typed fixtures, strict reporting and a real PostgreSQL-backed TeamBoard are now implemented. The first-pass TeamBoard inventory has been exercised in the workspace and isolated npm/pnpm consumers across Chromium, Firefox and WebKit. Exact-source evidence and remaining checks are tracked in the [delivery status](docs/delivery/STATUS.md); this is not a publication claim.

> **Release status:** source implementation, local package build, self-tests, and an exact-revision API-first LedgerGuard consumer are available. The new LedgerGuard lane still requires hosted exact-source acceptance before it can be promoted from implementation evidence to verified release evidence. npm publication, a standalone action tag, a live documentation deployment, and full release acceptance remain external deliverables.

## Why it exists

SaaS teams frequently have Playwright suites but lack safe test-data ownership, deterministic execution identity, complete distributed-shard reconciliation, stable result contracts, honest retry metrics, and one policy engine shared by local and CI workflows. ForgeQA makes those concerns explicit while preserving native Playwright locators, assertions, projects, traces, reporters, and scheduling.

## Packages

| Package | Responsibility |
|---|---|
| `@azerish25-ux/forgeqa-core` | configuration, identities, contracts, redaction, changed-area selection, gates |
| `@azerish25-ux/forgeqa-playwright` | native fixture extension and annotations |
| `@azerish25-ux/forgeqa-api` | origin-scoped HTTP client, deadlines, cancellation, bounded polling |
| `@azerish25-ux/forgeqa-test-data` | deterministic factories, namespaces, cleanup, guarded PostgreSQL adapter |
| `@azerish25-ux/forgeqa-reporter` | journals, integrity-aware shard merging, JSON/JUnit/Markdown/HTML |
| `@azerish25-ux/forgeqa-flake-analysis` | metrics, fingerprints, quarantine, history, comparisons |
| `@azerish25-ux/forgeqa-github` | GitHub Action runtime helpers |
| `@azerish25-ux/forgeqa-cli` | `forgeqa` command and safe initialization templates |

## Local verification

```bash
npm run verify
node packages/cli/dist/cli.js --help
```

No package registry credentials or paid infrastructure are required for verification. Ordinary dependencies must be installed first with `npm ci --ignore-scripts`. See [first-consumer verification](docs/first-consumer.md) for actual execution and packed npm/pnpm adoption. The CLI exits with `0` for policy-compliant success, `1` for test/quality failure, `2` for invalid usage/configuration, `3` for infrastructure/report-integrity failure, and `130` for interruption.

## Example configuration

```ts
import { defineForgeConfig } from '@azerish25-ux/forgeqa-core';

export default defineForgeConfig({
  project: 'teamboard',
  environments: {
    local: { baseUrl: 'http://127.0.0.1:3000' }
  },
  browsers: ['chromium', 'firefox', 'webkit'],
  retries: process.env.CI ? 1 : 0,
  workers: 4,
  shards: 1
});
```

## Strict behavior

- A retry-recovered test remains visible as flaky and fails the default strict gate.
- Missing, duplicate, incompatible, incomplete, or corrupt shard evidence cannot merge to green.
- Quarantined tests remain in execution and failing quarantined tests still fail.
- Missing history is represented as insufficient data, not a zero flake rate.
- Unknown changed paths broaden to the full suite.
- HTTP writes are not retried unless the caller explicitly declares idempotency and supplies an idempotency key.
- Secrets are redacted from textual diagnostics, while binary traces and screenshots are treated as sensitive rather than falsely “sanitized.”

## Repository map

- [`docs/architecture.md`](docs/architecture.md) — boundaries and data flow
- [`docs/configuration.md`](docs/configuration.md) — precedence and validation
- [`docs/security.md`](docs/security.md) — trust boundaries and artifact privacy
- [`docs/delivery/requirements.json`](docs/delivery/requirements.json) — factual status matrix
- [`examples/demo-saas`](examples/demo-saas) — Working TeamBoard application, PostgreSQL migrations and consumer suites
- [`consumers/ledgerguard`](consumers/ledgerguard) — executable API-first LedgerGuard consumer pinned to verified P07A source
- [`docs/ledgerguard-consumer.md`](docs/ledgerguard-consumer.md) — revision, trust, topology, package and evidence boundaries
- [`adrs`](adrs) — engineering decisions

## Current limitations

The implemented product does not complete every release requirement. The status matrix intentionally marks unexecuted external requirements as `BLOCKED`, `PARTIAL`, or `NOT_RUN` instead of equating files with verified behavior. The LedgerGuard harness is real and executable, but this source revision does not claim its new hosted lane has passed until an exact-head GitHub run records that evidence. It also does not claim a LedgerGuard browser UI, published npm packages, a Marketplace listing, deployed docs, or a complete release acceptance decision.
