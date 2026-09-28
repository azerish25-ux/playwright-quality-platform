# ADR 0014: Broaden changed-area selection when uncertain

## Context

Selecting fewer tests can lower feedback latency, but unknown paths, absent baselines and new tests can make a narrow selection unsafe.

## Decision

Use explicit mappings and conservatively choose full coverage when baseline or mapping evidence is insufficient. Preserve new tests and reject unjustified empty whole-suite selections.

## Alternatives

Guessing a narrow suite from filenames alone can miss shared-code regressions. Requiring history before a test is selected excludes new coverage.

## Consequences

The manifest records what was selected before execution. Optimization may cost a full run when information is missing; that is preferable to false confidence.

## Validation

- [tests/core.test.mjs](../tests/core.test.mjs)
- [tests/hardening/property-invariants.test.mjs](../tests/hardening/property-invariants.test.mjs)
- [tests/repeat-selection.test.mjs](../tests/repeat-selection.test.mjs)

These paths identify executable checks or maintained evidence. Consult the exact-source delivery receipts rather than treating this decision text as a test result.
