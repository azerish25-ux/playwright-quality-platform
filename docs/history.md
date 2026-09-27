# History and reliability

ForgeQA stores immutable, checksummed per-run history records under a manifest-controlled directory. Imports accept either `history-record.json`, `report.json`, or a directory containing one of those files. A stable identity derived from repository, run ID, tested commit and provenance makes identical re-imports idempotent; the same identity with different result bytes is an integrity failure.

History is divided into four provenance classes:

- `trusted-default-branch`
- `untrusted-pr`
- `synthetic`
- `diagnostic`

Only trusted default-branch records enter the authoritative baseline unless the caller explicitly requests another provenance. Pull-request, synthetic and diagnostic observations are retained as evidence but cannot silently contaminate the default baseline.

For eligible logical executions, `N` is the completed population expected to pass, `F` is initial failure followed by retry pass, `I` is initial failure, and `P` is persistent final failure. ForgeQA reports `F/N`, `I/N`, `P/N`, and `F/I`, plus observation timestamps, failed-attempt duration, affected browsers/environments, owners and per-test metrics. Missing denominators are `null`; low sample counts remain explicitly insufficient.

Comparable history requires matching result schema, repository, resolved configuration and execution dimensions. The default analysis window is 30 days, at most 50 comparable runs, with 20 eligible executions required before the aggregate rate is marked sufficiently sampled. Incomplete, incompatible, expired-window and untrusted records are counted as rejected observations rather than converted into a zero flake rate.

## CLI

```text
forgeqa history import forgeqa-results --output .forgeqa/history
forgeqa flakes --report forgeqa-results/report.json --output .forgeqa/history
```

`FORGEQA_HISTORY_PROVENANCE` can explicitly select one of the four provenance values. On GitHub pull-request events, the CLI automatically records `untrusted-pr`; otherwise it defaults to `trusted-default-branch`.

Every successful distributed report merge now emits `history-record.json` and includes its checksum in `complete.json`. Failed but complete application runs remain importable; infrastructure-incomplete runs are retained but excluded from comparable reliability cohorts.

## Immutable GitHub Actions reconstruction

The GitHub adapter treats completed workflow artifacts—not caches or runner filesystems—as the source of historical truth. It paginates runs and artifacts, includes eligible failed runs, separates trusted default-branch records from untrusted pull requests, validates ZIP and output checksums, records coverage gaps, and preserves workflow/run-attempt/artifact provenance. See [GitHub Actions history import](github-history.md).

HTML, JUnit, Markdown, and JSON outputs expose N/F/I/P, observation windows, comparable/rejected run counts, per-test ownership and sample sizes, retry-observed and persistent-failure rates, and explicit `NO_BASELINE`, `INSUFFICIENT_HISTORY`, or `HISTORY_INCOMPLETE` states.
