# Deadpan defect and verification ledger

All entries distinguish an implementation repair from the later exact-SHA CI proof. No retry count, required browser, expected inventory or strict gate was relaxed.

| ID | Severity and reproduction | Root cause and repair | Regression evidence |
|---|---|---|---|
| D-001 | Blocking: packed consumer fails resolving import-only package exports. | CommonJS `require.resolve` selected the wrong export condition. A copied consumer-local ESM probe imports all eight public packages and resolves the declared CLI executable; realpath checks reject provider escapes. | `tests/consumer-resolution.test.mjs`; `tests/consumers/public-exports.mjs`; both isolated package-manager modes. |
| D-002 | Blocking on macOS: initialization rejects the system `/var` parent alias. | Canonicalize parent aliases before establishing the destination boundary. Still refuse a symlink destination, generated descendant symlinks and dangling parents. Dry-run remains nonmutating. | `tests/cli.test.mjs`: Unicode nested alias, dry-run, repeat initialization, destination and dangling-parent rejection. Real macOS jobs passed. |
| D-003 | Blocking: checkbox click is reverted and Playwright reports no state change. | Controlled React state updated only after an asynchronous server response. A synchronous optimistic update acknowledges the event, disables concurrent interaction, rolls back on failure and preserves workspace identity. | Real UI check/uncheck/check, independent persisted flag polling and page reload in three browsers. |
| D-004 | Blocking: task-status selector cannot target the intended field reliably. | Label text included nested option text. Use an explicit `htmlFor`/`id` association and an exact label locator. | Editor UI journey asserts both visible title and persisted status via the real API. |
| D-005 | Blocking in WebKit: CSV is rendered instead of downloaded. | The navigation had no explicit download intent. Set same-origin `download` attributes in addition to server attachment headers. | All three browsers assert download filename, real CSV bytes and retained application page; attachment bytes are independently checked. |
| D-006 | Security: old pnpm installer version is covered by published advisories. | Pin 10.34.5 in both workspace and generated templates; use real runner-generated lockfiles and an enforced audit. No registry integrity hash was invented. | Read-only candidate workflow, `dependency-audit.json`, template consistency test and frozen-lock consumer installs. |
| D-007 | Security: generated disposable test-control credentials were not registered for log masking. | Register all generated role passwords and the test-control token before later environment-file use. Application children do not receive publishing/GitHub write credentials. | `scripts/prepare-teamboard-db.mjs`; restricted runtime database privilege checks in hosted CI. |
| D-008 | Blocking PR reporting: real `pull_request` workflow runs in this repository return an empty `workflow_run.pull_requests` collection, so a publisher that indexes element zero silently skips every report. | Bind artifacts only to run ID/attempt, validate the trusted run first, then resolve the PR through the originating source commit plus head repository/branch. Current-head and newer-run checks remain mandatory before comment mutation. | `tests/github-pr-reporting.test.mjs` empty-reference/full-publisher cases; `tests/github-workflow.test.mjs`; observed run `36319982582`. |
| D-009 | Security: a PR-controlled edit to `.github/workflows/ci.yml` could otherwise manufacture a plausible artifact and matching job names for the privileged completion workflow. | Authorize artifact download from trusted default-branch code only after checking the PR file list; refuse clean publication whenever the originating CI workflow is changed. Independently cross-check report claims against exact-attempt GitHub job conclusions. | `tests/github-pr-reporting.test.mjs` changed-workflow and report/job contradiction cases; `.github/workflows/forgeqa-pr-report.yml`. |
| D-010 | Blocking hosted publication: publisher run `36323734608` validated and downloaded its report but GitHub rejected `POST /issues/7/comments` with `Resource not accessible by integration`. | The workflow declared `issues: write` but only `pull-requests: read`. Grant the trusted completion workflow explicit `pull-requests: write` while retaining read-only Actions/content access and never executing PR-controlled code. | `tests/github-workflow.test.mjs` permission invariant; hosted rerun required to prove comment creation. |
| D-011 | Intermittent blocking failure on Windows Node 22: post-merge CI run `36328600603` observed `identity.js` import `sha256` while the concurrently discovered `stable.js` module did not expose that export, even though the built source contract does. | Node's test runner was allowed to execute the two integration files concurrently while both launched Playwright discovery against the same generated workspace package graph. Serialize integration files with `--test-concurrency=1`; keep all integration cases, browsers, shards, assertions and strict gates unchanged. | `tests/integration-isolation.test.mjs`; `tests/integration/distributed-runner.test.mjs`; Windows Node 22/24 verification matrix. |
| D-012 | Integrity: canonical shard merge output changes with shard arrival order when attempts share the same timestamp and retry index. | The comparator stopped after `startedAt` and `retry`, so JavaScript's stable sort preserved the untrusted input shard order for ties. Add execution-identity and attempt-identity tie-breakers so equivalent evidence always yields one canonical ordering. | `tests/hardening/merge-ordering.test.mjs`: all permutations of four tied attempts produce byte-identical merged output. |
| D-013 | Phase 11 benchmark integrity: serial and local-parallel runs produced finalized journals and native blob reports but no `shard-complete.json`, so the strict evidence merger could not validate one-shard runs through the same path used for distributed conditions. | The native reporter emitted the completion marker only when `shardTotal > 1`. Emit the run-bound marker for every finalized shard, including `1/1`, and expose the finalized report path in the single-run CLI result without weakening local report checks. | `tests/integration/native-runner.test.mjs` verifies the one-shard marker, CLI evidence path, and strict native/canonical merge reconciliation; `tests/evidence.test.mjs` retains strict one-shard evidence validation; the Phase 11 workflow merges all five conditions through `report merge`. |

