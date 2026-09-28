# Configuration

## Resolve configuration once

Define application configuration with `defineForgeConfig` from `@azerish25-ux/forgeqa-core`. `defineForgePlaywrightConfig` connects it to the native Playwright configuration. The [quickstart](guide/quickstart.md) embeds a compiled example; the generated public API reference contains the complete declarations.

Resolution starts with defaults and project settings, selects an environment, applies allowlisted environment overrides, then applies explicit supported CLI overrides. Arrays replace rather than concatenate. The resulting configuration has a deterministic redacted `configHash`, absolute owned output paths and a numeric `timeoutMs`.

## Required inputs and execution options

| Input | Meaning and current contract |
|---|---|
| `project` | Required nonempty project identity. |
| `consumer` | Consumer identity; defaults to the project. |
| `environments` | Named profiles with an HTTP(S) `baseUrl` and optional string variables. |
| `environment` | Default named profile; explicit selection and `FORGEQA_ENVIRONMENT` take precedence. |
| `suites` | Nonempty arrays of `@tags`; preserve native test titles and tags during adoption. |
| `browsers` | Chromium, Firefox and/or WebKit; defaults to Chromium. |
| `workers` | Local worker count, 1–128; defaults to 1. |
| `shards` | Shard count, 1–256; defaults to 1. This does not provision remote runners. |
| `retries` | Retry budget, 0–3; defaults to 0. A recovered retry is not clean success. |
| `timeout` | Positive milliseconds or a value using `ms`, `s`, `m` or `h`, at most 24 hours; defaults to 30 seconds. |
| `outputDir` | Defaults to `forgeqa-results`; must remain inside the consumer root. |
| `historyDir` | Defaults to `.forgeqa/history`; must remain inside the consumer root. |
| `quarantineFile` | Defaults to `.forgeqa/quarantine.json`; must remain inside the consumer root. |

The selected base URL rejects embedded username/password credentials. Pass real credentials through scoped application adapters, not URLs, tracked config or report metadata. Configuration validation is not permission to execute destructive work against production.

## Environment overrides

The resolver recognizes `FORGEQA_ENVIRONMENT`, `FORGEQA_BASE_URL`, `FORGEQA_WORKERS`, `FORGEQA_SHARDS` and `FORGEQA_RETRIES`. These are specific supported inputs, not an unrestricted environment-to-configuration mapping. Unsupported CLI flags fail rather than being silently ignored. Use [CLI reference](cli.md) for exact invocation shapes.

## Strict policy defaults

`qualityGates` defaults to `failOnRetryRecovered: true`, `unexpectedSkipBudget: 0`, `requireCompleteShards: true`, `maxQuarantineEntries: 20` and `minimumHistorySamples: 20`. Optional duration and flake-rate budgets are available in the public contract. Quarantine is accountable metadata, not a mechanism to hide failing tests.

`artifactPolicy` defaults to failure-retained traces/video, failure-only screenshots and seven-day retention metadata. The actual CI upload retention and artifact access controls must also be configured; a configuration value alone cannot set storage permissions. `github` defaults to summaries enabled and PR comments disabled. The dedicated trusted publisher handles actual PR comment authorization.

## Selection, secrets and compatibility

`selectionMap` maps changed areas to coverage while unknown or shared-code changes must broaden selection. Missing history or a missing baseline must not silently remove tests. See [distributed evidence](distributed-evidence.md) and [history](history.md).

Environment variable values are omitted from the material used for the non-secret hash, and published textual diagnostics are redacted. Binary artifacts remain sensitive. Unknown top-level options, invalid environments, unsafe output paths and invalid execution bounds are rejected before running the application. Nested adapter behavior still requires its own validation; the typed config is not a universal security boundary.

Source-candidate configuration is frozen by pre-release compatibility tests. A later stable release requires the documented semantic-version and migration policy, rather than silently changing defaults beneath existing suites.
