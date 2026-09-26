# ADR 0001: Why Playwright remains the runner

## Context
ForgeQA must make this concern explicit and testable rather than relying on convention.

## Decision
Adopt the behavior documented in the platform contracts and fail closed when required evidence is unavailable.

## Alternatives
Implicit conventions, best-effort warnings, or a proprietary abstraction were rejected because they hide failure modes or weaken native Playwright behavior.

## Consequences
The implementation carries more metadata and validation, but consumers receive deterministic diagnostics and auditable policy decisions.

## Validation
The behavior is represented by package tests and the delivery requirements matrix.