## Phase 11 benchmark repairs

| ID | Severity and reproduction | Root cause and repair | Regression evidence |
|---|---|---|---|
| B-001 | Blocking: the initial Phase 11 source did not compile. | The runner referenced `executionDi6` instead of `executionDir`. Restore the verified identifier and remove the completed temporary repair workflow. | Exact-source TypeScript and integration CI. |
| B-002 | Blocking on Windows: benchmark workflow structure assertion failed despite unchanged workflow semantics. | The assertion assumed LF line endings. Normalize CRLF before checking; separately prove LF and CRLF both retain the required `always()` guard. | `tests/benchmark-contract.test.mjs`; `tests/benchmark-measurement.test.mjs`. |
| B-003 | Integrity: a global matrix barrier could appear to be execution time; failed cohorts could receive ratios. | Separate queue-inclusive observations from max measured shard duration plus merge; suppress ratios for any failed cohort and validate timestamp arithmetic. | `tests/benchmark-measurement.test.mjs` queued-VM, forged-duration and failed-cohort cases. |
| B-004 | Blocking: Firefox role-transition warm-up failed in run `36439279027`. | Navigation raced completion of the logout request and login-form rendering. Await successful logout response and visible sign-in form before navigation; retain every browser and assertion. | `logoutPage` fixture; `tests/benchmark-lifecycle.test.mjs`; repeated real TeamBoard UI execution. |
| B-005 | Integrity: five-repetition run `36442326322` completed all test executions but mixed Linux memory readings and CPU models. | Earlier protocol hashing conflated software identity with hardware comparability. Measurement v3 keeps software/policy equality strict and records exact, unrounded hardware fingerprints separately. Even a one-byte memory difference blocks performance eligibility and ratios, while complete valid observations remain retainable. Previous failed runs remain failed evidence. | `tests/benchmark-lifecycle.test.mjs`; `tests/benchmark-measurement.test.mjs`; exact-source five-repetition acceptance and machine-readable `NOT_COMPARABLE` boundary. |

## Documentation acceptance repairs

| ID | Severity and reproduction | Root cause and repair | Regression evidence |
|---|---|---|---|
| DOC-001 | Blocking: documentation run `36467309806` passed installation, snippets, build and 3,543 local references, then found no search results in Chromium. | The acceptance driver used `fill`, while the pinned MkDocs search implementation registers a `keyup` handler. Exercise actual keyboard events with `pressSequentially`, retain the nonempty-result assertion, and open the matching Quarantine page. Capture failure diagnostics without masking the originating error. No timeout, retry or quality gate is relaxed. | `tests/docs-contract.test.mjs`; `scripts/docs/browser-check.mjs`; exact-source hosted rerun required. |

## Coordinated release repairs

| ID | Severity and reproduction | Root cause and repair | Regression evidence |
|---|---|---|---|
| REL-001 | Blocking: rewriting package metadata to a new release version leaves the CLI and generated dependencies at 0.1.0. | Compiled constants ignored the installed manifest. Read the owned CLI package metadata and use that version for CLI output and both generated templates. | `tests/release-preparation.test.mjs`; independent installed-tarball and registry consumers check all eight versions. |
| REL-002 | Integrity: modifying ignored build output after hardening can leave Git clean while changing release contents. | Git cleanliness alone does not bind build bytes. Repack source packages, match the exact hardening digests and stage only from those verified archives before version preparation. | `tests/release-preparation.test.mjs` altered-byte/size refusal; exact-source prepared artifact workflow. |
| REL-003 | Integrity: a prepared set could be mistaken for an installed or published release. | Separate immutable prepared manifests, exact version/source/checksum consumer receipts, isolated registry evidence and mutable public publication checkpoints. Public execution requires explicit workflow/OIDC/scope confirmation. | `tests/release-preparation.test.mjs`; real npm interruption/lost-acknowledgement/conflict regressions in `tests/release-registry.test.mjs`. |

## Scope still requiring verification

This ledger does not certify production suitability, registry publication, immutable public action distribution, deployed documentation, comparable release benchmarks. Missing, failed, or cancelled hosted jobs remain blocking in the aggregate check. Review the exact delivered commit rather than relying on a previous green run.

## Captured standard-stream integrity

The real browser-consumer artifact at `b65257f` exposed two captured stdout/stderr
logs with sizes but no SHA-256 fields. Other attachments, including all 30 genuine
screenshots, carried verified hashes. The native reporter now hashes the exact
redacted bytes written to its standard-stream attachment. A real native-runner
regression verifies Unicode byte length, stdout/stderr content and the recorded
SHA-256. The original artifact remains an honest record of the missing metadata;
no checksum is retroactively invented for it.

The repair was subsequently exercised by the real prepared-registry consumers at
`3200c4aac488b7a426839d128b19a0224f7a8bea`: every captured attachment in all four
consumer reports had a matching size and SHA-256, including captured standard
streams. See `real-registry-consumer-acceptance.json`.
