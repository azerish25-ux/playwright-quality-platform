# Delivery checkpoint — Phase 12A release engine accepted

**Phase 12A semantic preparation and isolated-registry recovery passed hosted acceptance at `eab1c4fb105de7def46de0511b0af8c16763db44`. All 14 required CI jobs, Documentation and Release candidates passed. The complete public product is not released.**

## Phase 12A coordinated release acceptance

CI `36503848156`, Documentation `36503848142` and Release candidates `36503848112` passed at the exact source above. Semantic-release 25.0.9 prepared all eight packages at 1.0.0 without changing the source 0.1.0 manifests. Installed CLI/template versions, final-tarball npm/pnpm consumers, actual npm protocol interruption/recovery and fresh loopback-registry consumers passed.

Both downloaded archives matched GitHub digests. All sixteen source/prepared tarballs matched their sizes and SHA-256/SHA-512 values, and prepared non-manifest contents matched the source artifacts byte for byte. Four independent consumer receipts and their canonical reports were checked against exact source, version, package digests and first-pass outcomes. See [the hosted acceptance](release-engine-live-acceptance.md), [machine-readable receipt](release-engine-acceptance.json), and [Phase 12A matrix](release-engine-requirements.json).

P12A-01 through P12A-06 and P12A-08 are PASS within this scope. P12A-07 and broader RR-07 remain PARTIAL: the public publishing job was skipped, actual npm authorization/publication is unverified, and no stable tag, action alias or public website was released. The historical sections below retain their original source bindings rather than relabeling earlier artifacts.

## Release-readiness source acceptance

The continuation at `c8304873cfce584f352eca69d7ccae068fd3e3b1` passed full CI `36494379888`, Documentation `36494380027` and Release candidates `36494379998`. Complete tarballs are now bound to all fourteen required CI jobs and the independent documentation job. The downloaded candidate archive, full manifest digest and all eight SHA-256/SHA-512 tarballs were independently verified. See [the exact acceptance receipt](release-readiness-live-acceptance.md) and [scoped matrix](release-readiness-requirements.json).

Concurrent initialization/interruption recovery and real PostgreSQL ownership/reclamation regressions are included in this accepted source. The earlier [controlled local benchmark](controlled-local-acceptance.json) also has hosted acceptance and independently recomputed measurements; it does not establish distributed comparability or granular lifecycle timing. The history below retains its original source-specific boundaries.

At that earlier source, generic auth/fixture lifecycle acceptance and semantic-release version coordination were incomplete, alongside actual registry/action distribution, website deployment and the final audit. Phase 12A above accepts semantic preparation and isolated-registry recovery, not public publication or the remaining lifecycle/distribution requirements.

## Phase 10 accepted source baseline

Phase 10A is accepted at source revision `b679c996d9f33afb6a7d89fee294bd6fdfe3afc6` through CI run `36355636084`. The run completed successfully on September 27, 2026. Its aggregate `forgeqa-quality` job `108723606813` passed after every required cross-platform, packed-consumer, TeamBoard, LedgerGuard, hardening, and action lane succeeded.

The retained hardening artifact is `10944475111`, named `hardening-evidence-b679c996d9f33afb6a7d89fee294bd6fdfe3afc6`, with digest `sha256:2d0fa4830c9944a8dcb6327d9101a8bb04c32b6a4a73e96c147e9929744d6069`. Exact details are recorded in [hardening-live-acceptance.md](hardening-live-acceptance.md).

## Verified platform behavior

- Real config-driven Playwright discovery and execution with immutable expected inventories and stable logical, execution, attempt, run, and shard identities.
- Typed composable Playwright fixtures, strict native and CLI gates, journal/finalization integrity, and canonical JSON, JUnit, Markdown, and static HTML reports.
- Native distributed Playwright execution with independent shard dimensions and stable execution identities.
- Strict validation of finalized journals, completion markers, checksums, captured attachments, and Playwright blob reports before merge.
- Exact reconciliation between native Playwright counts, outcomes, projects, and canonical Deadpan results.
- Canonical merge ordering remains independent of shard arrival order even when timestamps and retry indexes tie.
- PostgreSQL-backed TeamBoard executes eight API cases and four UI journeys across Chromium, Firefox, and WebKit, including workspace and isolated npm/pnpm consumers.
- Genuine API-first LedgerGuard adoption executes twelve authentication, authorization, ownership, transfer, payment, adjustment, and scheduling journeys against pinned P07A application source, followed by financial reconciliation and owned-infrastructure cleanup.
- Historical reliability includes immutable records, bounded GitHub artifact import, comparable cohorts, retry-aware metrics, diagnostic repetition, accountable quarantine mutation, and centralized history-aware gates.
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

Five native-versus-Deadpan reporter-overhead repetitions per mode and five synthetic scaling repetitions at each of 1,000/10,000/100,000 attempts passed. Independent database cleanup found zero remaining owned namespaces, tenants or accounts. Twenty-two focused benchmark regressions pass.

Hardware fingerprints are not identical: `performanceStatus` is `NOT_COMPARABLE` and controlled-hardware `releaseEvidenceEligible` is `false`. The system withholds speedup and efficiency claims, rather than rounding away hardware differences. Readiness, in-process reporting and shutdown within each shard remain combined; finer lifecycle instrumentation is unfinished. The monthly one-repetition run remains a smoke test, not release-quality performance evidence.

See [benchmark-live-acceptance.md](benchmark-live-acceptance.md), [benchmark-requirements.json](benchmark-requirements.json), [benchmark-evidence.json](benchmark-evidence.json) and [benchmark-observations.csv](benchmark-observations.csv).

