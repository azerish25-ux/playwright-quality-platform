# Fixtures, APIs and owned data

## Extend the native interface

<!-- forgeqa:include docs/snippets/fixtures.ts -->

`createForgeTest` adds a worker-scoped `forge` context containing `runId`, `namespace` and resolved configuration. The native callable test, `extend`, annotations, hooks and assertions remain available. Browser diagnostics are added only when a test requests `page`; an API-only case does not launch a browser.

## Deterministic values, distinct physical resources

<!-- forgeqa:include docs/snippets/public-api.ts -->

The factory's logical values derive from the factory name, seed, logical test ID and sequence, not the worker count. Use the namespace when constructing a unique physical resource key. Do not confuse reproducible logical values with permission to share one mutable account between concurrent tests.

The in-memory cleanup example illustrates ownership only. A real adapter must perform application-authorized cleanup and report failures. `CleanupRegistry.run()` returns failures instead of throwing them automatically: inspect that array and fail teardown when cleanup is incomplete. The PostgreSQL reference adapter and TeamBoard lifecycle show real database ownership checks.

## Authentication and roles

Provision credentials through a consumer-owned adapter. Scope mutable accounts to the test or worker isolation contract, and make every resource carry its owner namespace. Treat browser storage state as a secret: keep it temporary and exclude it from reports and source control. Do not claim generic auth-state reuse or crash reclamation is fully verified; the hardening ledger retains incomplete cases.

## HTTP and cancellation

`ForgeHttpClient` confines requests to its configured origin and rejects redirects. Supply deadlines and cancellation signals. A non-idempotent write is not automatically retried; explicit idempotency and an idempotency key are required before multiple attempts are allowed. Domain validation still belongs to the consumer.

## Flags, networks, clocks and files

Use native Playwright fixture teardown to restore route handlers, feature flags and browser-clock overrides. Browser clock manipulation does not change backend time. Restrict upload/download destinations to owned temporary directories and verify cleanup. These are integration responsibilities, not a claim that ForgeQA already exposes dedicated adapters for every application.
