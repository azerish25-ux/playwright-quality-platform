# Earlier acceptance milestones

These are historical receipts at their named source revisions, not current-source test results. Current scope is in the [delivery checkpoint](STATUS.md).

> **First consumer:** the PostgreSQL-backed TeamBoard application runs eight API cases and four UI journeys across Chromium, Firefox, and WebKit, including workspace and isolated npm/pnpm package adoption.

> **Second consumer:** the genuine Bad Penny application (LedgerGuard protocol) passes 12 API cases and four real UI journeys across Chromium, Firefox and WebKit through each isolated npm/pnpm consumer, with financial reconciliation and owned-infrastructure cleanup. [Exact browser acceptance](../../docs/delivery/browser-consumer-acceptance.json).

> **Phase 10A hardening:** exact-source CI run `36355636084` passed at revision `b679c996d9f33afb6a7d89fee294bd6fdfe3afc6`. The required hardening lane measured 98.63% line, 96.46% branch, and 98.77% function coverage, audited all eight package tarballs, verified clean npm/pnpm consumers, and passed the final `forgeqa-quality` aggregate.

> **Phase 11A hosted execution:** source `9361d9fa9515ae9c173f644b993472133032e85e` passed CI `36444479253` and benchmark workflow `36444479660`: five conditions × five repetitions × 20 identical executions, plus verified warm-ups, real reporter-overhead measurements, synthetic scaling and cleanup. [Exact evidence](../../docs/delivery/benchmark-live-acceptance.md) is retained. Heterogeneous runner hardware blocks speedup claims; this is not controlled-hardware release performance evidence.

> **Release status:** npm publication, an immutable public action tag and major alias, deployed versioned documentation, comparable hosted benchmark results, Marketplace distribution, and the final delivery audit remain later phases.

> **Phase 12A hosted acceptance passed** at `eab1c4fb105de7def46de0511b0af8c16763db44`: CI `36503848156`, Documentation `36503848142` and Release candidates `36503848112` passed. Semantic-release prepared all eight packages at 1.0.0; final-tarball and isolated-registry npm/pnpm consumers plus actual npm interruption/recovery passed. Both downloaded archives and all source/prepared tarballs were independently verified. [Exact acceptance](../../docs/delivery/release-engine-live-acceptance.md), [scoped ledger](../../docs/delivery/release-engine-requirements.json), and [maintainer guide](../../docs/guide/release-engine.md). The public publishing job was skipped: 1.0.0 is a prepared candidate, not a public or stable release.

> **Execution-stage profiling accepted** at `470843e48b5f9eb19c8f75c439eb5e19f88de5e3`: CI `36569710737`, controlled benchmark `36569710704`, and distributed benchmark `36569711293` passed. The retained evidence includes real readiness/test/reporting/shutdown spans, 300 controlled and 500 distributed-condition clean measured executions, and independently revalidated profiles. Distributed hardware remains `NOT_COMPARABLE`; no distributed speedup or public release is claimed. [Receipt](../../docs/delivery/timing-profiling-live-acceptance.md) · [Timing semantics](../../docs/guide/execution-timing.md).

## Documentation and onboarding

> **Naming and compatibility:** Deadpan is the project name. The existing `forgeqa` executable, `@azerish25-ux/forgeqa-*` package names, configuration keys, and on-disk formats remain unchanged so current integrations continue to work. Commands and imports below use those actual interfaces; historical artifact names, source revisions, and evidence receipts retain their original identifiers.

**Phase 11B hosted acceptance passed** at `54f25b2a865b8b90c7fe00b34142cbb282d99a57`: Documentation run `36468235212` and full CI `36468235190` succeeded. The version-aware site contains 46 documentation pages, generated references for all eight public packages, 15 substantive ADRs and exact tested snippets. All 3,543 local references passed; installed-tarball onboarding succeeded independently with npm and pnpm; Chromium verified navigation, search and mobile layout. [Acceptance receipt](../../docs/delivery/documentation-live-acceptance.md). `next` remains unreleased: no public website or registry publication is claimed. Subsequent source commits must pass both workflows again.

Start with [the source-candidate quickstart](../../docs/guide/quickstart.md), [documentation build/version maintenance](../../docs/guide/releases.md), and [the acceptance ledger](../../docs/delivery/documentation-requirements.json).
