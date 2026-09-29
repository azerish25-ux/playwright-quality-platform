# ForgeQA — Reusable Test Infrastructure for SaaS Teams

ForgeQA is an open-source TypeScript quality platform built around Playwright Test rather than replacing it. It provides validated configuration, deterministic identities and data, guarded API/database helpers, normalized shard evidence, strict report merging, transparent flake statistics, accountable quarantine metadata, centralized quality gates, a scaffolding CLI, and a GitHub Action entrypoint.

> **First consumer:** the PostgreSQL-backed TeamBoard application runs eight API cases and four UI journeys across Chromium, Firefox, and WebKit, including workspace and isolated npm/pnpm package adoption.

> **Second consumer:** the genuine API-first LedgerGuard integration passes hosted acceptance against pinned P07A source with isolated npm/pnpm consumers, financial reconciliation, and owned-infrastructure cleanup.

> **Phase 10A hardening:** exact-source CI run `36355636084` passed at revision `b679c996d9f33afb6a7d89fee294bd6fdfe3afc6`. The required hardening lane measured 98.63% line, 96.46% branch, and 98.77% function coverage, audited all eight package tarballs, verified clean npm/pnpm consumers, and passed the final `forgeqa-quality` aggregate.

> **Phase 11A hosted execution:** source `9361d9fa9515ae9c173f644b993472133032e85e` passed CI `36444479253` and benchmark workflow `36444479660`: five conditions × five repetitions × 20 identical executions, plus verified warm-ups, real reporter-overhead measurements, synthetic scaling and cleanup. [Exact evidence](docs/delivery/benchmark-live-acceptance.md) is retained. Heterogeneous runner hardware blocks speedup claims; this is not controlled-hardware release performance evidence.

> **Release status:** npm publication, an immutable public action tag and major alias, deployed versioned documentation, comparable hosted benchmark results, Marketplace distribution, and the final delivery audit remain later phases.

> **Phase 12A hosted acceptance passed** at `eab1c4fb105de7def46de0511b0af8c16763db44`: CI `36503848156`, Documentation `36503848142` and Release candidates `36503848112` passed. Semantic-release prepared all eight packages at 1.0.0; final-tarball and isolated-registry npm/pnpm consumers plus actual npm interruption/recovery passed. Both downloaded archives and all source/prepared tarballs were independently verified. [Exact acceptance](docs/delivery/release-engine-live-acceptance.md), [scoped ledger](docs/delivery/release-engine-requirements.json), and [maintainer guide](docs/guide/release-engine.md). The public publishing job was skipped: 1.0.0 is a prepared candidate, not a public or stable release.

## Documentation and onboarding

**Phase 11B hosted acceptance passed** at `54f25b2a865b8b90c7fe00b34142cbb282d99a57`: Documentation run `36468235212` and full CI `36468235190` succeeded. The version-aware site contains 46 documentation pages, generated references for all eight public packages, 15 substantive ADRs and exact tested snippets. All 3,543 local references passed; installed-tarball onboarding succeeded independently with npm and pnpm; Chromium verified navigation, search and mobile layout. [Acceptance receipt](docs/delivery/documentation-live-acceptance.md). `next` remains unreleased: no public website or registry publication is claimed. Subsequent source commits must pass both workflows again.

Start with [the source-candidate quickstart](docs/guide/quickstart.md), [documentation build/version maintenance](docs/guide/releases.md), and [the acceptance ledger](docs/delivery/documentation-requirements.json).

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
npm run test:benchmarks
npm run benchmark
node packages/cli/dist/cli.js --help
```

`npm run hardening` builds the exact source, runs invariant and seeded-defect suites, enforces 90% line and 85% branch coverage over the release-critical policy kernel, freezes pre-release package/action/report contracts, packs all eight packages, inspects their tarballs, and installs those exact tarballs in clean npm and pnpm consumers. `npm run benchmark` previews the hosted condition matrix without consuming runners; the authoritative measurements execute through `.github/workflows/benchmark.yml`.

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
- [`docs/delivery/hardening-live-acceptance.md`](docs/delivery/hardening-live-acceptance.md) — exact Phase 10 hosted evidence
- [`docs/delivery/hardening-requirements.json`](docs/delivery/hardening-requirements.json) — Phase 10 gates and all 50 adversarial scenarios
- [`benchmarks/README.md`](benchmarks/README.md) — comparable conditions, evidence contracts, and interpretation rules
- [`docs/delivery/benchmark-requirements.json`](docs/delivery/benchmark-requirements.json) — Phase 11A implementation and hosted-acceptance boundary
- [`examples/demo-saas`](examples/demo-saas) — working TeamBoard application, PostgreSQL migrations and consumer suites
- [`consumers/ledgerguard`](consumers/ledgerguard) — executable API-first LedgerGuard consumer pinned to verified P07A source
- [`docs/ledgerguard-consumer.md`](docs/ledgerguard-consumer.md) — revision, trust, topology, package and evidence boundaries
- [`adrs`](adrs) — engineering decisions

## Current limitations

ForgeQA is not yet a public release. The status ledgers retain `PARTIAL`, `IMPLEMENTED`, `BLOCKED`, or `NOT_RUN` where later hosted or external acceptance is required. LedgerGuard has real API-first acceptance but no genuine browser product interface. The benchmark execution system has five-repetition hosted acceptance; controlled-hardware comparison and finer lifecycle profiling remain incomplete. ForgeQA does not yet claim published npm packages, an immutable public action release, a Marketplace listing, deployed versioned documentation, public-registry publication-recovery acceptance, or a completed final delivery audit.
