# ForgeQA benchmark harness

This directory contains two deliberately separate benchmark classes:

1. **Comparable TeamBoard execution benchmarks** use the real PostgreSQL-backed consumer, one immutable Playwright inventory, identical retry and artifact policies, and strict ForgeQA evidence reconciliation.
2. **Synthetic scaling benchmarks** measure deterministic factory throughput and report-rendering cost. They are labeled synthetic and are never used as customer-suite or distributed-speedup evidence.

## Comparable conditions

| ID | Runners | Workers per runner | Purpose |
|---|---:|---:|---|
| `serial-1x1` | 1 | 1 | Serial reference condition |
| `local-1x2` | 1 | 2 | Same-runner parallelism |
| `local-1x4` | 1 | 4 | Higher same-runner parallelism |
| `distributed-2x1` | 2 | 1 | Independent two-runner sharding |
| `distributed-4x1` | 4 | 1 | Independent four-runner sharding |

Every condition is fixed to the `release` suite, Chromium plus browserless API coverage, zero retries, zero unmeasured warm-ups, a disabled dependency cache, the same trace/screenshot/video policy, and the same 12 execution identities: eight API tests and four Chromium UI tests. A condition fails before publication when any count, logical identity, execution identity, project assignment, environment, shard finalization, native report, or ForgeQA report differs.

## Hosted execution

`.github/workflows/benchmark.yml` provides:

- a one-repetition pull-request and main-branch smoke path;
- a manual one- or five-repetition path;
- a weekly five-repetition path;
- independent GitHub jobs for real distributed shards through `benchmark-distributed.yml`;
- retained raw JSON, NDJSON and CSV;
- median, range, interquartile range, median absolute deviation, speedup, parallel efficiency, elapsed wall time and aggregate runner time;
- a separate synthetic artifact.

Five measured repetitions are required before the output is suitable for Phase 11 release evidence. A one-repetition run verifies the pipeline but is explicitly marked as a limited sample.

## Local entrypoints

The real TeamBoard harness requires a built workspace, Chromium, and the disposable TeamBoard PostgreSQL environment used by CI. The workflow is the supported end-to-end entrypoint. Individual commands are:

```bash
node benchmarks/teamboard.mjs local --condition serial-1x1 --repetition 1 --output .benchmark-output/result
node benchmarks/teamboard.mjs plan --condition distributed-2x1 --repetition 1 --output .benchmark-output/plan
node benchmarks/teamboard.mjs shard --condition distributed-2x1 --repetition 1 --shard-index 1 --manifest manifest.json --output .benchmark-output/shard-1
node benchmarks/teamboard.mjs merge --condition distributed-2x1 --repetition 1 --manifest manifest.json --plan-record plan-record.json --input .benchmark-shards --output .benchmark-output/merged
```

Contract-only verification does not require a database or browser:

```bash
npm run test:benchmarks
```

Synthetic measurements remain separate:

```bash
npm run benchmark
npm run benchmark:reporter
```

## Evidence contract

- `schemas/benchmark-record.schema.json` freezes one condition/repetition record.
- `schemas/benchmark-summary.schema.json` freezes the aggregate result.
- `benchmark-record.json` retains the exact inventory digests, environment and phase durations.
- `raw.ndjson` and `raw.csv` preserve every measured record.
- `summary.json`, `summary.csv` and `summary.md` contain the calculated statistics and limitations.

Generated results are uploaded as workflow artifacts rather than committed to Git history.
