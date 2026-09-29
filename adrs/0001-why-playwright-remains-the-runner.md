# ADR 0001: Native Playwright remains the runner

## Context

Teams already rely on Playwright projects, locators, assertions, retries and traces. Reimplementing those contracts would create a second scheduler and make existing suites harder to adopt.

## Decision

Compose native Playwright configuration and fixtures, and consume supported reporter/blob interfaces. Deadpan owns policy, identity and evidence validation; Playwright owns browser execution.

## Alternatives

A custom automation engine would duplicate upstream behavior. A page-object-only toolkit would not address evidence integrity or data ownership.

## Consequences

Native compatibility must be tested at public package boundaries. Changes to Playwright report semantics require reconciliation tests rather than private runner imports.

## Validation

- [tests/integration/native-runner.test.mjs](../tests/integration/native-runner.test.mjs)
- [tests/consumers/packed.mjs](../tests/consumers/packed.mjs)
- [tests/compatibility](../tests/compatibility)

These paths identify executable checks or maintained evidence. Consult the exact-source delivery receipts rather than treating this decision text as a test result.
