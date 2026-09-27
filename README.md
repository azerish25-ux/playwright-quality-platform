# ForgeQA — Reusable Test Infrastructure for SaaS Teams

ForgeQA is an open-source TypeScript quality platform built around Playwright Test rather than replacing it. It provides validated configuration, deterministic identities and data, guarded API/database helpers, normalized shard evidence, strict report merging, transparent flake statistics, accountable quarantine metadata, centralized quality gates, a scaffolding CLI, and a GitHub Action entrypoint.

> **First-consumer milestone:** native execution, typed fixtures, strict reporting and a real PostgreSQL-backed TeamBoard are implemented. The TeamBoard inventory has been exercised in the workspace and isolated npm/pnpm consumers across Chromium, Firefox and WebKit. Exact-source evidence and remaining checks are tracked in the [delivery status](docs/delivery/STATUS.md); this is not a publication claim.

> **Second-consumer milestone:** the genuine API-first LedgerGuard consumer passed hosted exact-source acceptance at ForgeQA revision `4ed8584ec0a04e14283109ad5e7f1fa7a4053077` in CI run `36346441131`, including independent npm/pnpm consumers, financial reconciliation, and owned-infrastructure cleanup.

> **Release status:** Phase 10A now contains a release-blocking hardening candidate: policy-kernel coverage thresholds, property/invariant tests, focused seeded-defect tests, frozen pre-release contracts, deep tarball inspection, and a required hosted `hardening` lane. That candidate still requires an exact-source green run before it becomes verified hardening evidence. npm publication, an immutable public action tag, a live versioned documentation deployment, and complete release acceptance remain later deliverables.

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
npm ci --ignore-scripts
npm run verify
npm run hardening
node packages/cli/dist/cli.js --help
```

`npm run hardening` builds the exact source, runs invariant and seeded-defect suites, enforces 90% line and 85% branch coverage over the release-critical policy kernel, freezes pre-release package/action/report contracts, packs all eight packages, inspects their tarballs, and installs those exact tarballs into clean npm and pnpm consumers.

No package registry credentials or paid infrastructure are required for source verification. See [first-consumer verification](docs/first-consumer.md) for actual execution and packed npm/pnpm adoption. The CLI exits with `0` for policy-compliant success, `1` for test/quality failure, `2` for invalid usage/configuration, `3` for infrastructure/report-integrity failure, and `130` for interruption.

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
- Package candidates are accepted only after tarball-content checks and clean npm/pnpm installation through public interfaces.
- The aggregate `forgeqa-quality` check cannot pass unless the cross-platform, consumer, TeamBoard, LedgerGuard, hardening, and action lanes all pass.

## Repository map

- [`docs/architecture.md`](docs/architecture.md) — boundaries and data flow
- [`docs/configuration.md`](docs/configuration.md) — precedence and validation
- [`docs/security.md`](docs/security.md) — trust boundaries and artifact privacy
- [`docs/delivery/requirements.json`](docs/delivery/requirements.json) — broader factual status matrix
- [`docs/delivery/hardening-requirements.json`](docs/delivery/hardening-requirements.json) — Phase 10 gates and all 50 adversarial scenarios
- [`examples/demo-saas`](examples/demo-saas) — working TeamBoard application, PostgreSQL migrations and consumer suites
- [`consumers/ledgerguard`](consumers/ledgerguard) — executable API-first LedgerGuard consumer pinned to verified P07A source
- [`docs/ledgerguard-consumer.md`](docs/ledgerguard-consumer.md) — revision, trust, topology, package and evidence boundaries
- [`adrs`](adrs) — engineering decisions

## Current limitations

The implemented product does not complete every release requirement. The status matrices intentionally mark unexecuted external requirements as `BLOCKED`, `PARTIAL`, or `NOT_RUN` instead of equating files with verified behavior. LedgerGuard has hosted API-first acceptance but still has no genuine browser product interface. ForgeQA does not yet claim published npm packages, an immutable public action release, a Marketplace listing, deployed versioned documentation, comparable production benchmarks, or a complete release acceptance decision.
