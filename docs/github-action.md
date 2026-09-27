# GitHub Action and distributed workflow

ForgeQA separates a JavaScript action from a reusable distributed workflow.

## Trust model

The action runs inside the caller's checkout. `working-directory`, configuration, manifest, CLI, evidence and output paths are confined to `GITHUB_WORKSPACE`, including real-path checks that reject symlink escapes. ForgeQA/package-manager commands use argument arrays. `build-command` and `application-command` are the only explicit shell inputs and are treated as trusted workflow configuration, never as values derived from PR titles, branch names or test output.

GitHub, Actions and registry tokens are removed before application, Playwright and ForgeQA child execution. Dependency installation may receive registry authentication, but the application process does not. Readiness URLs must use HTTP(S) and cannot contain credentials.

## Modes

| Mode | Purpose |
|---|---|
| `run`, no `shard-index` | Plan once and execute one or more bounded local shard processes under a total worker budget. |
| `plan` | Produce one immutable manifest for independent matrix jobs. |
| `run`, explicit `shard-index` | Execute exactly one manifest-bound matrix shard. |
| `merge` | Validate a downloaded shard tree and merge native/canonical evidence. |

An individual distributed shard intentionally has no merged HTML report. The merge job produces the canonical report and final policy outcome.

## Failure propagation

Exit `0` is policy-compliant success, `1` is a test or quality-policy failure, `2` is invalid caller configuration, `3` is infrastructure or evidence-integrity failure, and `130` is interruption. Evidence output does not override these outcomes. The action writes outputs and a job summary before returning the nonzero status whenever possible.

## Artifact handling

The JavaScript runtime returns an owned `evidence-path`, collision-resistant `artifact-name`, and validated retention period. The reusable workflow uploads those paths with a pinned `actions/upload-artifact` release. GitHub artifacts remain authenticated workflow artifacts; they are not represented as public report websites.

## Release boundary

Source and local-action acceptance are distinct from publication. A standalone immutable tag, controlled major alias, Marketplace state and external released-action acceptance remain release operations and must not be inferred from the presence of `action.yml`.
