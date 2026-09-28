# ADR 0011: Store immutable history and expose incomplete evidence

## Context

History affects reliability decisions, but repeated imports, missing artifacts and incompatible cohorts can bias results.

## Decision

Retain immutable normalized records, make duplicate import idempotent, reject conflicting records and compare only compatible cohorts. Bounded GitHub artifact import includes eligible failed runs, not just successes.

## Alternatives

Treating caches as authoritative history loses failed or evicted samples. Merging incompatible environments into one trend is misleading.

## Consequences

Insufficient history is explicit, not a zero flake rate. Retention and import bounds may reduce available evidence; diagnostics must identify those limitations.

## Validation

- [tests/history.test.mjs](../tests/history.test.mjs)
- [tests/github-history.test.mjs](../tests/github-history.test.mjs)
- [tests/history-reporting.test.mjs](../tests/history-reporting.test.mjs)

These paths identify executable checks or maintained evidence. Consult the exact-source delivery receipts rather than treating this decision text as a test result.
