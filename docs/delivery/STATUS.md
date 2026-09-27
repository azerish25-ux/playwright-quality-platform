# Delivery checkpoint — Phase 8 GitHub platform hardening

**The source-distributed GitHub Action and reusable-workflow milestone is implemented and verified at an exact source revision; the complete ForgeQA product is not released.**

The recorded code checkpoint is `570bcd08c0334cd4f9776a8846e6dda8dbdbb10b`. [CI run 36319982582](https://github.com/azerish25-ux/playwright-quality-platform/actions/runs/36319982582) is the exact-source pull-request verification for that revision. It completed successfully on September 27, 2026. Statuses below describe observations at that checkpoint; later source changes require their own exact-SHA checks.

## Verified platform behavior

- Real config-driven Playwright discovery and execution, typed composable fixtures, strict native and CLI gates, journal/finalization integrity, and canonical JSON/JUnit/Markdown/HTML output.
- Native distributed Playwright execution with immutable expected inventories, real shard dimensions and stable execution identities.
- Strict distributed evidence validation: finalized journals, completion markers, checksums, captured attachments and Playwright blob reports are validated before merge.
- Native blob reports merge through Playwright's supported command, and native counts/outcomes/projects are reconciled exactly with canonical ForgeQA results before publication.
- PostgreSQL-backed TeamBoard executes eight API cases and four UI journeys in Chromium, Firefox and WebKit, including workspace and independent npm/pnpm package consumers.
- Historical reliability includes immutable records, bounded GitHub artifact import, comparable cohorts, precise retry metrics, diagnostic repetition, explicit quarantine mutation and centralized history-aware gates.
- The exact Phase 8 checkpoint passed all six Linux/macOS/Windows Node 22/24 verification jobs, all three independent consumer jobs, the PostgreSQL/three-browser TeamBoard job, the real action-acceptance job and the aggregate `forgeqa-quality` gate.

## GitHub platform milestone delivered

- `action.yml` invokes a tracked Node 24 JavaScript distribution. A checkout of an action ref contains the callable runtime without requiring a build step first.
- Action inputs are typed and validated. Working directories, configuration, CLI, manifest, evidence and output paths are confined to `GITHUB_WORKSPACE` with canonical-path and symbolic-link checks.
- GitHub, Actions and registry credentials are removed from application, ForgeQA and Playwright child processes. Dependency installation receives registry authentication only where needed.
- The action supports plan, bounded local multi-shard execution, explicit distributed-shard execution and strict evidence merge modes.
- Local shards share one total worker budget, retain every shard result and merge canonical/native evidence before propagating quality or infrastructure status.
- Exit codes `1`, `2`, `3` and `130` remain nonzero after outputs and evidence are written. Early validation failures retain an owned `action-failure.json` record.
- The reusable workflow creates one immutable manifest, expands a validated independent shard matrix with `fail-fast: false`, uploads complete per-shard evidence and provides a stable aggregate `forgeqa-quality` job.
- Plan, shard and merge jobs use one immutable action commit rather than a floating branch or tag.
- The source repository exercised `uses: ./` against a real two-test API-only consumer, ran two shards, merged the native and canonical evidence, verified action outputs and uploaded the evidence artifact.
- Workflow tests enforce the tracked action entrypoint, immutable internal references, absence of failure masking, aggregate-gate wiring and cross-platform line-ending behavior.

The detailed M4 requirement ledger is [github-platform-requirements.json](github-platform-requirements.json). M4-01 through M4-07 pass at the checkpoint above. M4-08 remains partial, and release-specific M4-09 through M4-11 remain not run.

## Explicit remaining boundaries

Idempotent pull-request comment publication has not been implemented. Current pull-request reporting is limited to least-privilege job summaries and authenticated workflow artifacts.

No immutable public action release tag, controlled major alias, standalone action-distribution release or external consumer against a released action is claimed. Source-level `uses: ./` acceptance is not substituted for released-action acceptance.

No GitHub Marketplace listing or Marketplace account-owner terms acceptance is claimed.

LedgerGuard has an executable foundation, but the inspected revision lacks the required product-facing authentication/payment/UI integration. No fake second application is substituted.

The 90/85 runtime coverage thresholds, comparable distributed benchmarks, complete generic fixture lifecycle/property coverage, versioned documentation deployment and npm publication remain unverified or unreleased. Source-candidate tarballs are not registry publications.

See [requirements.json](requirements.json) for the broader product matrix, [history-reliability-requirements.json](history-reliability-requirements.json) for Phase 7, and [defects.md](defects.md) for repaired defects and regression evidence.
