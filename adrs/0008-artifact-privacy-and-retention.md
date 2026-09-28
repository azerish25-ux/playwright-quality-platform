# ADR 0008: Treat binary evidence as sensitive

## Context

Textual diagnostics and browser binaries have different privacy properties. A trace or screenshot can contain data not understood by a string redactor.

## Decision

Redact supported textual records, test seeded secrets, and separately limit binary capture, access and retention. Keep complete run artifacts out of Git history.

## Alternatives

Claiming all captures are sanitized is false. Removing all evidence prevents useful failure investigation.

## Consequences

Documentation uses actual synthetic acceptance evidence and identifies its source. Public release examples require a privacy review; retention metadata must match the upload workflow.

## Validation

- [tests/reporter.test.mjs](../tests/reporter.test.mjs)
- [tests/hardening/property-invariants.test.mjs](../tests/hardening/property-invariants.test.mjs)
- [docs/security.md](../docs/security.md)

These paths identify executable checks or maintained evidence. Consult the exact-source delivery receipts rather than treating this decision text as a test result.
