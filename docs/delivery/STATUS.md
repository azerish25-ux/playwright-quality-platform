# Delivery checkpoint — Phase 10A hardening candidate

**The source-distributed GitHub Action, reusable workflow, fork-safe PR reporting, two real consumers, and the Phase 10A hardening implementation are present. The hardening candidate still requires its own exact-source hosted green run, and the complete ForgeQA product is not released.**

The foundational Phase 8 checkpoint is `570bcd08c0334cd4f9776a8846e6dda8dbdbb10b`. CI run `36319982582` is the exact-source pull-request verification for that revision. It completed successfully on September 27, 2026. The trusted publisher permission repair is merged at `9f607d13bfe7fcb314c66ea87220ea2e0448d8e9`; hosted creation and update-in-place acceptance was exercised by PR #7 through head `24a5894628da0f5d21323202ca0628de0517523a`.

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

The detailed M4 requirement ledger is [github-platform-requirements.json](github-platform-requirements.json). M4-01 through M4-08 pass. Release-specific M4-09 through M4-11 remain not run.

## PR reporting hosted acceptance passed

The M4-08 implementation and hosted evidence prove:

- pull-request CI emits a run/attempt-bound, data-only report artifact even when the aggregate quality step fails;
- a separate `workflow_run` publisher executes only default-branch source with narrowly scoped read/comment permissions and never checks out pull-request code;
- GitHub API metadata resolves PR association when `workflow_run.pull_requests` is empty;
- artifact names, metadata, extracted paths, size/file bounds, schema fields, revisions, timestamps, job inventory and conclusions fail closed;
- current-head and newer-run checks execute before processing and immediately before mutation;
- one bot-owned marker comment is created or updated idempotently, paginated lookup is supported, attacker marker comments are ignored and duplicate bot comments are removed;
- missing evidence or comment permission does not become a clean result and does not alter the originating CI conclusion;
- a pre-download authorization pass rejects changed CI workflows and oversized, missing, duplicate or expired artifacts before extraction;
- report claims are cross-checked against GitHub's exact-attempt job inventory and conclusions rather than trusted from PR-produced JSON.

Hosted PR #7 acceptance first created comment `5856548977` after CI run `36324283050` and publisher run `36324606250`. A later documentation-only revision at `24a5894628da0f5d21323202ca0628de0517523a` passed CI run `36327735451`; publisher run `36328071048` updated the same comment in place. Detailed acceptance evidence is recorded in [pr-reporting-live-acceptance.md](pr-reporting-live-acceptance.md).

## Phase 9 LedgerGuard hosted acceptance passed

ForgeQA contains a genuine API-first second-consumer harness under `consumers/ledgerguard`. It pins `azerish25-ux/transaction-reliability-lab` to verified P07A source `9478663f97f9dc65d0c85117f244e1b8b80c37cb`, whose application verification run is `36319414655`.

At ForgeQA source `4ed8584ec0a04e14283109ad5e7f1fa7a4053077`, CI run `36346441131` completed successfully. Its `ledgerguard` job `108696406407` started LedgerGuard's real PostgreSQL, RabbitMQ, API, outbox, two payment-worker and two scheduler topology; installed all eight packed ForgeQA packages into isolated npm and pnpm consumers; executed twelve authentication, authorization, ownership, transfer, payment, adjustment and scheduling tests; compared both consumer identity inventories; reconciled financial state; and proved container, volume, and network cleanup. Retained artifact `10941370883` has digest `sha256:75edc52defcc70910e03698ec519481bc57f4fe5c73f57380651ff908f8528c0`.

M5-08 is therefore `PASS`. LedgerGuard still has no genuine React product interface, so M5-09 remains `BLOCKED`; no fabricated UI is substituted. See [ledgerguard-consumer-requirements.json](ledgerguard-consumer-requirements.json) and [../ledgerguard-consumer.md](../ledgerguard-consumer.md).

## Phase 10A hardening candidate implemented

The next source revision adds a required, release-blocking `hardening` job and expands trusted PR-report schema compatibility from versions 1 and 2 to a hardening-aware version 3. The candidate includes:

- a built-in Node coverage runner enforcing 90% line and 85% branch coverage over release-critical policy, identity, redaction, data-ownership, merge-integrity and quarantine modules;
- invariant-oriented tests for merge order independence, deterministic gates, reproducible factories, collision-resistant namespaces, ownership-limited cleanup and redaction idempotence;
- focused seeded-defect oracles proving that always-pass gates, incomplete merge acceptance, empty changed-area selection, quarantine bypass and identity redaction are detected;
- frozen pre-release contracts for all eight package boundaries, action inputs/outputs, CLI entrypoint, result schema and PR-report schemas 1/2/3;
- deep inspection of all eight `npm pack` tarballs, including file allowlists, export/bin target existence, local-protocol rejection, private-source import rejection and credential-canary scans;
- installation and compilation of those exact tarballs in clean npm and pnpm consumer directories;
- a 50-scenario adversarial evidence ledger at [hardening-requirements.json](hardening-requirements.json).

This section records implementation, not hosted acceptance. P10-06 remains `NOT_RUN` until the new `hardening` lane and the expanded aggregate gate pass at the exact source revision. The ledger distinguishes prior hosted `PASS` evidence from new `IMPLEMENTED` checks awaiting that run.

## Explicit remaining boundaries

No immutable public action release tag, controlled major alias, standalone action-distribution release or external consumer against a released action is claimed. Source-level `uses: ./` acceptance is not substituted for released-action acceptance.

No GitHub Marketplace listing or Marketplace account-owner terms acceptance is claimed.

LedgerGuard has genuine API-first hosted acceptance but still has no browser product interface, and no mock or copied application is substituted for browser coverage.

Comparable distributed benchmarks, versioned documentation deployment, npm publication, immutable action-tag consumption, partial-publication recovery, and final release audit remain unverified or unreleased. The new 90/85 coverage and package-hardening gates remain an implementation candidate until exact-source hosted acceptance is recorded. Source-candidate tarballs are not registry publications.

See [requirements.json](requirements.json) for the broader product matrix, [history-reliability-requirements.json](history-reliability-requirements.json) for Phase 7, [hardening-requirements.json](hardening-requirements.json) for Phase 10, and [defects.md](defects.md) for repaired defects and regression evidence.
