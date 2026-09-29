# Execution-stage benchmark profiling

Profiling is enabled by the TeamBoard benchmark configuration for actual Deadpan runs, not discovery or the native-versus-Deadpan reporter-overhead experiment. The canonical reporter implementation is unchanged in `packages/playwright/src/base-reporter.ts`; its optional subclass observes the public reporter callbacks. Native Playwright still owns scheduling, workers, webServer readiness, and teardown.

## What each measurement means

| Field | Observed interval |
| --- | --- |
| `applicationReadiness` | Immediately before spawning TeamBoard until the wrapper observes an HTTP 200 from its real `/ready` endpoint. |
| `testWindow` | First `onTestBegin` to last `onTestEnd`, including intervening scheduling and fixture work. |
| `forgeqaFinalization` | The existing Deadpan `onEnd` call, including awaiting its journal queue and writing canonical evidence. |
| `allReportersFinalization` | Start of Deadpan `onEnd` to its `onExit`, after every reporter's `onEnd`, including native blob output. |
| `applicationShutdown` | Wrapper receipt of the native shutdown signal to observed application process closure. |
| `attemptWorkMs` | Sum of native attempt durations. Parallel work, not elapsed latency. |
| `observedPhaseUnionMs` | Union of the observed intervals on one host clock. Nested and overlapping spans count once. |
| `unattributedCliMs` | Enclosing measured CLI duration minus that union. Includes configuration, launch, worker shutdown, gaps, and instrumentation not covered by the named spans. |

The readiness wrapper's bounded independent probe may observe readiness later than Playwright's probe. It does not replace native readiness or modify application behavior. Test-window duration is not isolated application CPU time. `allReportersFinalization` contains `forgeqaFinalization`; do not add them. Application teardown may precede reporter finalization. Per-stage medians are not an additive partition of the median run. Instrumentation overhead is present equally in compared profiled conditions and is not assumed to be zero.

Existing workflow setup/install/build/browser-install intervals remain in `setupMs` and related aggregate fields; explicit merge stays in `mergeMs`. The controlled run measures CLI plus explicit merge, not full workflow latency or billed capacity. Queueing, checkout and service lifecycle exclusions in the original benchmark protocol still apply.

## Identity, completion and failure

Each run/shard creates a private, exclusive `timing/context.json`, with schema version 1, source SHA, run identity, shard dimensions, a random clock identity and a host-local monotonic origin. Application and reporter writers create incomplete files before observation and atomically replace their own files. No credentials, test names or logs are added to timing records.

Acceptance requires both complete records, all five spans, matching source/run/shard/clock, finite bounded durations, actual attempt counts, correct nesting and containment inside the measured CLI envelope. A missing record, interrupted application, failed reporter, forced shutdown, duplicate writer, future schema or conflicting derived value fails timing acceptance. Missing measurements are never replaced by zeros. These are process-crash boundaries, not power-loss or hostile same-OS-user guarantees.

The profiling benchmark requires nonempty shards and clean first attempts. This is narrower than Deadpan's general support for manifest-proven empty shards. Profiling errors cannot make an application failure green; an otherwise passing benchmark with incomplete required timing fails instead.

## Retained evidence and reproduction

Controlled receipts retain raw records and derived values for each warm-up and measurement. `records.json`, `summary.json` and `observations.csv` include timing. `node benchmarks/verify-controlled-timing.mjs` independently recomputes the summary from receipts and checks every retained zero-leak cleanup receipt. The controlled workflow runs five repetitions on one runner by default.

Distributed shard metadata includes the same versioned profile. `record-run.mjs` binds every profile to the immutable expected inventory. `summarize.mjs` revalidates raw spans and derived fields, checks aggregate/max CLI durations, and writes `lifecycle.csv` alongside raw JSON, CSV, Markdown and checksums.

```sh
npm run build
node --test tests/execution-timing.test.mjs tests/benchmark-profiling.test.mjs tests/benchmark-profile-server.test.mjs
```

The process-wrapper tests use explicitly synthetic local HTTP servers to exercise infrastructure failure paths. Actual benchmark acceptance still runs TeamBoard against PostgreSQL and all three browsers. Linux/macOS exercise the POSIX wrapper; portable record/validation tests run in the normal Linux/macOS/Windows matrix.

## Comparison and delivery boundaries

Different host clocks are never subtracted or combined into one lifecycle timeline. Distributed summaries report per-shard observations, not a sum of stage maxima pretending to be the critical path. Existing exact hardware/software/inventory comparability guards remain mandatory. Successful timing acceptance cannot turn `NOT_COMPARABLE` into a speedup claim, nor does it authorize npm publication or stable promotion.

The [timing requirement ledger](../delivery/timing-profiling-requirements.json) supplements the broader benchmark ledger. The newer [crash-recovery ledger](../delivery/crash-recovery-requirements.json) accepts same-host recovery with a surviving journal; older broader records must still retain the unaccepted lost-runner/cross-host boundaries.
