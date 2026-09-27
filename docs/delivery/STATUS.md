# Delivery checkpoint — distributed evidence integrity

**ForgeQA now has executable distributed Playwright sharding and a candidate end-to-end evidence pipeline; the complete ForgeQA product is not released.**

The last merged source checkpoint before this hardening change is `0c0b82b4d8094510c8542f33e70e5c4d42ee5de2`. Its pull-request verification run, [CI run 36289243937](https://github.com/azerish25-ux/playwright-quality-platform/actions/runs/36289243937), passed the six Linux/macOS/Windows Node 22/24 verification jobs, three independent packed-consumer jobs, the PostgreSQL TeamBoard three-browser lane and the aggregate gate. Its subsequent push run exposed a real WebKit logout/login race; the current source repairs that race and adds further evidence hardening. Treat these statements as a dated checkpoint, not a perpetual green badge. The current changes require their own exact-SHA CI before delivery is claimed.

## Implemented behavior

- Immutable planning and genuine native Playwright shard execution with strict expected-inventory reconciliation.
- One finalized ForgeQA journal and one Playwright blob report per shard.
- Fail-closed validation of run/shard identity, completion markers, journal checksums, captured artifact paths, regular-file ownership, size and SHA-256.
- Collision-safe copying of screenshots, traces, videos, logs and attachments into shard-namespaced merged output.
- Playwright `merge-reports` generation of native HTML and JSON evidence.
- Exact native/canonical reconciliation by file, title, project, retry index and outcome; matching totals alone are insufficient.
- Canonical JSON, JUnit, Markdown and static HTML reports, artifact manifest and checksummed completion record.
- Loopback-only local report serving with traversal, symlink, method, MIME, cache and browser-hardening controls.
- Real two-shard Chromium diagnostic acceptance retaining screenshot and trace bytes while a retry-recovered failure remains a strict nonzero quality result.
- Adversarial regression coverage for changed, missing, escaping, duplicate and symbolic-link attachments; multiple or corrupted blobs; and same-count test-identity substitution.
- PostgreSQL-backed TeamBoard API and Chromium/Firefox/WebKit UI journeys, including deterministic account transitions and owned-data cleanup.

The detailed milestone matrix is [distributed-evidence-requirements.json](distributed-evidence-requirements.json). The older broad matrix remains useful for product-wide scope but predates distributed evidence completion.

## Failure semantics

- Exit `0`: complete, internally consistent and policy-compliant evidence.
- Exit `1`: complete evidence with an application or quality-policy failure.
- Exit `2`: invalid usage or configuration.
- Exit `3`: missing, corrupt, tampered, incomplete or contradictory evidence.
- Exit `130`: interrupted execution.

Report generation cannot turn a failed application test green. Conversely, a failed test does not suppress collection of the evidence needed to diagnose it.

## Explicit remaining boundaries

- Historical artifact import, bounded trusted baselines, diagnostic repeat and quarantine mutation workflows remain Phase 7 work.
- The standalone GitHub Action distribution is not yet published or verified through an immutable external tag.
- LedgerGuard is not yet a functioning second consumer of released ForgeQA packages.
- npm packages are source candidates, not registry releases; npm ownership and publication authorization are not assumed.
- The versioned documentation website, maintained 90/85 runtime coverage gates, comparative distributed benchmarks and complete release hardening remain unverified.
- No Marketplace listing, npm publication or production-ready status is claimed.
