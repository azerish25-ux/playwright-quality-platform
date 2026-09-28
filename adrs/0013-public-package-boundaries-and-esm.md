# ADR 0013: Publish ESM packages with explicit boundaries

## Context

Workspace imports can succeed even when an external consumer lacks private files, declarations or internal dependencies.

## Decision

Expose the declared ESM entrypoints with TypeScript declarations, supported Node runtime and public dependencies. Compile and execute independent npm and pnpm consumers from the exact tarballs, rejecting private imports and workspace resolution.

## Alternatives

Shipping the entire source tree blurs contracts. Advertising untested CommonJS behavior would exceed the supported module format.

## Consequences

Documentation examples must use public exports. Compatibility tests and clean installs, not a local workspace build alone, decide adoption readiness.

## Validation

- [tests/consumers/public-exports.mjs](../tests/consumers/public-exports.mjs)
- [tests/consumer-resolution.test.mjs](../tests/consumer-resolution.test.mjs)
- [scripts/package-hardening.mjs](../scripts/package-hardening.mjs)

These paths identify executable checks or maintained evidence. Consult the exact-source delivery receipts rather than treating this decision text as a test result.
