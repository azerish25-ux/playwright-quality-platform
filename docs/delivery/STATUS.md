# Delivery checkpoint — Phase 11B documentation candidate

**ForgeQA has hosted acceptance for the Phase 11A benchmark execution/evidence system at `9361d9fa9515ae9c173f644b993472133032e85e`, including five repetitions per condition. Hardware comparability and finer lifecycle profiling remain limited; the complete public product is not released.**

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

## Phase 11A hosted execution accepted

[CI run 36444479253](https://github.com/azerish25-ux/playwright-quality-platform/actions/runs/36444479253) and [benchmark run 36444479660](https://github.com/azerish25-ux/playwright-quality-platform/actions/runs/36444479660) passed at source `9361d9fa9515ae9c173f644b993472133032e85e`. The benchmark produced 25 condition/repetition records and verified the same 20 execution identities in each, with 500 clean first attempts total.

The system compares serial execution, two local worker counts and two true independent-runner shard counts. It verifies one separately retained warm-up per shard/repetition, immutable inventory, exact software/policy contracts, native/canonical report integrity and complete evidence. Raw JSONL/CSV, summaries, checksums, CPU/memory/version metadata and separate execution, merge, queue-inclusive wall and aggregate runner durations are retained.

Five native-versus-ForgeQA reporter-overhead repetitions per mode and five synthetic scaling repetitions at each of 1,000/10,000/100,000 attempts passed. Independent database cleanup found zero remaining owned namespaces, tenants or accounts. Twenty-two focused benchmark regressions pass.

Hardware fingerprints are not identical: `performanceStatus` is `NOT_COMPARABLE` and controlled-hardware `releaseEvidenceEligible` is `false`. The system withholds speedup and efficiency claims, rather than rounding away hardware differences. Readiness, in-process reporting and shutdown within each shard remain combined; finer lifecycle instrumentation is unfinished. The monthly one-repetition run remains a smoke test, not release-quality performance evidence.

See [benchmark-live-acceptance.md](benchmark-live-acceptance.md), [benchmark-requirements.json](benchmark-requirements.json), [benchmark-evidence.json](benchmark-evidence.json) and [benchmark-observations.csv](benchmark-observations.csv).

## Phase 11B documentation candidate

A version-aware MkDocs build now assembles maintained guides, 15 substantive ADRs and generated declarations for all eight public package APIs. `next` is explicitly unreleased. Future frozen versions require an exact source SHA, manifest hash and complete checked file inventory; no fictitious release snapshot is created.

Documentation acceptance bootstraps through installed package tarballs in separate npm and pnpm consumers, compiles the exact embedded snippets, exercises doctor/plan/ForgeQA/native execution and compares identities. The separate read-only `Documentation` workflow also builds strictly, checks local links/anchors/assets, and exercises desktop/mobile navigation and local search in Chromium. It preserves evidence on failure and does not deploy Pages or publish packages.

This records implementation, not hosted acceptance. The exact new source must pass both the full CI and `docs-quality` before these checks are promoted. External-link HTTP availability, live deployment, real release snapshots and comprehensive adapter lifecycle acceptance are not claimed. See [documentation-requirements.json](documentation-requirements.json).

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

The five-repetition execution/evidence pipeline is accepted. Controlled-hardware comparative performance and complete granular lifecycle timing are not claimed.

No versioned documentation website deployment is claimed. Markdown documentation and ADR source are not substituted for a visited, versioned deployment with link and snippet verification.

Partial-publication recovery, registry installation acceptance, public action-tag acceptance, documentation deployment, coordinated release verification, and the final delivery audit remain incomplete.

See [requirements.json](requirements.json) for the broader product matrix, [history-reliability-requirements.json](history-reliability-requirements.json) for Phase 7, [github-platform-requirements.json](github-platform-requirements.json) for Phase 8, [ledgerguard-consumer-requirements.json](ledgerguard-consumer-requirements.json) for Phase 9, [hardening-requirements.json](hardening-requirements.json) for Phase 10, [benchmark-requirements.json](benchmark-requirements.json) for Phase 11A, and [defects.md](defects.md) for repaired defects and regression evidence.
