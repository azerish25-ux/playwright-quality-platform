# Distributed evidence integrity

Deadpan treats a distributed run as complete only when both of its evidence representations agree:

1. the finalized Deadpan shard journals, which provide stable logical/execution/attempt identities, immutable expected inventory and policy inputs; and
2. Playwright blob reports, which preserve native test events and attachments for supported report merging.

`forgeqa report merge` accepts finalized `attempts.ndjson.final.json` files. For every shard it verifies the journal checksum, the `shard-complete.json` marker, run and shard dimensions, every captured attachment's path, regular-file status, size and SHA-256, and exactly one non-empty Playwright blob ZIP. Absolute paths, traversal, symbolic links, duplicate captured paths, changed or deleted files and mixed run dimensions fail with infrastructure exit code `3`.

The command copies captured files into shard-namespaced destinations, preserves the original blob ZIPs, invokes Playwright's supported `merge-reports` command, generates native HTML and JSON reports, and reconciles native file/title/project identities plus every retry index and outcome against the canonical Deadpan inventory. Matching totals are not sufficient: substituting a different test while preserving counts fails closed.

The canonical output contains:

```text
forgeqa-merged/
  complete.json
  report.json
  junit.xml
  summary.md
  index.html
  artifact-manifest.json
  artifacts/
    shard-<index>-of-<total>/
  native-blob-reports/
  playwright-report/
    index.html
    results.json
```

Application or strict-policy failures still produce evidence and return exit code `1`. Missing, corrupted, tampered or contradictory evidence returns `3`. Successful, complete and policy-compliant runs return `0`.

## Local inspection

Run:

```bash
forgeqa report serve forgeqa-merged
```

The server binds only to `127.0.0.1`, does not expose directory listings, refuses path traversal and symbolic-link targets, sends no-store and browser-hardening headers, and serves the static report without a Deadpan account, CDN or tracking service. `FORGEQA_SERVE_PORT` may select a local port; `0` requests an ephemeral port for automated tests.

## Acceptance evidence

The repository acceptance suite includes a real Chromium run split into two native shards. One synthetic case fails on its first attempt and passes on its only diagnostic retry. The strict gate remains nonzero while the merged package retains and verifies the failure screenshot, trace, checksums, native Playwright report and canonical Deadpan report. Separate adversarial tests cover changed and missing attachments, traversal, symbolic links, duplicate artifact paths, multiple blob archives, corrupted blob merging and same-count native identity substitution.