## Phase 11B hosted documentation acceptance

A version-aware MkDocs build now assembles maintained guides, 15 substantive ADRs and generated declarations for all eight public package APIs. `next` is explicitly unreleased. Future frozen versions require an exact source SHA, manifest hash and complete checked file inventory; no fictitious release snapshot is created.

Documentation acceptance bootstraps through installed package tarballs in separate npm and pnpm consumers, compiles the exact embedded snippets, exercises doctor/plan/Deadpan/native execution and compares identities. The separate read-only `Documentation` workflow also builds strictly, checks local links/anchors/assets, and exercises desktop/mobile navigation and local search in Chromium. It preserves evidence on failure and does not deploy Pages or publish packages.

Documentation job `109083620021` passed at `54f25b2a865b8b90c7fe00b34142cbb282d99a57`. Its retained artifact `10990396723` contains the strict site build, toolchain receipts, source and snippet hashes, npm/pnpm onboarding records and desktop/mobile/search screenshots. The build contains 46 documentation pages plus the generated 404 page; all 3,543 local references passed. Thirteen Node and seven Python documentation checks passed, and Chromium opened a real search result without page or asset errors. The full platform CI also succeeded at this exact source. P11B-01 through P11B-06 are `PASS`; see [documentation-live-acceptance.md](documentation-live-acceptance.md) and [documentation-requirements.json](documentation-requirements.json).

The initial browser-driver failure is retained as DOC-001 in the defect ledger; the accepted repair types actual keyboard events instead of silently assigning the search value. No timeout or retry policy was weakened. Later source revisions still require their own green CI and Documentation workflows. External-link HTTP availability, live deployment, real release snapshots and comprehensive adapter lifecycle acceptance are not claimed.

## GitHub platform and trusted PR reporting

The source-distributed action remains accepted:

- `action.yml` carries a tracked callable Node 24 distribution;
- action inputs and workspace-relative paths are validated and confined to `GITHUB_WORKSPACE`;
- application and test children do not inherit GitHub, Actions, or registry write credentials;
- plan, bounded local-shard, distributed-shard, and strict merge modes preserve nonzero quality, configuration, integrity, and interruption outcomes;
- the reusable workflow creates one immutable manifest, expands a `fail-fast: false` matrix, uploads complete evidence, and exposes a stable aggregate job;
- the trusted `workflow_run` publisher executes default-branch source only, validates run-bound data artifacts and exact GitHub job conclusions, rejects stale or changed-workflow results, and updates one bot-owned PR comment idempotently.

Hosted PR reporting evidence remains recorded in [pr-reporting-live-acceptance.md](pr-reporting-live-acceptance.md). Public action tags, a controlled major alias, and external immutable-action consumption remain Phase 12 work.

## Execution-stage profiling acceptance

Source `470843e48b5f9eb19c8f75c439eb5e19f88de5e3` passed CI, Documentation, release-candidate verification, five-repetition controlled benchmarks and five-repetition distributed benchmarks. The [exact receipt](timing-profiling-live-acceptance.md) binds the downloaded archive digests, independently recomputed summaries, 300 controlled and 500 distributed-condition clean executions, 30 zero-leak controlled cleanup checks and unchanged coverage gates. `TP-01` through `TP-05` and the instrumented scope of `P11-06` are accepted; `R-018`, `P11-05` and `RR-01` remain partial for distributed comparability.

The newer [crash recovery receipt](crash-recovery-acceptance.json) also accepts `RC-01` through `RC-06` for same-host process loss with a surviving private journal. It does not accept ephemeral-runner loss or cross-host ownership authority. Earlier dated fixture limitations must be read with that scoped extension.

## Explicit remaining boundaries

No public npm registry package publication is claimed. Source and prepared tarballs, including those exercised against the loopback registry, are not proof that npmjs.com contains the release.

No immutable public action release tag, controlled major alias, standalone action-distribution release, or external consumer against a released action is claimed. Source-level `uses: ./` acceptance is not substituted for released-action acceptance.

No GitHub Marketplace listing or account-owner terms acceptance is claimed.

LedgerGuard has genuine hosted API-first acceptance but still has no browser product interface. No copied or fabricated UI is substituted.

The five-repetition execution/evidence pipeline and [execution-stage profiling](timing-profiling-live-acceptance.md) are accepted. Same-runner local-worker comparison passed; distributed hardware comparability remains incomplete. The profiling receipt retains overlaps and unattributed time rather than claiming an exhaustive CPU or billed-workflow partition.

No versioned documentation website deployment is claimed. Markdown documentation and ADR source are not substituted for a visited, versioned deployment with link and snippet verification.

Public npm publication/recovery, full registry-installed TeamBoard/LedgerGuard acceptance, public action-tag acceptance, documentation deployment, complete generic authentication/fixture lifecycle, and the final delivery audit remain incomplete. The narrower semantic-preparation and isolated-registry recovery slice is accepted above.

See [requirements.json](requirements.json) for the broader product matrix, [release-engine-requirements.json](release-engine-requirements.json) for Phase 12A, [history-reliability-requirements.json](history-reliability-requirements.json) for Phase 7, [github-platform-requirements.json](github-platform-requirements.json) for Phase 8, [ledgerguard-consumer-requirements.json](ledgerguard-consumer-requirements.json) for Phase 9, [hardening-requirements.json](hardening-requirements.json) for Phase 10, [benchmark-requirements.json](benchmark-requirements.json) for Phase 11A, and [defects.md](defects.md) for repaired defects and regression evidence.
