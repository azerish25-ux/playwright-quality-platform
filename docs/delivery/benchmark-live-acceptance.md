# Phase 11A hosted benchmark execution acceptance

## Exact source and verification

Observed on September 28, 2026. Source `9361d9fa9515ae9c173f644b993472133032e85e` passed [CI run 36444479253](https://github.com/azerish25-ux/playwright-quality-platform/actions/runs/36444479253) and [benchmark run 36444479660](https://github.com/azerish25-ux/playwright-quality-platform/actions/runs/36444479660). This is acceptance of the benchmark execution/evidence system, not a controlled-hardware speedup claim or a public product release.

The benchmark retained 25 condition/repetition records: five conditions, five measured repetitions, and 20 identical TeamBoard execution identities per record. All **500 measured executions** passed on their first attempt. Each shard also ran one independently identified, verified warm-up per repetition; its evidence was retained separately and excluded from measured reports. The inventory digest is `6a98e55fa4320176262c4e387a75bfb5cf856bc7ee1574fdf01c5259785d0f22`.

## Observed measurements

| Condition | Measured repetitions | Executions per repetition | Median execution + merge | Range |
|---|---:|---:|---:|---:|
| `serial-1x1` | 5 | 20 | 23476 ms | 17520–25718 ms |
| `local-2x1` | 5 | 20 | 20903 ms | 17196–35802 ms |
| `local-4x1` | 5 | 20 | 25496 ms | 19379–26708 ms |
| `distributed-2x1` | 5 | 20 | 20154 ms | 16024–21832 ms |
| `distributed-4x1` | 5 | 20 | 13127 ms | 12807–27354 ms |

These are observed durations, not a ranking of configurations. Performance comparability is **NOT_COMPARABLE**. Exact CPU and memory fingerprints are retained in [benchmark-evidence.json](benchmark-evidence.json); heterogeneous hardware prevents cross-condition speedup or efficiency claims. The machine-readable `releaseEvidenceEligible` flag is `false`. No published performance improvement is claimed.

The comparison timer uses the longest measured shard duration plus merge/report duration. Queue-inclusive elapsed time and instrumented aggregate runner time are separate fields in [the original raw CSV](benchmark-observations.csv). Shared matrix barriers are not counted as execution speedup. Checkout, service provisioning, final uploads and service shutdown are outside the instrumented runner total. Application readiness, execution, in-process reporting and shutdown are currently combined inside each shard duration; finer lifecycle profiling remains unfinished.

## Supplementary verification

The same source ran native JSON/blob reporting versus the ForgeQA reporter added to the identical real 20-execution TeamBoard suite, with one warm-up per mode and five measured runs per mode. Inventory equivalence and clean first attempts were checked. Median whole-process overhead was 94.49 ms (0.411%). This small sample is not a universal overhead guarantee and does not isolate every reporter callback from process startup.

Synthetic scaling ran five fresh-process measurements each at 1,000, 10,000 and 100,000 attempts. It retained merge and JSON/JUnit/HTML rendering durations, output sizes/checksums and peak RSS. The workload is explicitly synthetic, not a customer suite or journal-filesystem measurement. An independent read-only cleanup check found zero remaining test namespaces, tenants and accounts.

## Retained evidence

- Primary artifact `10979738095`: SHA-256 `392b5e1d204844630de5579a75cdbb6bae304ae78e1bfc40609a94060ac0b59d`.
- Supplementary artifact `10979927237`: SHA-256 `794eed9bde211c966d6f4f14bdfe5267de51de9df5b959961607066f2f28158c`.
- The primary artifact contains raw JSONL/CSV, summaries, checksums and all 25 condition records with canonical reports. Supplementary raw samples and cleanup evidence are separate. Both artifacts have a 30-day retention policy; raw CSV and detailed receipts are also retained in this repository.
- [benchmark-evidence.json](benchmark-evidence.json) records the exact measurement contract, hardware limitations and supplementary results. [benchmark-observations.csv](benchmark-observations.csv) preserves the original exported CSV bytes.

## Delivery boundaries

Twenty-two focused benchmark tests passed locally; the exact source also passed hosted cross-platform CI and existing hardening, consumers, TeamBoard, LedgerGuard and action checks. No required browser, assertion, retry gate or identity check was removed. The failed earlier benchmark attempts remain failures; their evidence is not relabelled as acceptance of this revision.

Phase 11B versioned documentation, granular lifecycle instrumentation, controlled-hardware release performance evidence, registry/action publication and the final delivery audit remain separate unfinished work. Source-mode performance measurements do not establish installed-registry or packed-package performance.
