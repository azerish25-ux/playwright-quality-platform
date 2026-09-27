# Distributed evidence integrity

ForgeQA treats a distributed run as complete only when both of its evidence representations agree:

1. the finalized ForgeQA shard journals, which provide stable identities, inventory reconciliation and policy inputs; and
2. Playwright blob reports, which preserve native test events and attachments for supported report merging.

`forgeqa report merge` accepts finalized `attempts.ndjson.final.json` files. For every shard it verifies the journal checksum, the `shard-complete.json` marker, run and shard dimensions, every captured attachment's path, regular-file status, size and SHA-256, and exactly one non-empty Playwright blob ZIP. Absolute paths, traversal, symbolic links, duplicate captured paths, changed files and mixed run dimensions fail with infrastructure exit code `3`.

The command copies captured files into shard-namespaced destinations, preserves the original blob ZIPs, invokes Playwright's supported `merge-reports` command, generates native HTML and JSON reports, and reconciles native test, attempt, outcome and project counts against the canonical ForgeQA result. A disagreement fails closed rather than publishing conflicting reports.

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

Application failures still produce evidence and return exit code `1`. Missing, corrupted or contradictory evidence returns `3`. Successful, complete and policy-compliant runs return `0`.
