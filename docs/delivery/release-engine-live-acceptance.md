# Phase 12A hosted acceptance — coordinated release engine

**The prepared release engine and isolated-registry recovery passed at source `eab1c4fb105de7def46de0511b0af8c16763db44`. This is not a public npm release.**

The implementation began in `d5ba1d83456c04a5f2d6b891e1d40a35010f9f17`. Follow-up commits upgraded the release toolchain to semantic-release 25.0.9 and separated its private maintainer runtime from the unchanged public package Node `>=22` contract. The earlier failed attempts remain failed evidence; no audit threshold, required browser or acceptance gate was weakened.

## Exact-source hosted verification

| Workflow | Run | Result |
| --- | --- | --- |
| Full platform CI | [36503848156](https://github.com/azerish25-ux/playwright-quality-platform/actions/runs/36503848156) | All 14 required jobs passed, including the dependency audit, six OS/Node verification combinations, three installed-consumer lanes, TeamBoard, LedgerGuard, hardening, action and aggregate. |
| Documentation | [36503848142](https://github.com/azerish25-ux/playwright-quality-platform/actions/runs/36503848142) | Installed npm/pnpm onboarding, strict site build, local links and Chromium navigation/search checks passed. |
| Release candidates | [36503848112](https://github.com/azerish25-ux/playwright-quality-platform/actions/runs/36503848112) | Source hardening, semantic preparation, final-tarball consumers and real npm protocol recovery passed. The separate public publishing job was skipped. |

The release verification job is `109200663012`; the CI aggregate is `109202502301`. Exact jobs, artifact identities and independent verification results are retained in [the machine-readable receipt](release-engine-acceptance.json).

## What executed

The real commit history produced a semantic plan for **1.0.0**, rather than reusing the source manifests' **0.1.0**. This is an initial-release calculation, not a created release tag or a claim of stable readiness. The plan retains the real source tree, commit inventory and unreleased notes.

All eight packages were copied from hardening-verified artifacts, prepared at one version, and repacked with coordinated internal dependency ranges. Source package versions were not changed. Fresh npm and pnpm consumers bootstrapped through the installed CLI, checked all eight installed versions and generated dependency versions, compiled public interfaces, and executed the demo API/UI suite and native Playwright entrypoint.

The actual prepared tarballs were then published with the npm CLI to an owned loopback registry. The fourth upload was interrupted after three successful publications. Recovery reconciled downloaded registry bytes, finished the missing packages, and verified that another run did not republish an immutable version. Fresh npm/pnpm consumers installed from that registry and passed; owned registry resources were cleaned up. Separate regressions exercise lost acknowledgement after an accepted upload, conflicting bytes, invalid origins, incomplete receipts and authorization refusal.

## Independent downloaded-artifact verification

Both archives were downloaded and matched GitHub's recorded SHA-256 digests:

| Artifact | ID | SHA-256 |
| --- | --- | --- |
| Source and prepared acceptance | `11006946901` | `3f87a60ab285396e879cbf5748c4c529a5dd6852859d3bf21afb7a96cb147460` |
| Prepared release | `11007221471` | `77c84f797e6b11336ebd5f914fc518fb09bce2e6181c8dc2a18d60add0053b22` |

All prepared files matched across the two archives. Sixteen complete tarballs, comprising the eight source and eight prepared artifacts, matched their retained SHA-256, SHA-512 and byte sizes. Every prepared package contained version 1.0.0 and correct internal dependencies; every non-manifest package file matched the corresponding source artifact byte for byte. All eight retained the public Node `>=22` contract.

The four consumer receipts matched the exact source, version, package checksums and all eight installed package names. Their four canonical reports contained eight successful first attempts in total, with no retries. Source/prepared manifest digests and the semantic-plan digest were independently recomputed.

The prepared manifest SHA-256 is `bd5efc2b5f9772be442a190cf7447d0e39c9b2644d90cee357412e194e658080`; the semantic-plan digest is `1c4ef1c205241f56ed119a1209c9c9d4c7aa38f0c0b2c0e5d4e2f1bccff94c84`. Artifact retention expires on October 29, 2026; the small source receipt preserves their identities without adding binaries or browser traces to Git history.

## Remaining acceptance boundaries

P12A-01 through P12A-06 and P12A-08 are accepted within this scope. P12A-07 remains **PARTIAL**: its refusal/authorization tests pass, but actual npm scope/trusted-publisher authorization and public publication have not been exercised. The broader RR-07 therefore also remains PARTIAL.

No `latest` promotion, stable tag, action major alias, public website deployment or complete platform release is claimed. The remaining generic authentication/fixture lifecycle, benchmark, real public distribution and final-audit requirements remain open. See [the scoped ledger](release-engine-requirements.json), [broader requirements](requirements.json) and [maintainer guide](../guide/release-engine.md).

A later documentation-only checkpoint may record this acceptance, but it must not rewrite this receipt to imply that these artifacts came from that later SHA.
