# Execution-stage profiling — exact-source acceptance

**PASS for the profiling scope** at source `470843e48b5f9eb19c8f75c439eb5e19f88de5e3`, tree `851e49c9480c08abb6b7b285121d747f16a9aa82`. This is not full benchmark, distributed hardware-comparability, or public-release acceptance.

## Hosted verification

| Workflow | Run | Result |
| --- | --- | --- |
| CI | [36569710737](https://github.com/azerish25-ux/playwright-quality-platform/actions/runs/36569710737) | All fourteen required jobs passed. |
| Documentation | [36569710789](https://github.com/azerish25-ux/playwright-quality-platform/actions/runs/36569710789) | Passed at the implementation source. |
| Release candidates | [36569710551](https://github.com/azerish25-ux/playwright-quality-platform/actions/runs/36569710551) | Prepared-artifact and isolated-registry checks passed; public publishing skipped. |
| Controlled local benchmarks | [36569710704](https://github.com/azerish25-ux/playwright-quality-platform/actions/runs/36569710704) | Five repetitions per worker condition; all receipt and cleanup checks passed. |
| Deadpan benchmarks | [36569711293](https://github.com/azerish25-ux/playwright-quality-platform/actions/runs/36569711293) | Five repetitions per condition; actual independent shards and supplementary acceptance passed. |

CI includes Linux/macOS/Windows with Node 22 and 24, three clean npm/pnpm consumer lanes, actual TeamBoard/PostgreSQL and LedgerGuard integration, hardening, callable source Action and `forgeqa-quality`. Portable timing validators run across the platform matrix; the POSIX application-wrapper child-process tests do not claim Windows signal equivalence. The real profiling benchmarks run on Linux with PostgreSQL and Chromium, Firefox and WebKit.

The local focused suite passed 44 tests with zero failures or skips on Linux. Hosted hardening passed 25 focused hardening/compatibility tests and 135 coverage tests. Unchanged 90/85/85 gates measured **98.99% lines, 95.07% branches and 98.69% functions** across sixteen release-critical modules. The new timing module measured 100% lines, 92.68% branches and 100% functions. These are scoped runtime metrics, not coverage of the entire repository.

## Controlled observations

Every condition executed the same 20 identities, with five measured repetitions and separate warm-ups: **15 measured records, 300 clean measured executions, and 30 verified zero-leak cleanup receipts**. This is one runner session with four available CPUs, `INTEL(R) XEON(R) PLATINUM 8573C`, and 16,765,374,464 bytes of recorded memory.

| Workers | Median CLI run + merge | Range | MAD | Local speedup |
| --- | ---: | ---: | ---: | ---: |
| 1 | 23,578.16 ms | 23,488.65–24,415.11 ms | 28.55 ms | 1.000× |
| 2 | 20,267.54 ms | 19,950.18–20,316.97 ms | 49.42 ms | 1.163× |
| 4 | 24,735.39 ms | 24,402.94–24,893.60 ms | 152.03 ms | 0.953× |

Four workers were slower than serial for this workload. No universal worker-count recommendation follows from five samples on shared hosted hardware.

| Workers | Readiness | Test window | Deadpan finalization | All reporters | Shutdown | Unattributed CLI |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 108.48 ms | 19,582.58 ms | 8.24 ms | 106.99 ms | 7.43 ms | 2,567.84 ms |
| 2 | 107.93 ms | 16,077.80 ms | 8.45 ms | 108.69 ms | 8.71 ms | 2,760.51 ms |
| 4 | 186.92 ms | 19,881.56 ms | 8.81 ms | 112.10 ms | 7.53 ms | 3,343.41 ms |

These are independent per-stage medians, not an additive partition. All-reporters finalization contains Deadpan finalization. Attempt work is summed separately; the CLI residual is explicit. See [timing semantics](../guide/execution-timing.md) and the actual [controlled observations](timing-local-observations.csv).

## Distributed evidence without invented speedup

The five-condition workflow retained **25 successful records, 500 clean measured executions and 45 validated shard profiles**. Both the original and profiling validators reconciled exact inventories, native/canonical evidence, source/run/shard identities and monotonic spans. The downloaded raw JSONL matched all 25 individual records; its complete summary was independently recomputed.

Six CPU models and differing exact memory capacities remain in this experiment. `performanceStatus` is **NOT_COMPARABLE**, `releaseEvidenceEligible` is false, and every distributed-workflow speedup and efficiency ratio remains null. Same-host component clocks are never subtracted across runners. [Actual per-shard observations](timing-shard-observations.csv) retain the stages without claiming a distributed latency partition.

## Independent artifact validation

Four downloaded ZIP digests matched GitHub's artifact metadata. The source tar and all eight package tarballs matched their retained SHA-256 manifest. Reconstructing Git tree objects from all 350 archived source files produced the exact source tree above. The new timing public API also passed a synthetic roundtrip after an offline npm installation of the actual core tarball, without workspace links.

Downloaded LCOV counts were independently recomputed: 1,762/1,780 lines, 983/1,034 branches and 226/229 functions. The controlled summary was recomputed from its actual receipts, with all 30 cleanup checks revalidated. Distributed profiles, derived fields, per-condition summaries and all five retained checksums were independently checked. Archive IDs, digests, exact numeric observations and verification scope are in [the acceptance record](timing-profiling-acceptance.json).

## Requirement boundaries

`TP-01` through `TP-05` are accepted. `P11-06` is accepted for the documented instrumented timing scope. `P11-05`, `R-018` and `RR-01` remain partial for comparable distributed performance. Runner instrumentation still excludes some checkout, service and upload overhead and is not billing data.

The newer [recovery receipt](crash-recovery-acceptance.json) accepts `RC-01` through `RC-06` only for same-host process loss with a surviving private journal. Lost-runner and cross-host ownership/liveness recovery are not accepted. No npm public release, immutable public Action release, stable alias, Marketplace listing or versioned public documentation deployment is claimed.

The documentation/evidence follow-up must pass CI and Documentation at its own delivery SHA; these benchmark receipts remain bound to the exact implementation source above.
