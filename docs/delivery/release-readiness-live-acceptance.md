# Release-readiness hosted acceptance

The candidate source gate passed at **`c8304873cfce584f352eca69d7ccae068fd3e3b1`** on September 28, 2026. This is acceptance of the staged source candidates and their evidence, not a public release or completion of every release prerequisite.

| Workflow | Run | Result |
| --- | --- | --- |
| Full platform CI | [36494379888](https://github.com/azerish25-ux/playwright-quality-platform/actions/runs/36494379888) | PASS; all 14 required jobs |
| Documentation | [36494380027](https://github.com/azerish25-ux/playwright-quality-platform/actions/runs/36494380027) | PASS; installed npm/pnpm onboarding and browser checks |
| Release candidates | [36494379998](https://github.com/azerish25-ux/playwright-quality-platform/actions/runs/36494379998) | PASS; hardening, complete tarballs and independent source gate |

The aggregate CI job is `109172164268`; the candidate job is `109170382018`. The retained [source receipt](release-source-acceptance.json) identifies all job IDs, exact runs and attempts. Its observation time is `2026-09-28T22:52:55.477Z`.

## Independent artifact verification

Artifact `11003350069`, named `release-candidates-c8304873cfce584f352eca69d7ccae068fd3e3b1-1`, was downloaded and checked against GitHub's archive digest:

```text
sha256:a2ce3d9f34e9b4c63d7011fd03354e9c96abe80cce511109bb6e841adb411f3d
```

The receipt's manifest SHA-256 is `008b8e3d4cd8c7787dd9d812b38d3126bccb1999752abecd02bfe11383a1adec`. All eight downloaded tarballs matched their declared sizes, SHA-256 hashes and SHA-512 integrity values. The source SHA and the fourteen CI jobs plus documentation job matched the receipt. Candidate version `0.1.0` is the source manifest version; it is not an npm publication or a semantic-release result.

Locally, `node --test tests/release-*.test.mjs tests/benchmark-controlled.test.mjs` passed 35 tests with zero failures or skips. Static policy checks also passed. Full cross-platform and real-consumer verification ran on GitHub, not in the local container.

## Earlier controlled local measurements

[Controlled benchmark 36485081291](https://github.com/azerish25-ux/playwright-quality-platform/actions/runs/36485081291) passed at `c2687f515e2075bafff3fcfc20896d53734dec07`. The [scoped receipt](controlled-local-acceptance.json) records archive integrity, independently recomputed raw results and all 30 zero-resource cleanup checks. It contains 15 measured records and 300 first-pass executions across serial, two-worker and four-worker conditions. This accepts local comparisons only. The contemporaneous full CI at that earlier SHA was canceled when superseded; it is not reported as passing.

## Remaining boundaries

The benchmark still does not establish distributed-hardware comparability or separate readiness/reporting/shutdown timing. Generic authentication-state and fixture-lifecycle acceptance remains partial. Semantic-release version coordination, live registry publishing/recovery, actual registry consumers, immutable public action releases and aliases, website deployment and final delivery audit remain incomplete.

The candidate gate is read-only and its receipt retains `publicationAuthorized: false`. Later source revisions require their own workflow verification; this receipt must not be rewritten to pretend it verifies a different SHA. See the [readiness matrix](release-readiness-requirements.json) and [broader requirements](requirements.json).
