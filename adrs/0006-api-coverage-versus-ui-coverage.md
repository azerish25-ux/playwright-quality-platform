# ADR 0006: Use API and UI coverage for different evidence

## Context

API tests can establish authorization and durable state quickly, while a browser is needed to establish rendered interaction, navigation and client behavior.

## Decision

Use API-first provisioning and domain checks, then retain genuine UI journeys for browser-dependent confidence. Describe coverage differences explicitly rather than substituting synthetic UI for a missing product.

## Alternatives

Everything-through-UI is slower and less diagnostic. API-only acceptance cannot certify a real browser interface.

## Consequences

TeamBoard includes API and three-browser journeys. LedgerGuard remains honestly API-first until its real interface exists. Timing comparisons must not imply identical coverage where it differs.

## Validation

- [examples/demo-saas/tests](../examples/demo-saas/tests)
- [consumers/ledgerguard/tests](../consumers/ledgerguard/tests)
- [docs/delivery/ledgerguard-consumer-requirements.json](../docs/delivery/ledgerguard-consumer-requirements.json)

These paths identify executable checks or maintained evidence. Consult the exact-source delivery receipts rather than treating this decision text as a test result.
