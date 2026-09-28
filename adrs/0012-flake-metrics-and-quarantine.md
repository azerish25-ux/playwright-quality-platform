# ADR 0012: Define flakiness and accountable quarantine

## Context

Retry attempts are correlated observations of an execution. Counting them as independent denominator samples can understate unreliability. Quarantine can also hide failed coverage.

## Decision

Compute metrics from comparable execution records with explicit denominators. Require quarantine ownership and bounded expiry; keep quarantined tests visible and failing tests nonzero under strict policy.

## Alternatives

Dropping failed history or retry inflation creates optimistic metrics. Automatic indefinite quarantine removes accountability.

## Consequences

Reports explain sample size and unavailable history. Complete release inclusion and lifecycle edge cases remain separately verified; a quarantine file is not proof of successful governance.

## Validation

- [tests/flake.test.mjs](../tests/flake.test.mjs)
- [tests/history.test.mjs](../tests/history.test.mjs)
- [packages/flake-analysis/src/quarantine.ts](../packages/flake-analysis/src/quarantine.ts)

These paths identify executable checks or maintained evidence. Consult the exact-source delivery receipts rather than treating this decision text as a test result.
