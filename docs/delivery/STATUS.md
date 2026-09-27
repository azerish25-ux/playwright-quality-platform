# Delivery checkpoint — Phase 7 historical reliability

**The Phase 7 historical-reliability milestone is implemented and verified at an exact source revision; the complete ForgeQA product is not released.**

The recorded source checkpoint is `09bca4d1bed24081466d56de9a27faeae1968027`. [CI run 36315295764](https://github.com/azerish25-ux/playwright-quality-platform/actions/runs/36315295764) is the exact-source pull-request verification for the code described below. Statuses describe observations at that checkpoint; subsequent changes require their own exact-SHA checks.

## Verified platform behavior

- Real config-driven Playwright discovery and execution, typed composable fixtures, strict native and CLI gates, journal/finalization integrity, and canonical JSON/JUnit/Markdown/HTML output.
- Native distributed Playwright execution with immutable expected inventories, real shard dimensions and stable execution identities.
- Strict distributed evidence validation: finalized journals, completion markers, checksums, captured attachments and Playwright blob reports are validated before merge.
- Native blob reports merge through Playwright's supported command, and native counts/outcomes/projects are reconciled exactly with canonical ForgeQA results before publication.
- PostgreSQL-backed TeamBoard executes eight API cases and four UI journeys in Chromium, Firefox and WebKit, including workspace and independent npm/pnpm package consumers.
- The exact checkpoint passed all six Linux/macOS/Windows Node 22/24 verification jobs, all three independent consumer jobs, the PostgreSQL/three-browser TeamBoard job and the aggregate gate.

## Historical reliability delivered

- Immutable, versioned, checksum-verified local history records are written atomically and retain trusted-default-branch, untrusted-PR, synthetic and diagnostic provenance.
- `forgeqa history import` can rebuild bounded history from paginated completed GitHub Actions runs and artifacts. Failed workflow runs remain eligible; deleted, expired, inaccessible or malformed artifacts become explicit coverage gaps rather than invented zero flake rates.
- Artifact ZIP ingestion rejects traversal, absolute paths, symbolic links, unsupported compression, CRC mismatch, oversized archives, excessive entry counts and conflicting duplicate run identities.
- Merged distributed reports publish a portable `history-record.json`, and the completion record covers its checksum.
- Comparable cohorts require compatible repository, consumer, suite, environment, browser/project, selection, configuration, schema and framework dimensions.
- Reliability outputs use the defined `N`, `F`, `I` and `P` populations, preserve numerator/denominator and observation-window information, and expose `NO_BASELINE`, `INSUFFICIENT_HISTORY` and `HISTORY_INCOMPLETE` states.
- `forgeqa repeat --test-id` resolves one stable logical test to one exact discovered source location and runs bounded diagnostic repetitions without contaminating authoritative history.
- Quarantine add/remove/validate remains explicit, owner-bound and expiry-bound; quarantined tests remain selected and their failures and retry recovery remain blocking under the default policy.
- Machine-readable history analysis, Markdown, JUnit and self-contained HTML expose the same comparison, sample, owner, quarantine and history-gap information.

The detailed M3 requirement ledger is [history-reliability-requirements.json](history-reliability-requirements.json). All twelve recorded entries pass at the checkpoint above.

## Explicit remaining boundaries

GitHub Action external distribution, aggregate publication as a reusable public action, fork-safe pull-request publication and actual action-release tests remain Phase 8 work.

LedgerGuard has an executable foundation, but the inspected revision lacks the required product-facing authentication/payment/UI integration. No fake second application is substituted.

The 90/85 runtime coverage thresholds, comparable distributed benchmarks, complete generic fixture lifecycle/property coverage, versioned documentation deployment, npm publication, standalone immutable Action release and Marketplace state remain unverified or unreleased. Source-candidate tarballs are not registry publications.

See [requirements.json](requirements.json) for the broader product matrix and [defects.md](defects.md) for repaired defects and regression evidence.
