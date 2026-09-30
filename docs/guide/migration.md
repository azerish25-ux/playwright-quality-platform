# Adopt without rewriting an existing suite

## Establish the baseline

Record the current command, Playwright version, test/project identity inventory, retry policy and result. Keep the existing lockfile, selectors, assertions, application start command and database lifecycle. Run the original suite before changing imports.

## Stage, then review

Run `forgeqa init --template existing --destination` against a new review directory. This produces a proposed configuration rather than editing an existing suite in place. The CLI's all-conflict preflight refuses overwriting an occupied configuration. Move only reviewed changes into the application.

Use `defineForgePlaywrightConfig` around your native settings and `createForgeTest` around your native base fixture. Retain your actual `testDir`, project names, readiness and role/account adapters. The [fixture example](fixtures.md) preserves the callable native interface; it does not provision users for your application.

## Preserve identity and execution

Run native discovery and `forgeqa plan --suite release --json` after the change. Compare **logical identity, browser/project and environment**, not only counts. Introduce explicit stable annotations where a test is intentionally renamed. Unknown changed areas should broaden selection rather than omit tests.

Exercise both `playwright test` and `forgeqa run`. Their policy evaluation must agree: retry recovery is still flaky; missing evidence is still an integrity failure; quarantine must not remove a test. Do not reduce the baseline browser matrix to make migration pass.

## Separate adoption from application implementation

Deadpan may add owned fixtures, tests, dependencies and workflow integration. It must not silently change business rules or replace a missing interface with a test-only mock. LedgerGuard's current integration remains [explicitly API-first](../ledgerguard-consumer.md).

## Rollback and diagnosis

Keep the original command available while reviewing the migration. A rollback restores only the Deadpan adoption changes, not application history or data. Preserve failed reports and exact package checksums so a maintainer can reproduce the discrepancy. See [troubleshooting](troubleshooting.md).

## Executed adoption contract

The required integration suite runs an original native Playwright suite before
adoption, then both adopted native and Deadpan CLI entrypoints. It compares the
complete path/title/project/tag inventory and canonical identities, not just
counts. The fixture includes a non-default test directory, custom worker and test
fixtures, dependency setup projects, inherited metadata, before/after hooks, and
multiple projects. App source, assertions and native settings remain byte-for-byte
unchanged. Initialization into the occupied suite must report conflicts without
writing any file; scaffolding into a separate review directory must succeed.

Run `node --test tests/integration/existing-suite.test.mjs` after building. This
bounded migration fixture does not establish compatibility with every arbitrary
application. Preserve and explicitly check your suite's own identity inventory.
In particular, the CLI selects configured suite tags; an untagged existing test
will not automatically belong to `smoke`, `regression` or `release`. Assign and
review membership before comparing the CLI run with an unfiltered native run.
