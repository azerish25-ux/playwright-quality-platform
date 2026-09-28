# ForgeQA benchmarks

ForgeQA benchmarks are evidence-producing acceptance workflows, not marketing fixtures. The authoritative end-to-end benchmark runs the real PostgreSQL-backed TeamBoard inventory under five execution conditions while keeping source revision, test inventory, browser projects, retry policy, artifact policy, package versions, and application behavior fixed.

## Comparable conditions

| ID | Shards | Workers per shard | Runner topology |
|---|---:|---:|---|
| `serial-1x1` | 1 | 1 | one GitHub runner |
| `local-2x1` | 1 | 2 | one GitHub runner |
| `local-4x1` | 1 | 4 | one GitHub runner |
| `distributed-2x1` | 2 | 1 | two independent GitHub runners |
| `distributed-4x1` | 4 | 1 | four independent GitHub runners |

One immutable ForgeQA discovery inventory is created per condition. Each measured repetition receives a distinct run identity while retaining the same expected executions. Every distributed shard uploads finalized journal evidence and a Playwright blob report. The merge job refuses missing, duplicate, incompatible, corrupt, or inventory-divergent evidence.

## Running the benchmark

The hosted workflow is `.github/workflows/benchmark.yml`.

- Relevant main-branch pushes run a one-repetition acceptance smoke.
- Manual runs accept 1, 3, or 5 measured repetitions.
- Use five repetitions for release evidence.
- The monthly scheduled run uses one repetition as a bounded workflow and contract smoke test; it is not represented as release-quality performance evidence.
- Dependency caching is disabled so cache state is explicit and identical across conditions.
- Each shard verifies one unmeasured warm-up using a distinct run identity. Warm-up journals are retained separately and excluded from measured merges.

`npm run benchmark` previews the exact condition matrix without consuming hosted runners. `npm run benchmark:synthetic` runs the separately labelled deterministic-factory microbenchmark. Synthetic results are never presented as TeamBoard or browser-suite measurements.

## Retained evidence

For every condition and repetition the workflow retains:

- the immutable selection manifest and its execution-identity digest;
- per-shard setup, test, and total runner timings;
- runner operating system, CPU, memory, Node, Playwright, package-manager, and runner-image metadata;
- finalized ForgeQA journals and native Playwright blob evidence;
- merged canonical reports and gate outcome;
- a schema-versioned benchmark record.

The final summary artifact contains `raw.jsonl`, `raw.csv`, `summary.json`, `summary.md`, and `SHA256SUMS`. It reports median, range, interquartile range, median absolute deviation, elapsed wall time, aggregate runner time, critical-path execution speedup, and parallel efficiency. Ratios never use shared matrix-barrier waiting and are suppressed for any failed cohort. Elapsed latency and consumed runner time remain separate.

## Integrity rules

A summary fails closed when:

- a condition or repetition is missing or duplicated;
- records do not share one exact source SHA;
- expected or observed execution inventories differ;
- a shard or merge exits nonzero;
- the merged report is incomplete or its quality gate fails;
- fewer records exist than the selected repetition count.

A smaller sample is allowed for workflow smoke testing but is labelled as a limitation. No speedup claim is accepted by the release process until five comparable repetitions complete successfully.

## Current boundary

The harness, workflow, schemas, statistics, and regression tests are implemented. No production benchmark result is claimed until the hosted workflow succeeds at the exact delivered source revision and the retained summary is reviewed and recorded in the delivery ledger.

## Measurement boundaries

Measurement version 3 compares `max(shard.runMs) + mergeMs`, not queue-inclusive workflow wall time. The observed `wallMs` and scheduling skew remain in raw records; shared job barriers can inflate them. Aggregate runner time covers instrumented intervals only, excluding checkout, service provisioning, final uploads and service shutdown. Application readiness, execution, in-process reporting and shutdown remain combined inside each shard run. Exact source and lock/config/runner-protocol digests must match. Source-mode benchmarks are not registry or packed-package performance evidence.

## Supplementary measurements and execution requests

The same workflow runs `reporter-overhead.mjs` against all 20 real TeamBoard executions with native JSON/blob reporters, then with the ForgeQA reporter added. One warm-up per mode is excluded; measured mode order alternates. Whole-process overhead can be negative for a small/noisy sample; no improvement is required. `synthetic/result-scaling.mjs` measures 1,000, 10,000 and 100,000 synthetic attempts in fresh processes, retaining merge/render durations, output sizes/checksums and peak RSS. These are not customer suites. A read-only database scan verifies zero owned test resources after execution.

Manual execution supports five repetitions. A trusted main-branch benchmark commit explicitly containing `[benchmark:5]` requests the same five-repetition acceptance run; other relevant pushes and scheduled runs use one. The parser bounds repetitions to 1–5. Condition submission order rotates between repetitions; hosted runner scheduling is outside the harness's control.

Measurement version 3 separates software/policy identity from hardware comparability. Exact memory bytes are never rounded or ignored: any difference in CPU model, core allocation or memory capacity blocks cross-condition speedup and efficiency. Complete successful execution evidence can be retained with `status: PASS`, but such a cohort explicitly has `performanceStatus: NOT_COMPARABLE` and `releaseEvidenceEligible: false`. Missing or mismatched tests, policy, software versions, timings or shards still fail the data-integrity gate. A green workflow is not a controlled-hardware performance claim.
