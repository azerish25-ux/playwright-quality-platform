# Benchmarks without an invented speedup

## Observed execution

The [accepted benchmark receipt](../delivery/benchmark-live-acceptance.md) records five repetitions of serial, two local-parallel and two distributed conditions. Every condition checks the same 20 TeamBoard execution identities. Supplementary runs measure native-versus-Deadpan reporting and explicitly synthetic large-result scaling.

## Why no distributed comparative speedup is published

The recorded hosted machines have different CPU models and exact memory capacities. The retained evidence therefore says `performanceStatus: NOT_COMPARABLE` and `releaseEvidenceEligible: false`. It is valid evidence that the execution and reporting pipeline works, **not** controlled-hardware performance evidence.

The wall-time value includes queueing and a shared matrix barrier. Do not rank conditions by it. Aggregate runner time covers instrumented intervals, not billing. The newer [execution-stage profiling acceptance](../delivery/timing-profiling-live-acceptance.md) separates observed readiness, test-window, reporter finalization and shutdown spans. [Timing semantics](execution-timing.md) explain overlaps and the explicitly unattributed CLI residual. The original dated receipt remains historical evidence, not the latest profiling scope.

## Controlled same-runner observations

At the profiling source, five measurements per condition produced median CLI-run-plus-merge durations of 23.58 s (one worker), 20.27 s (two) and 24.74 s (four). Two workers helped this particular workload; four were slower than serial. These are local-worker results on one recorded runner, not a distributed speedup claim or a universal recommended worker count. The receipt retains raw CSV, stage medians and all 30 cleanup checks.

## Reproduce

```sh
npm run benchmark
npm run test:benchmarks
```

The first command previews the condition matrix; it does not spend runner capacity or create performance observations. Run the dedicated benchmark workflow at an exact source SHA for hosted observations. One-repetition monthly runs are smoke tests; five measured repetitions are required by the current acceptance protocol. Retain raw JSONL/CSV, identity/protocol digests and metadata.

Read the [benchmark harness instructions](../../benchmarks/README.md) for the actual dispatch inputs, artifact layout and summary commands. Do not change retries, tests or artifact policy between conditions to improve a graph.
