# Executable CLI contract

`forgeqa init --template demo --destination DIR --package-manager npm|pnpm` generates a runnable HTTP onboarding harness, native Playwright configuration, typed fixtures, browser/API tests, package metadata, strict CI and privacy defaults. It does not install dependencies. `--template existing` generates a proposed integration, without pretending to infer application authentication or data semantics. All conflicts are checked before writing; a conflict changes no files. Dry-run creates nothing. Symlink ancestors and destinations are refused.

`forgeqa doctor` validates the configuration, runtime, installed runner/reporter, selected browser executable paths and writable output. It does not certify arbitrary application adapters or remote environment health.

`forgeqa plan --suite smoke|regression|release --json` loads the trusted configuration, invokes public native discovery, and materializes actual execution identities. Regression includes smoke; release includes both. Unknown flags, empty selections and duplicate explicit IDs fail. JSON stdout contains one value.

`forgeqa run` repeats the same validated discovery before execution, compares the live inventory with the immutable pre-run manifest, invokes the consumer's installed Playwright runner using argument arrays, writes normalized report outputs, verifies journal/report checksums and requires a finalization marker. The raw runner and policy both contribute to the result. Missing reporting never converts a failure into success. Output paths and all violations are included in machine-readable mode.

Supported overrides include `--config`, `--playwright-config`, `--environment`, `--suite`, `--workers`, `--browsers`, `--retries` and `--output`. Distributed shards are explicitly unavailable in this milestone; `--shard` values other than `1/1` fail with an actionable configuration error.

Exit codes: 0 compliant success; 1 quality/test failure; 2 invalid configuration/usage; 3 infrastructure/report-integrity failure; 130 interruption. The former generic `--native-command` escape hatch is removed: successful arbitrary commands are not test evidence.

Other existing command families remain documented as fail-closed incomplete functionality, not working features merely because help lists them. `gate`, `flakes`, `quarantine validate`, and strict raw shard `report merge` utilities remain available.
