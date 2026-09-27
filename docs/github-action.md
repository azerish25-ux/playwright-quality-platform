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

## Fork-safe pull-request publication

The ordinary `CI` workflow continues to use read-only repository permissions. Its aggregate job emits one small data-only JSON artifact named from the workflow run ID and attempt. The artifact records repository, workflow, pull-request source/base revisions, the tested merge revision and required-lane results. It contains no executable source, configuration or HTML.

`.github/workflows/forgeqa-pr-report.yml` runs only after a completed `CI` `workflow_run`. It checks out the default branch into `trusted-source`; it never checks out the pull-request head, merge ref or fork repository. The privileged job has only `actions: read`, `contents: read`, `issues: write` and `pull-requests: write`. GitHub's pull-request issue-comment endpoint rejected the hosted token while `pull-requests` was read-only even though `issues` was write-enabled, so the explicit pull-request write permission is part of the tested publication contract.

The publisher resolves the pull request through the originating source commit when GitHub omits `workflow_run.pull_requests`. Before mutation it verifies the base repository, workflow name/path, source SHA, current PR head, head repository/branch and absence of a newer CI run. It repeats freshness checks immediately before writing. A pull request that modifies the trusted originating CI workflow is reported as an infrastructure failure rather than being allowed to certify its own privileged output.

Before extraction, the trusted publisher authorizes exactly one unexpired run-bound artifact and enforces its compressed-size limit through the GitHub API. Downloaded evidence is placed under `runner.temp`. The publisher then revalidates artifact metadata, archive and extracted-size limits, file/entry/depth limits, regular-file/real-path boundaries, exact schema fields, run/attempt/PR identities, source/base/tested revisions, timestamps, required job inventory, report-to-job consistency and aggregate conclusion. Invalid or missing evidence produces an explicit reporting-infrastructure warning and a nonzero publisher result; it cannot be rendered as a clean ForgeQA result.

The bot owns one comment marked with `<!-- forgeqa-quality-report:v1 -->`. Comment lookup is paginated, reruns update the existing bot comment, duplicate bot comments are removed, attacker-authored marker comments are ignored, and comment metadata prevents an older run from replacing a newer one. Permission denial remains a reporting failure and never changes the originating CI conclusion.

## Release boundary

Source and local-action acceptance are distinct from publication. A standalone immutable tag, controlled major alias, Marketplace state and external released-action acceptance remain release operations and must not be inferred from the presence of `action.yml`.
