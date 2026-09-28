# ADR 0009: Coordinate package publication and public compatibility

## Context

Eight public packages depend on a coherent contract. Partial publication can leave an installable-looking but unusable version set.

## Decision

Keep package versions and internal dependencies coordinated, freeze pre-release contracts, audit packed contents and install exact artifacts in clean consumers before release. Require actual registry acceptance and a tested partial-publication recovery path before claiming stable distribution.

## Alternatives

Publishing packages independently without a plan risks mixed contracts. A dry-run tarball is not evidence that npm contains a release.

## Consequences

Registry authorization, release tagging and recovery are still release gates, not completed by this decision. Breaking changes need a declared semantic-version policy and migration notes.

## Validation

- [tests/compatibility](../tests/compatibility)
- [scripts/package-hardening.mjs](../scripts/package-hardening.mjs)
- [.github/workflows/release.yml](../.github/workflows/release.yml)

These paths identify executable checks or maintained evidence. Consult the exact-source delivery receipts rather than treating this decision text as a test result.
