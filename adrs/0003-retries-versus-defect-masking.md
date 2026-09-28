# ADR 0003: Retries preserve defects instead of masking them

## Context

A test that fails and later passes has different reliability from one that passes on its first attempt. Counting only the last result hides that distinction.

## Decision

Retain every attempt, classify retry recovery explicitly and fail the default strict retry-recovered gate. Diagnostic repetition has separate budgets and must retain the first failure.

## Alternatives

Best-of-N success masks defects. Globally disabling all retry diagnostics loses useful evidence of intermittent behavior.

## Consequences

A green native final attempt does not guarantee a green ForgeQA policy result. Teams must investigate flaky behavior or document a deliberate policy change.

## Validation

- [tests/reporter.test.mjs](../tests/reporter.test.mjs)
- [tests/repeat-selection.test.mjs](../tests/repeat-selection.test.mjs)
- [tests/integration/native-runner.test.mjs](../tests/integration/native-runner.test.mjs)

These paths identify executable checks or maintained evidence. Consult the exact-source delivery receipts rather than treating this decision text as a test result.
