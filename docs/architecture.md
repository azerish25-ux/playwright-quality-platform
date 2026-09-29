# Architecture

## Preserve the native runner

Deadpan is a library and CLI platform around Playwright Test. Applications keep their native locators, assertions, project configuration, traces and scheduling. The CLI discovers an expected inventory before execution; native reporter callbacks emit evidence that the policy layer can reconcile against that inventory. Deadpan is not a replacement browser engine or hosted dashboard service.

```text
Application: configuration + native Playwright tests
    |
    +-- forgeqa CLI ---- plan / validate / execute / merge
    |                         |
    +-- Playwright Test ------+-- typed Deadpan fixtures
                              |      +-- HTTP client
                              |      +-- deterministic data / owned cleanup
                              |
                              +-- attempt journal + finalization + artifacts
                                                   |
                                            strict reconciliation
                                                   |
                                  JSON / JUnit / Markdown / static HTML
                                                   |
                                    immutable history + centralized gates
```

## Public package graph

`core` defines configuration, identities, shared contracts, errors, selection and quality policies. `api` and `test-data` provide browser-independent operations on those contracts. `reporter` normalizes evidence and merges shards; `flake-analysis` stores and compares normalized results. `playwright` composes native fixtures and connects reporter callbacks. `cli` and `github-action` orchestrate these public boundaries. The generated public API pages expose the built declaration graph of all eight packages.

Applications must not import `packages/*/src`, private `dist` files, examples or another application's adapters. Consumers install package artifacts and compose public exports. Package runtime code never depends on the examples. See [the package-boundary decision](../adrs/0013-public-package-boundaries-and-esm.md).

## Execution lifecycle and failure ownership

Configuration is validated before application execution. Discovery materializes the expected logical tests and execution dimensions. A run owns its namespace and artifact directory; workers and attempts cannot borrow another run's resources. Native execution records original and retry attempts. Finalization binds journals, checksums and captured artifacts to the run. Merge rejects absent, incompatible, repeated or corrupt evidence; native blob output is reconciled with the canonical report before acceptance.

Cleanup belongs to the scope that allocated the resource, including failure paths. A passing test does not excuse missing finalization or failed infrastructure cleanup. A recovered retry remains visible to strict quality policy. CLI exit codes distinguish quality failure, usage failure, evidence/infrastructure failure and interruption; see [CLI reference](cli.md).

## Trust boundaries

```text
Untrusted PR source -- read-only CI --> run-bound data artifact
                                           |
                  trusted default-branch workflow_run publisher
                  validates API metadata + archive + schema + jobs
                                           |
                                  one bot-owned PR comment

Trusted release source -- separate authorized release process --> distributions
```

The privileged publisher never installs or executes artifact code. Tests and application children do not receive GitHub or registry write credentials. A successful source consumer is not an npm-publication claim; public distribution and documentation deployment require separate acceptance.

## Limits to read with the diagrams

LedgerGuard coverage is API-first; no real LedgerGuard browser UI is currently certified. The benchmark execution system has hosted evidence, but heterogeneous hardware blocks speedup claims and detailed lifecycle timing remains incomplete. Fixture restart, override and recovery edge cases retain partial statuses in the delivery ledgers. These diagrams describe ownership and data flow, not proof that every release requirement has passed.
