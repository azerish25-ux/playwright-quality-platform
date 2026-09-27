# ForgeQA — Reusable Test Infrastructure for SaaS Teams

ForgeQA is an open-source TypeScript quality platform built around Playwright Test rather than replacing it. It provides validated configuration, deterministic identities and data, guarded API/database helpers, normalized shard evidence, strict report merging, transparent flake statistics, accountable quarantine metadata, centralized quality gates, a scaffolding CLI, and a GitHub Action entrypoint.

> **First consumer:** the PostgreSQL-backed TeamBoard application runs eight API cases and four UI journeys across Chromium, Firefox and WebKit, including workspace and isolated npm/pnpm package adoption.

> **Second consumer:** the genuine API-first LedgerGuard integration runs against pinned P07A source with independent npm/pnpm consumers, financial reconciliation and owned-infrastructure cleanup.

> **Phase 10A hardening:** hosted exact-source acceptance passed at revision `75b30f421514c18416a687725caf2c6a0ab6367a` in CI run `36350020241`. The required hardening lane passed 23 tests, measured 98.63% line, 96.74% branch and 98.77% function coverage over the release-critical policy kernel, audited all eight package tarballs, and verified clean npm and pnpm consumers. Every required platform lane and the final `forgeqa-quality` aggregate passed.

> **Release status:** the maintained source and release-candidate interfaces are hardened, but npm publication, an immutable public action tag, a live versioned documentation deployment, comparable production benchmarks, Marketplace distribution and the final delivery audit remain later phases. Source tarballs are not represented as registry publications.

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

`npm run hardening` builds the exact source, runs invariant and seeded-defect suites, enforces 90% line and 85% branch coverage over release-critical runtime modules, freezes pre-release contracts, packs and inspects all eight packages, and installs those exact tarballs into clean npm and pnpm consumers.

No package registry credentials or paid infrastructure are required for source verification. The CLI exits with `0` for policy-compliant success, `1` for test or quality failure, `2` for invalid usage or configuration, `3` for infrastructure or report-integrity failure, and `130` for interruption.

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
- Secrets are redacted from publishable textual diagnostics, while binary traces and screenshots are treated as sensitive rather than falsely “sanitized.”
- Package candidates are accepted only after exact-tarball inspection, public-import checks, strict declaration compilation and clean npm/pnpm installation.
- The aggregate `forgeqa-quality` check cannot pass unless cross-platform verification, packed consumers, TeamBoard, LedgerGuard, hardening and action acceptance all pass.

## Repository map

- [`docs/architecture.md`](docs/architecture.md) — boundaries and data flow
- [`docs/configuration.md`](docs/configuration.md) — precedence and validation
- [`docs/security.md`](docs/security.md) — trust boundaries and artifact privacy
- [`docs/delivery/STATUS.md`](docs/delivery/STATUS.md) — current delivery checkpoint
- [`docs/delivery/hardening-live-acceptance.md`](docs/delivery/hardening-live-acceptance.md) — exact Phase 10 hosted evidence
- [`docs/delivery/hardening-requirements.json`](docs/delivery/hardening-requirements.json) — Phase 10 gates and all 50 adversarial scenarios
- [`examples/demo-saas`](examples/demo-saas) — working TeamBoard application and consumer suites
- [`consumers/ledgerguard`](consumers/ledgerguard) — executable API-first LedgerGuard consumer
- [`docs/ledgerguard-consumer.md`](docs/ledgerguard-consumer.md) — LedgerGuard revision, topology and evidence boundaries
- [`adrs`](adrs) — engineering decisions

## Current limitations

ForgeQA is not yet a public release. The status ledgers deliberately retain `PARTIAL`, `BLOCKED`, or `NOT_RUN` where a later phase is required. LedgerGuard has real API-first acceptance but no genuine browser product interface. ForgeQA does not yet claim published npm packages, an immutable public action release, a Marketplace listing, deployed versioned documentation, comparable production benchmark results, publication-recovery acceptance, or a completed final delivery audit.
