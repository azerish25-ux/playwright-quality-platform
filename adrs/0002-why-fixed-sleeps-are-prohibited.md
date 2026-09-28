# ADR 0002: Wait for conditions, not fixed delays

## Context

Application readiness and asynchronous projections do not complete on a predictable wall-clock interval. A fixed delay can be both slow and insufficient.

## Decision

Use native locator assertions, bounded readiness probes and API polling with cancellation/deadlines. Preserve the actual failure when the condition never becomes true.

## Alternatives

Increasing sleeps obscures races; unlimited polling can strand workers. Broader timeouts are not a substitute for identifying the state transition.

## Consequences

Each wait needs a condition and budget. LedgerGuard settlement and scheduling checks must observe durable application state, not infer completion from elapsed time.

## Validation

- [scripts/static-check.mjs](../scripts/static-check.mjs)
- [tests/api.test.mjs](../tests/api.test.mjs)
- [tests/integration/native-runner.test.mjs](../tests/integration/native-runner.test.mjs)

These paths identify executable checks or maintained evidence. Consult the exact-source delivery receipts rather than treating this decision text as a test result.
