# ADR 0005: Separate reproducible values from physical namespaces

## Context

Fixtures must be repeatable across workers, but simultaneous runs cannot reuse physical keys or durable idempotency records accidentally.

## Decision

Seed logical factory values with stable test identity and sequence. Allocate physical namespaces from run, project, shard, worker and attempt dimensions as appropriate; compose real resource keys from both.

## Alternatives

One global seed used as every physical key collides. Unseeded random values prevent deterministic reproduction.

## Consequences

Benchmark inventories and logical values remain comparable while resources are isolated. Durable command replay must include the consumer run identity.

## Validation

- [tests/data.test.mjs](../tests/data.test.mjs)
- [tests/ledgerguard-run-identity.test.mjs](../tests/ledgerguard-run-identity.test.mjs)
- [tests/hardening/property-invariants.test.mjs](../tests/hardening/property-invariants.test.mjs)

These paths identify executable checks or maintained evidence. Consult the exact-source delivery receipts rather than treating this decision text as a test result.
