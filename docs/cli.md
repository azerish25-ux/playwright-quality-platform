# Executable CLI contract

`forgeqa init --template demo --destination DIR --package-manager npm|pnpm` generates a runnable HTTP onboarding harness, native Playwright configuration, typed fixtures, browser/API tests, package metadata, strict CI and privacy defaults. It does not install dependencies. `--template existing` generates a proposed integration without pretending to infer application authentication or data semantics. All conflicts are checked before writing; a conflict changes no files. Dry-run creates nothing. Symlink ancestors and destinations are refused.

`forgeqa doctor` validates configuration, runtime, installed runner/reporter, selected browser executable paths and writable output. It does not certify arbitrary application adapters or remote environment health.

`forgeqa plan --suite smoke|regression|release --json` loads trusted configuration, invokes native discovery and materializes actual execution identities. Regression includes smoke; release includes both. Unknown flags, empty selections and duplicate explicit IDs fail.

`forgeqa run` repeats validated discovery before execution, compares live inventory with the immutable pre-run manifest, invokes the consumer's installed Playwright runner using argument arrays, writes normalized report outputs, verifies journal/report checksums and requires a finalization marker. Raw runner and centralized policy outcomes both contribute to the result.

`forgeqa repeat [COUNT] [MAX_FAILURES] [TIME_BUDGET_MS]` performs bounded diagnostic repetitions of the selected local suite. Each repetition receives an isolated output root and zero native retries, so a first failure cannot be hidden by retry recovery. It stops on the requested count, time budget, maximum failures, interruption or infrastructure failure. `repeat-summary.json` preserves every iteration and the first failure; generated history records are marked `diagnostic` and excluded from authoritative baselines.

`forgeqa report merge` verifies every shard journal and captured file, merges native Playwright blobs, reconciles exact native/canonical identities and emits JSON, JUnit, Markdown, HTML, artifact manifest, completion marker and immutable history record. `forgeqa report serve` serves a completed report on loopback only.

`forgeqa history import` atomically imports one or more report files/directories into an immutable local store. Identical duplicates are no-ops; conflicting duplicates fail with exit 3. `forgeqa flakes --report FILE --output HISTORY_DIR` computes bounded comparable history, aggregate metrics, per-test metrics and prior-run comparison.

`forgeqa quarantine add`, `validate` and `remove` implement the explicit metadata lifecycle. Add/validate require either `--report FILE` or `--known-tests ID1,ID2` so unknown tests cannot be silently accepted. Quarantine never removes a test from selection or makes its failure non-blocking.

Supported run-selection overrides include `--config`, `--playwright-config`, `--environment`, `--suite`, `--workers`, `--browsers`, `--retries`, `--shard`, `--manifest` and `--output`.

Exit codes: 0 compliant success; 1 quality/test/policy failure; 2 invalid configuration or usage; 3 infrastructure/report-integrity failure; 130 interruption.

## GitHub-backed history import

`forgeqa history import-github --repository OWNER/REPO --workflow ci.yml --artifact-name forgeqa-merged- --max-runs 50 --output .forgeqa/history` paginates completed workflow runs and artifacts. It imports successful and failed eligible runs, records missing/expired artifacts as coverage gaps, and keeps pull-request observations untrusted. Tokens are read from `FORGEQA_GITHUB_TOKEN`, `GITHUB_TOKEN`, `GH_TOKEN`, or the environment variable named by `--token-env`; a token value is never accepted on the command line.

`forgeqa repeat --test-id STABLE_ID [COUNT] [MAX_FAILURES] [TIME_BUDGET_MS]` resolves the stable ID to one exact source declaration. Unknown, ambiguous, locationless, manifest-backed, or distributed targets fail closed.

`forgeqa flakes --report FILE --history HISTORY_DIR --render DIR` emits JSON analysis and history-aware HTML, JUnit, and Markdown. `forgeqa report merge ... --history HISTORY_DIR` embeds the same bounded analysis in distributed reports.

## Guarded resource recovery

`forgeqa recovery --root DIR [--dry-run|--apply] [--adapter-module FILE] [--consumer NAME] [--namespace NAME] [--max-owners N] [--timeout-ms N] [--budget-ms N] [--json]` reclaims only verified abandoned ownership. Dry-run is the default; filters are exact, never deletion prefixes. It preserves active owners, refuses unknown adapters and unsafe metadata, and returns exit 3 when recovery is incomplete. See [the recovery guide](guide/recovery.md) for the same-host/PID-namespace boundary, private journal storage, trusted module contract and process-crash tests.
