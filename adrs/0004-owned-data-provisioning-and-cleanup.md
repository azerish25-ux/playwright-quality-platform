# ADR 0004: Provision and clean up only owned data

## Context

Concurrent tests and real applications may share infrastructure. Broad deletion during teardown can destroy another run or legitimate application state.

## Decision

Allocate namespaces, register owned resources, and execute guarded cleanup in reverse allocation order. Inspect cleanup failures and independently check remaining resources in consumer acceptance.

## Alternatives

Database-wide truncation is unsafe for shared environments. Cleanup based only on a mutable display-name prefix is weaker than explicit ownership.

## Consequences

Adapters must enforce ownership at the write boundary. A passing test cannot excuse cleanup failure; generic reclamation and restart edge cases remain bounded by the delivery ledger.

## Validation

- [tests/data.test.mjs](../tests/data.test.mjs)
- [tests/hardening/property-invariants.test.mjs](../tests/hardening/property-invariants.test.mjs)
- [scripts/teamboard-acceptance.mjs](../scripts/teamboard-acceptance.mjs)

These paths identify executable checks or maintained evidence. Consult the exact-source delivery receipts rather than treating this decision text as a test result.
