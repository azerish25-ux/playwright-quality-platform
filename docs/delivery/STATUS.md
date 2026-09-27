# Delivery checkpoint — historical reliability and governed quarantine

**ForgeQA now has executable distributed evidence integrity plus an exact-SHA-verified local history, reliability, diagnostic-repeat and quarantine foundation; the complete ForgeQA product is not released.**

The Phase 7 implementation checkpoint is `907eaa39c6dfc0252436c464728e23269d8e127c`. [CI run 36308672914](https://github.com/azerish25-ux/playwright-quality-platform/actions/runs/36308672914) completed successfully for that exact SHA on September 27, 2026. It passed the six Linux/macOS/Windows Node 22/24 verification jobs, all three independent packed-consumer jobs, the PostgreSQL TeamBoard Chromium/Firefox/WebKit and packed-consumer lane, and the aggregate `forgeqa-quality` gate. Treat these statements as a dated checkpoint, not a perpetual green badge.

The prerequisite distributed-evidence hardening was reconciled with `main` in `7ffaca4cc3daff7534f94ea67376462be15876b3`, verified by [CI run 36307845271](https://github.com/azerish25-ux/playwright-quality-platform/actions/runs/36307845271), and merged through pull request #2 as `f5aa2b9d398761c49c3048e4cb1c5349dd3b8b28`.

## Implemented distributed-evidence behavior

- Immutable planning and genuine native Playwright shard execution with strict expected-inventory reconciliation.
- One finalized ForgeQA journal and one Playwright blob report per shard.
- Fail-closed validation of run/shard identity, completion markers, journal checksums, captured artifact paths, regular-file ownership, size and SHA-256.
- Collision-safe copying of screenshots, traces, videos, logs and attachments into shard-namespaced merged output.
- Playwright `merge-reports` generation of native HTML and JSON evidence.
- Exact native/canonical reconciliation by file, title, project, retry index and outcome; matching totals alone are insufficient.
- Canonical JSON, JUnit, Markdown and static HTML reports, artifact manifest and checksummed completion record.
- Loopback-only local report serving with traversal, symlink, method, MIME, cache and browser-hardening controls.
- Real two-shard Chromium diagnostic acceptance retaining screenshot and trace bytes while retry-recovered failure remains a strict nonzero quality result.
- PostgreSQL-backed TeamBoard API and Chromium/Firefox/WebKit UI journeys, including deterministic account transitions and owned-data cleanup.

## Implemented Phase 7 behavior

- Immutable, checksummed per-run history records under a manifest-controlled local store.
- Atomic imports with a store lock, bounded JSON reads, safe paths and bounded retention.
- Idempotent identical imports and fail-closed rejection of conflicting duplicate identities.
- Separate `trusted-default-branch`, `untrusted-pr`, `synthetic` and `diagnostic` provenance classes.
- Comparable cohorts constrained by schema, repository, configuration and project/browser/environment dimensions.
- Default 30-day, 50-run history window with an explicit 20-execution minimum-sample state.
- Aggregate and per-test `N`, `F`, `I`, `P`, retry-recovery, observation-window, failed-attempt-cost, owner and browser/environment metrics.
- Explicit `NO_BASELINE`, `INSUFFICIENT_HISTORY` and `HISTORY_INCOMPLETE` states instead of invented zero rates.
- Distributed report merging now emits `history-record.json` and includes its checksum in `complete.json`.
- Executable `forgeqa history import` and history-aware `forgeqa flakes` commands.
- Bounded diagnostic `forgeqa repeat` with isolated iterations, zero native retries, first-failure preservation, time/count/failure budgets and diagnostic provenance.
- Atomic `quarantine add`, `quarantine validate` and `quarantine remove` with exact stable IDs, ownership, issue, reason, dates and optional exact project scope.
- Quarantine remains metadata only: selected tests continue to run and failing outcomes remain blocking.
- Adversarial tests cover duplicate idempotency, conflicting duplicates, concurrent imports, checksum tampering, provenance separation and the quarantine add/remove lifecycle.

The detailed milestone matrices are [distributed-evidence-requirements.json](distributed-evidence-requirements.json) and [history-reliability-requirements.json](history-reliability-requirements.json).

## Failure semantics

- Exit `0`: complete, internally consistent and policy-compliant evidence.
- Exit `1`: complete evidence with an application, quality-policy or quarantine-policy failure.
- Exit `2`: invalid usage or configuration.
- Exit `3`: missing, corrupt, tampered, incomplete or contradictory evidence/history.
- Exit `130`: interrupted execution.

## Explicit remaining boundaries

- The GitHub Actions artifact pagination/download history adapter is not yet implemented; current history import consumes local downloaded report evidence.
- Diagnostic repetition currently repeats a validated suite selection rather than selecting one exact stable test ID.
- Historical reliability output is available through JSON/CLI analysis but is not yet rendered in every HTML and JUnit surface.
- The standalone GitHub Action distribution is not yet published or verified through an immutable external tag.
- LedgerGuard is not yet a functioning second consumer of released ForgeQA packages.
- npm packages are source candidates, not registry releases; npm ownership and publication authorization are not assumed.
- The versioned documentation website, maintained 90/85 runtime coverage gates, comparative distributed benchmarks and complete release hardening remain unverified.
- No Marketplace listing, npm publication or production-ready status is claimed.
