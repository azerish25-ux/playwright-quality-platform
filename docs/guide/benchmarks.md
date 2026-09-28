# Benchmarks without an invented speedup

## Observed execution

The [accepted benchmark receipt](../delivery/benchmark-live-acceptance.md) records five repetitions of serial, two local-parallel and two distributed conditions. Every condition checks the same 20 TeamBoard execution identities. Supplementary runs measure native-versus-ForgeQA reporting and explicitly synthetic large-result scaling.

## Why no comparative speedup is published

The recorded hosted machines have different CPU models and exact memory capacities. The retained evidence therefore says `performanceStatus: NOT_COMPARABLE` and `releaseEvidenceEligible: false`. It is valid evidence that the execution and reporting pipeline works, **not** controlled-hardware performance evidence.

The wall-time value includes queueing and a shared matrix barrier. Do not rank conditions by it. Aggregate runner time covers instrumented intervals, not billing. Application readiness, in-process reporting and shutdown remain combined inside the shard interval. See the receipt's limitations rather than inferring measurements the harness does not collect.

## Reproduce

```sh
npm run benchmark
npm run test:benchmarks
```

The first command previews the condition matrix; it does not spend runner capacity or create performance observations. Run the dedicated benchmark workflow at an exact source SHA for hosted observations. One-repetition monthly runs are smoke tests; five measured repetitions are required by the current acceptance protocol. Retain raw JSONL/CSV, identity/protocol digests and metadata.

Read the [benchmark harness instructions](../../benchmarks/README.md) for the actual dispatch inputs, artifact layout and summary commands. Do not change retries, tests or artifact policy between conditions to improve a graph.
