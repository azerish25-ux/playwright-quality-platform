# Delivery checkpoint — Phase 10A hosted hardening accepted

**ForgeQA now has exact-source hosted acceptance for the source-distributed GitHub platform, both real consumer integrations, and the Phase 10A release-blocking hardening baseline. The complete public release is not yet delivered.**

The accepted Phase 10A source revision is `75b30f421514c18416a687725caf2c6a0ab6367a`, merged through PR #11. Main-branch CI run `36350020241` completed successfully on September 27, 2026. Its aggregate `forgeqa-quality` job `108707814220` passed only after all required cross-platform, consumer, TeamBoard, LedgerGuard, hardening and action lanes succeeded.

## Verified platform behavior

- Real config-driven Playwright discovery and execution, typed composable fixtures, strict native and CLI gates, journal/finalization integrity, and canonical JSON/JUnit/Markdown/HTML output.
- Native distributed Playwright execution with immutable expected inventories, real shard dimensions and stable execution identities.
- Strict evidence validation for finalized journals, completion markers, checksums, attachments and Playwright blob reports before merge.
- Exact reconciliation between native Playwright counts/outcomes/projects and canonical ForgeQA results.
- PostgreSQL-backed TeamBoard with eight API cases and four UI journeys across Chromium, Firefox and WebKit, including workspace and isolated npm/pnpm consumers.
- Genuine API-first LedgerGuard adoption against pinned P07A source with authentication, authorization, ownership, transfer, payment, adjustment, scheduling, reconciliation and infrastructure-cleanup coverage.
- Immutable historical records, bounded GitHub artifact import, comparable cohorts, precise retry metrics, repeat diagnostics, accountable quarantine mutation and centralized history-aware gates.
- A callable Node 24 GitHub Action, distributed reusable workflow, aggregate check and fork-safe trusted PR publisher.
- Release-blocking property/invariant, seeded-defect, compatibility, coverage and exact-tarball adoption gates.

## GitHub platform and PR reporting

The GitHub platform milestone remains accepted:

- `action.yml` contains a tracked callable Node 24 distribution.
- Action inputs and all workspace-relative paths are validated and confined to `GITHUB_WORKSPACE`.
- Application and test children do not inherit GitHub, Actions or registry write credentials.
- Plan, bounded local-shard, distributed-shard and strict merge modes preserve nonzero quality, configuration, integrity and interruption outcomes.
- The reusable workflow creates one immutable manifest, expands a `fail-fast: false` shard matrix, uploads complete evidence and exposes a stable aggregate job.
- The trusted `workflow_run` publisher executes default-branch source only, validates run-bound data artifacts and GitHub job conclusions, rejects stale or changed-workflow results, and updates one bot-owned PR comment idempotently.

Hosted PR reporting creation and update-in-place acceptance is recorded in [pr-reporting-live-acceptance.md](pr-reporting-live-acceptance.md). Detailed M4 status remains in [github-platform-requirements.json](github-platform-requirements.json); release-specific public-distribution requirements remain later work.

## Phase 9 LedgerGuard acceptance

LedgerGuard hosted acceptance first passed at ForgeQA revision `4ed8584ec0a04e14283109ad5e7f1fa7a4053077` in CI run `36346441131`. The Phase 10 exact main run repeated and passed the LedgerGuard lane at job `108706773286`; retained artifact `10942595299` has digest `sha256:90cf1c8643fc1a1e7c471cf622d977c2572f2ad5f945d090afbd63452200ca41`.

M5-08 is `PASS`. LedgerGuard still has no genuine browser product interface, so M5-09 remains `BLOCKED`; no copied or fabricated UI is substituted. See [ledgerguard-consumer-requirements.json](ledgerguard-consumer-requirements.json) and [../ledgerguard-consumer.md](../ledgerguard-consumer.md).

## Phase 10A hosted hardening acceptance passed

Hardening job `108706773253` completed successfully at the exact accepted source revision. It produced retained artifact `10941996762`, named `hardening-evidence-75b30f421514c18416a687725caf2c6a0ab6367a`, with digest `sha256:f32085587534f8dc5fe344426f2232c46e54ff3878aa957165285421d7c260e3`.

Observed results:

- 23 hardening tests passed.
- Line coverage: 98.63% against a 90% threshold.
- Branch coverage: 96.74% against an 85% threshold.
- Function coverage: 98.77% against an 85% threshold.
- All eight public packages were packed and deeply inspected.
- The exact tarballs were installed, imported, strictly type-checked and executed in clean npm and pnpm consumers.
- Pre-release package, CLI, action, result and PR-report contracts were frozen and checked.
- PR-report schemas 1 and 2 remain accepted while schema 3 adds the required hardening lane.
- Deterministic merge, gate, data, namespace, cleanup, redaction, selection and quarantine invariants passed.
- Seeded defects in gate policy, merge completeness, selection fallback, quarantine validation and redaction were detected.

The hardening gate exposed and repaired four root causes before acceptance: order-dependent gate diagnostics, incomplete clean-consumer type context, pnpm nested dependency resolution outside the staged candidate set, and CLI execution suppression through package-manager symlinks. These repairs are D-012 through D-015 in [defects.md](defects.md).

The authoritative exact evidence is [hardening-live-acceptance.md](hardening-live-acceptance.md). P10-01 through P10-06 are `PASS` in [hardening-requirements.json](hardening-requirements.json), which also preserves the individual status of all 50 adversarial scenarios.

## Retained exact-source evidence

The Phase 10 main run retained eight artifacts, including:

- hardening evidence `10941996762`, digest `sha256:f32085587534f8dc5fe344426f2232c46e54ff3878aa957165285421d7c260e3`;
- TeamBoard evidence `10942131460`, digest `sha256:5991076c1a36bd2b98dc6f98c879eddccc9584cc3cadf52b93d220fcb30e6c5b`;
- LedgerGuard evidence `10942595299`, digest `sha256:90cf1c8643fc1a1e7c471cf622d977c2572f2ad5f945d090afbd63452200ca41`;
- exact-source package candidate `10941104781`, digest `sha256:321f4c2d06aa9afea90ddeae98133b97d13ce5f908330373752e654143d23429`.

## Explicit remaining boundaries

No npm registry publication, immutable public action tag, controlled major alias, standalone action-distribution release, Marketplace listing, or external consumer against released public artifacts is claimed.

No live versioned documentation website or comparable measured serial/parallel/distributed benchmark result is claimed. Source-level action acceptance and source-candidate tarballs are not substituted for public release acceptance.

LedgerGuard has genuine API-first hosted acceptance but still lacks a browser product interface. Several adversarial scenarios remain explicitly `PARTIAL` or `NOT_RUN` where they depend on later fixture, benchmark or release phases.

The next sequence is Phase 11 reproducible benchmarks and versioned documentation, followed by Phase 12 coordinated npm/action/docs release and Phase 13 final delivery audit.
