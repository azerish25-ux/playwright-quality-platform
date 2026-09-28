# Phase 10A exact-source hardening acceptance

Phase 10A hardening is accepted at source revision `b679c996d9f33afb6a7d89fee294bd6fdfe3afc6`.

## Hosted run

- Workflow: CI
- Run: `36355636084`
- Conclusion: `success`
- Aggregate `forgeqa-quality` job: `108723606813`, `success`
- Hardening job: `108722692037`, `success`
- Hardening artifact: `10944475111`
- Artifact name: `hardening-evidence-b679c996d9f33afb6a7d89fee294bd6fdfe3afc6`
- Artifact digest: `sha256:2d0fa4830c9944a8dcb6327d9101a8bb04c32b6a4a73e96c147e9929744d6069`

The aggregate gate completed only after the Linux, macOS, and Windows Node 22/24 verification matrix, independent packed consumers, TeamBoard, LedgerGuard, hardening, and callable-action jobs succeeded.

## Coverage evidence

The retained policy-kernel coverage artifact records:

| Metric | Threshold | Observed |
|---|---:|---:|
| Lines | 90% | 98.63% |
| Branches | 85% | 96.46% |
| Functions | 85% | 98.77% |

The measured scope contains release-critical policy, identity, redaction, data-ownership, merge-integrity, deterministic-factory, namespace, cleanup, and quarantine runtime modules. The exact run also completed the eight-package tarball audit and clean npm/pnpm consumer installation gates.

## Acceptance boundary

This evidence accepts the source hardening baseline. It does not claim npm registry publication, a tagged public action release, a major action alias, a deployed versioned documentation website, comparable production benchmark results, Marketplace listing, or final release audit completion.
