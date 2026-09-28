# ADR 0010: An action step is not a distributed job matrix

## Context

An action executes inside its caller job; it cannot turn local child processes into independent hosted runners.

## Decision

Use the action for bounded local orchestration and explicit plan/shard/merge operations. Use a reusable workflow to expand independent jobs from one immutable manifest and require every shard in the aggregate.

## Alternatives

Labeling local workers as distributed runners misstates cost and isolation. A matrix without strict inventory merge can silently drop failed shards.

## Consequences

Worker budget, shard count and runner cost are distinct. Immutable action references must be validated separately from local source-action acceptance.

## Validation

- [.github/workflows/forgeqa-reusable.yml](../.github/workflows/forgeqa-reusable.yml)
- [tests/github-action.test.mjs](../tests/github-action.test.mjs)
- [tests/github-workflow.test.mjs](../tests/github-workflow.test.mjs)

These paths identify executable checks or maintained evidence. Consult the exact-source delivery receipts rather than treating this decision text as a test result.
