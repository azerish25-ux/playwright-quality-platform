# Architecture

```text
consumer config/tests
        |
        v
 forgeqa-cli / native Playwright
        |
        +--> core contracts, identities, selection, gates
        +--> fixtures: API, data, cleanup, adapters
        +--> per-attempt journal + per-shard final record
                              |
                              v
                  strict deterministic merger
                              |
                 JSON / JUnit / Markdown / HTML
                              |
                     history + comparisons
```

`core` is the foundation and has no application, database, Playwright, or GitHub dependency. API and test-data adapters depend only on public core contracts. Reporter and flake analysis consume normalized data-only records. The CLI composes public packages; package code never imports examples. Privileged GitHub publishing must process only schema-validated data and must not execute code from untrusted report artifacts.
