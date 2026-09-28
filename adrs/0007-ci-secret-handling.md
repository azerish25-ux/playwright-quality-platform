# ADR 0007: Keep write credentials out of untrusted execution

## Context

PR-controlled tests and reports cannot be trusted with permissions to publish authoritative status or extract release credentials.

## Decision

Execute tests with read-only permissions. Publish only through default-branch code after bounded data validation, exact GitHub job checks and current-head freshness checks; scrub child credentials.

## Alternatives

Executing PR code in a privileged completion workflow crosses the trust boundary. Trusting a report-produced success field alone permits false clean status.

## Consequences

Publication can refuse missing, stale or changed-workflow evidence. That refusal must remain distinguishable from test failure and must not manufacture green status.

## Validation

- [tests/github-pr-reporting.test.mjs](../tests/github-pr-reporting.test.mjs)
- [tests/github-workflow.test.mjs](../tests/github-workflow.test.mjs)
- [packages/github-action/src/main.ts](../packages/github-action/src/main.ts)

These paths identify executable checks or maintained evidence. Consult the exact-source delivery receipts rather than treating this decision text as a test result.
