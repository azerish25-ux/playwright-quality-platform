# GitHub Actions history import

ForgeQA can reconstruct a bounded reliability history from completed GitHub Actions workflow artifacts without treating runner caches or mutable workspaces as historical truth.

```bash
FORGEQA_GITHUB_TOKEN=... forgeqa history import-github \
  --repository owner/repository \
  --workflow ci.yml \
  --artifact-name forgeqa-merged- \
  --max-runs 50 \
  --output .forgeqa/history
```

The token is read only from an environment variable. `--token-env NAME` selects a different environment variable; the token is never accepted as a command-line value or written to reports. Public repositories can be read without a token subject to GitHub's unauthenticated rate limit.

The importer paginates completed workflow runs and artifacts, includes eligible failed workflows, distinguishes workflow reruns by run attempt, and records missing or expired artifacts as explicit coverage gaps. Default-branch records are stored separately from pull-request and non-default-branch observations.

Downloaded ZIP archives are bounded and fail closed on encryption, ZIP64, path traversal, symbolic links, duplicate names, unsupported compression, excess entry counts, decompression expansion, CRC mismatch, ambiguous reports, missing completion markers, or report checksum disagreement. The report repository and tested revision must agree with GitHub workflow metadata.

An identical import is idempotent. Reusing one immutable GitHub run/artifact identity with different result bytes is an integrity error. Imported records retain workflow, run-attempt, artifact, branch, event, conclusion, head-SHA, and creation metadata.

## History-aware reports

Generate HTML, JUnit, Markdown, and machine-readable analysis from a report and an imported store:

```bash
forgeqa flakes \
  --report forgeqa-results/report.json \
  --history .forgeqa/history \
  --minimum-samples 20 \
  --render forgeqa-history-report
```

Distributed report merging also accepts `--history .forgeqa/history`. Reports show the observation window, comparable and rejected runs, N/F/I/P numerators, retry-observed and persistent-failure rates, ownership, per-test samples, and honest `NO_BASELINE` or `INSUFFICIENT_HISTORY` states.
