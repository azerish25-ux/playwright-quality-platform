# ADR 0015: Normalize evidence without losing native identity

## Context

Native Playwright blobs and Deadpan journals have different shapes. Counts alone cannot prove that they describe the same tests, projects or attempts.

## Decision

Use schema-versioned normalized records with logical/execution/attempt identities and strict finalization. Reconcile native and canonical identities/outcomes before publication, and freeze result plus PR-report compatibility boundaries.

## Alternatives

A permissive merge can accept missing shards. Last-write-wins records lose retries. Comparing only totals permits substituted test identities.

## Consequences

Unsupported or inconsistent evidence fails closed. Existing PR-report schemas 1, 2 and 3 have explicit validation support; this is not permission to accept arbitrary future schemas. Canonical ordering is independent of shard arrival, including tied timestamps.

## Validation

- [tests/evidence.test.mjs](../tests/evidence.test.mjs)
- [tests/reporter.test.mjs](../tests/reporter.test.mjs)
- [tests/hardening/merge-ordering.test.mjs](../tests/hardening/merge-ordering.test.mjs)
- [tests/compatibility](../tests/compatibility)

These paths identify executable checks or maintained evidence. Consult the exact-source delivery receipts rather than treating this decision text as a test result.
