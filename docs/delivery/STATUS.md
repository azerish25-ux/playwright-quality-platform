# Delivery checkpoint — Phase 11A benchmark candidate

**ForgeQA has exact-source hosted acceptance for its source-distributed GitHub platform, both real consumer integrations, and the Phase 10A release-blocking hardening baseline. This revision implements the Phase 11A reproducible TeamBoard benchmark system, but no hosted five-repetition benchmark result or public release is claimed yet.**

## Current accepted source baseline

Phase 10A is accepted at source revision `b679c996d9f33afb6a7d89fee294bd6fdfe3afc6` through CI run `36355636084`. The run completed successfully on September 27, 2026. Its aggregate `forgeqa-quality` job `108723606813` passed after every required cross-platform, packed-consumer, TeamBoard, LedgerGuard, hardening, and action lane succeeded.

The retained hardening artifact is `10944475111`, named `hardening-evidence-b679c996d9f33afb6a7d89fee294bd6fdfe3afc6`, with digest `sha256:2d0fa4830c9944a8dcb6327d9101a8bb04c32b6a4a73e96c147e9929744d6069`. Exact details are recorded in [hardening-live-acceptance.md](hardening-live-acceptance.md).

## Verified platform behavior

- Real config-driven Playwright discovery and execution with immutable expected inventories and stable logical, execution, attempt, run, and shard identities.
- Typed composable Playwright fixtures, strict native and CLI gates, journal/finalization integrity, and canonical JSON, JUnit, Markdown, and static HTML reports.
- Native distributed Playwright execution with independent shard dimensions and stable execution identities.
- Strict validation of finalized journals, completion markers, checksums, captured attachments, and Playwright blob reports before merge.
- Exact reconciliation between native Playwright counts, outcomes, projects, and canonical ForgeQA results.
- Canonical merge ordering remains independent of shard arrival order even when timestamps and retry indexes tie.
- PostgreSQL-backed TeamBoard executes eight API cases and four UI journeys across Chromium, Firefox, and WebKit, including workspace and isolated npm/pnpm consumers.
- Genuine API-first LedgerGuard adoption executes twelve authentication, authorization, ownership, transfer, payment, adjustment, and scheduling journeys against pinned P07A application source, followed by financial reconciliation and owned-infrastructure cleanup.
- Historical reliability includes immutable records, bounded GitHub artifact import, comparable cohorts, retry-aware metrics, repeat diagnostics, accountable quarantine mutation, and centralized history-aware gates.
- A callable Node 24 GitHub Action, distributed reusable workflow, stable aggregate check, and fork-safe trusted PR publisher.
- Release-blocking invariant, seeded-defect, compatibility, coverage, exact-tarball audit, and clean-consumer gates.

## Phase 10A hardening acceptance

The exact accepted run measured:

| Metric | Required | Observed |
|---|---:|---:|
| Lines | 90% | 98.63% |
| Branches | 85% | 96.46% |
| Functions | 85% | 98.77% |

The hardening lane audits all eight package tarballs, rejects private-source or local-protocol leakage, verifies exported and executable targets, scans for credential canaries, and installs the exact tarballs in clean npm and pnpm consumers. P10-01 through P10-06 are `PASS` in [hardening-requirements.json](hardening-requirements.json).

## Phase 11A benchmark candidate implemented

This revision adds a reproducible benchmark system around the real TeamBoard inventory. It compares:

- one shard with one worker;
- one shard with two workers;
- one shard with four workers;
- two independent GitHub runners with one worker each;
- four independent GitHub runners with one worker each.

The benchmark implementation provides:

- one immutable discovery inventory per condition;
- unique run identities per measured repetition;
- independent PostgreSQL and browser setup for every distributed shard;
- finalized ForgeQA journals and native Playwright blob evidence from every shard;
- fail-closed canonical merge and exact expected-versus-observed execution identity comparison;
- setup, execution, merge, elapsed wall, and aggregate runner timing;
- runner OS, CPU, memory, image, Node, Playwright, and package-manager metadata;
- retained raw JSONL and CSV records plus JSON and Markdown summaries;
- median, range, interquartile range, median absolute deviation, speedup, and parallel-efficiency calculations;
- bounded one-, three-, or five-repetition execution, with five required for release evidence;
- an explicit zero-warm-up policy recorded as a limitation rather than hidden from the results;
- focused regression tests for matrices, inventories, statistics, records, manifest materialization, and workflow structure.

The workflow is present at `.github/workflows/benchmark.yml`. The monthly scheduled run is a one-repetition contract smoke and is not release-quality performance evidence. A manually dispatched five-repetition exact-source run is still required before any benchmark result is accepted. See [benchmark-requirements.json](benchmark-requirements.json) and [../../benchmarks/README.md](../../benchmarks/README.md).

## GitHub platform and trusted PR reporting

The source-distributed action remains accepted:

- `action.yml` carries a tracked callable Node 24 distribution;
- action inputs and workspace-relative paths are validated and confined to `GITHUB_WORKSPACE`;
- application and test children do not inherit GitHub, Actions, or registry write credentials;
- plan, bounded local-shard, distributed-shard, and strict merge modes preserve nonzero quality, configuration, integrity, and interruption outcomes;
- the reusable workflow creates one immutable manifest, expands a `fail-fast: false` matrix, uploads complete evidence, and exposes a stable aggregate job;
- the trusted `workflow_run` publisher executes default-branch source only, validates run-bound data artifacts and exact GitHub job conclusions, rejects stale or changed-workflow results, and updates one bot-owned PR comment idempotently.

Hosted PR reporting evidence remains recorded in [pr-reporting-live-acceptance.md](pr-reporting-live-acceptance.md). Public action tags, a controlled major alias, and external immutable-action consumption remain Phase 12 work.

## Explicit remaining boundaries

No npm registry package publication is claimed. Source and CI tarballs are release candidates, not proof that the registry contains the release.

No immutable public action release tag, controlled major alias, standalone action-distribution release, or external consumer against a released action is claimed. Source-level `uses: ./` acceptance is not substituted for released-action acceptance.

No GitHub Marketplace listing or account-owner terms acceptance is claimed.

LedgerGuard has genuine hosted API-first acceptance but still has no browser product interface. No copied or fabricated UI is substituted.

No accepted comparable benchmark result is claimed until the five-repetition hosted workflow passes at the exact delivered revision and its retained records are reviewed.

No versioned documentation website deployment is claimed. Markdown documentation and ADR source are not substituted for a visited, versioned deployment with link and snippet verification.

Partial-publication recovery, registry installation acceptance, public action-tag acceptance, documentation deployment, coordinated release verification, and the final delivery audit remain incomplete.

See [requirements.json](requirements.json) for the broader product matrix, [history-reliability-requirements.json](history-reliability-requirements.json) for Phase 7, [github-platform-requirements.json](github-platform-requirements.json) for Phase 8, [ledgerguard-consumer-requirements.json](ledgerguard-consumer-requirements.json) for Phase 9, [hardening-requirements.json](hardening-requirements.json) for Phase 10, [benchmark-requirements.json](benchmark-requirements.json) for Phase 11A, and [defects.md](defects.md) for repaired defects and regression evidence.
