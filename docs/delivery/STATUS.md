# Delivery checkpoint — executable first consumer

**The first real consumer path is exercised; the complete ForgeQA product is not released.**

The recorded source checkpoint is `e9f4bf76337813d442f57fc054df5cef9f1cfac3`. [CI run 36275624740](https://github.com/azerish25-ux/playwright-quality-platform/actions/runs/36275624740) provides the job and artifact evidence below. Statuses describe observations at this checkpoint; subsequent changes require their own exact-SHA checks. In particular, do not treat this file as a perpetual green badge.

## Verified behavior

- Real config-driven Playwright discovery/execution, typed composable fixtures, strict native and CLI gates, journal/finalization integrity and canonical JSON/JUnit/Markdown/HTML output.
- All six foundation jobs: Node 22 and 24 on Linux, Windows and macOS. The same tests repeated across environments are not counted as different test cases.
- PostgreSQL-backed TeamBoard: eight API cases plus four UI journeys in each of Chromium, Firefox and WebKit. All 20 executions passed on their first attempt.
- The same TeamBoard identity set passed from the workspace and separate npm/pnpm tarball consumers, with no provider-source links. These are three installation modes, not 60 unique tests.
- A real post-workspace database scan found zero remaining test namespaces, tenants and accounts. The follow-up harness also asserts this independently after each packed consumer.
- Independent npm/pnpm Chromium onboarding and typed imports passed on Linux, macOS and Windows. Windows Chromium onboarding also passed; the overall CI run and aggregate gate succeeded.

Report paths, hashes, tested revision, identity sets and artifact checksum are in [first-consumer-evidence.json](first-consumer-evidence.json). GitHub artifacts expire after seven days; their download URLs are not public report websites.

## Dependency repair

The pnpm 10.34.5 candidate and its real generated npm/pnpm lockfiles were produced by [read-only maintenance run 36275624704](https://github.com/azerish25-ux/playwright-quality-platform/actions/runs/36275624704). Its `npm audit` result contains zero reported vulnerabilities; the exact result is [dependency-audit.json](dependency-audit.json). This is a dated advisory-database result, not proof that the software has no vulnerabilities. The update is pinned in the workspace and generated templates, and ordinary CI now enforces the high/critical audit threshold.

## Explicit remaining boundaries

Distributed execution is not implemented by the CLI/native bridge; shard totals above one are rejected rather than silently dropping coverage. The pure merge utilities remain separately tested. Full history import, diagnostic repetition, quarantine mutations, safe privileged PR publication and released GitHub Action distribution remain later milestones.

LedgerGuard has an executable foundation, but the inspected revision lacks the required product-facing authentication/payment/UI integration. No fake second application is substituted. No npm publication, standalone Action tag, Marketplace listing or documentation website deployment is claimed.

The 90/85 runtime coverage thresholds, distributed benchmarks, complete generic fixture lifecycle/property coverage and full release hardening remain unverified. Source-candidate tarballs are not published packages. See [requirements.json](requirements.json) for scoped statuses and [defects.md](defects.md) for the repaired defects and regression evidence.
