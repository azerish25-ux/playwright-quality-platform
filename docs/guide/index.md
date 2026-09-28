# Reusable test infrastructure, not another test runner

ForgeQA adds owned test data, stable identities, complete shard evidence, accountable quarantine and shared quality policy to **native Playwright Test**. Keep Playwright's locators, assertions, projects and browser tooling.

## Start with a clean consumer

Follow the [source-candidate quickstart](quickstart.md), then [migrate an existing suite](migration.md). The examples are compiled and exercised from isolated npm and pnpm installations of all eight packed public packages. No workspace resolution is accepted as proof of installation.

## Read evidence before claims

The [delivery checkpoint](../delivery/STATUS.md) distinguishes implementation, exact-source hosted acceptance and release publication. [Benchmark results](benchmarks.md) report identical inventories without inventing speedup on heterogeneous machines.

The current channel is **next (unreleased)**. Version `0.1.0` in a package manifest is a source-candidate version, not proof of npm publication. There are no public release snapshots in the version selector yet.

## What this platform does not do

ForgeQA is not a hosted dashboard, a proprietary browser engine, an authentication service or an AI test generator. It cannot infer a consumer's tenant ownership, authorization rules or rollback policy. A passing platform job does not certify an arbitrary production application.

## Choose a path

| Task | Read |
|---|---|
| Adopt without copying the monorepo | [Quickstart](quickstart.md) |
| Preserve existing test semantics | [Migration](migration.md) |
| Extend fixtures and own data | [Fixtures and adapters](fixtures.md) |
| Understand failures and retries | [Report interpretation](reports.md) |
| Run on several machines | [Distributed evidence](../distributed-evidence.md) |
| Review actual applications | [TeamBoard](../first-consumer.md) and [LedgerGuard](../ledgerguard-consumer.md) |
| Maintain the distribution | [Release maintenance](releases.md) |
