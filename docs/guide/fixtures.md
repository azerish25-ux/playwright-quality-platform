# Fixtures, APIs and owned data

## Extend the native interface

<!-- forgeqa:include docs/snippets/fixtures.ts -->

`createForgeTest` adds a worker-scoped `forge` context containing `runId`, `namespace` and resolved configuration. It also provides lazy, test-scoped `forgeScope` and `forgeFiles` fixtures. The native callable test, typed `extend`, annotations, hooks and assertions remain available. Browser diagnostics are added when a test requests `page`; an API-only case does not launch a browser. For explicitly created pages use `withBrowserDiagnostics`.

## Deterministic values, distinct physical resources

<!-- forgeqa:include docs/snippets/public-api.ts -->

The factory's logical values derive from the factory name, seed, logical test ID and sequence, not worker count. Use the namespace for unique physical resource keys. Reproducible logical values do not permit sharing mutable accounts between concurrent tests.

## Failure-safe resource ownership

`ResourceScope` from the core package registers owned disposers with `defer`. Disposers run in reverse registration order, each with an explicit deadline and an `AbortSignal`. Cleanup continues after an individual failure. Concurrent `close()` calls share the same completion. Registrations after closure are rejected.

Use `ownResource(scope, id, acquiredResource, dispose)` immediately after acquisition, before login, validation or other fallible setup. If acquisition finishes after scope closure, this helper disposes the late resource instead of leaking it. Use `withResourceScope` around setup and use: it preserves both the original error and every cleanup error, including non-Error throws.

`CleanupRegistry` retains its ownership checks and public result shape. `run()` returns failures rather than throwing automatically: inspect that array and fail teardown when cleanup is incomplete. Entries may override the registry's default 5-second cleanup deadline. Overlapping `run()` calls await one operation; a later completed call retains the historical zero-work result.

A deadline bounds waiting and requests cooperative cancellation. JavaScript cannot forcibly terminate an arbitrary promise or guarantee that a remote service rolled back a timed-out write. Adapters must use cancellation-aware clients, native request timeouts, and recoverable ownership records. Do not represent a timed-out cleanup as successful.

## Authentication and roles

The public `AuthenticationAdapter<Session>` contract provides `authenticate(identity, scope, signal)`, actual `validate(session, identity, signal)`, and optional Playwright `storageState` export. Application-specific provisioning, roles and session behavior stay in the consumer. Register acquired contexts and owned accounts immediately; validation must check the actual identity/role, not only elapsed time.

`withAuthentication` provides test-scoped adoption with cleanup on setup failure, invalid authentication, callback failure and normal completion. `AuthenticationManager` supports explicit `reuse: 'worker'` when the consumer guarantees safe account isolation. Default reuse is `none`. Worker reuse serializes the entire same-key lease, so another test cannot invalidate a session while a lease uses it. Avoid re-entering the same manager/key inside its callback; that creates a dependency cycle.

Keys include adapter, application, environment, role, project, non-secret configuration hash, namespace, run, shard, parallel slot, worker-process index, and optional test/attempt identity. Mutating parallel workers require independently owned users or tenants. Changing worker index changes the key. Every reuse checks expiry, exported-state integrity when present, and the actual session. Validation infrastructure failures are propagated, not silently retried as logins.

Storage state is a credential. ForgeQA exports it into a private OS temporary directory, with complete-file publication, a checksum-bound metadata record, and 0600 files/0700 directories on POSIX. Windows relies on the current user's temporary-directory ACL. Files are outside the normal test/report artifact tree and removed during normal/recoverable teardown. Never attach the returned path or its contents to public reports.

The manager coordinates within one worker process; it does not share state files between processes or revive state left by a crashed process. Forced termination cannot run teardown. Application-owned stale-resource reclamation and a broader cross-process authentication recovery protocol remain separate acceptance work. The existing PostgreSQL stale-resource guards are not proof of generic authentication crash reclamation.

Concrete adapters are in [TeamBoard](../../examples/demo-saas/tests/adapters.ts) and [LedgerGuard](../../consumers/ledgerguard/tests/authentication.ts). TeamBoard validates the user and owned workspace role. LedgerGuard retains real CSRF renewal and `/auth/me` identity/role validation. The seeded LedgerGuard administrator is borrowed rather than deleted; the outer consumer harness owns infrastructure cleanup and reconciliation. TeamBoard's UI authentication tests remain genuine UI tests.

## HTTP and cancellation

`ForgeHttpClient` confines requests to its configured origin and rejects redirects. Supply deadlines and cancellation signals. Non-idempotent writes are not automatically retried; explicit idempotency semantics and a key are required before multiple attempts are allowed. Domain validation belongs to the consumer.

## Flags, networks, clocks and files

`withFeatureFlags` requires a tenant-scoped adapter. It reads a complete snapshot, registers restoration before mutation, and restores the exact snapshot after success or failure. Global mutation and overlapping same-tenant mutation in one process are refused. Use run-owned tenant namespaces across processes; this is not a distributed lock. A replacement operation must remove flags absent from the supplied snapshot. Cancellation-aware adapters must prevent late writes from racing restoration.

`withNetworkRoutes` installs only explicit opt-in handlers, counts their expected interceptions, and removes only those handlers afterward. It does not remove unrelated consumer routes. Use it to test override behavior, not to mock a product operation and claim real application acceptance. The isolated fixture-contract browser suite verifies that the real server response is visible again after restoration.

`withClockPage` owns a fresh browser context/page, installs the supported Playwright clock and closes that context after use or failure. It does not alter an existing page's clock or backend time. Pass the intended context options, such as `baseURL`; consumer fixtures and authentication are not implicitly copied into the new context. TeamBoard verifies that the displayed overdue status changes while the persisted backend due date does not.

`forgeFiles` provides `write`, `read`, and `saveDownload`. It creates its own private directory, never accepts an arbitrary deletion root, rejects unsafe/Windows-reserved filenames and path traversal, rejects symlink/multiply-linked reads, checks root identity, and enforces byte limits. Writes publish complete files without replacing existing paths. The default size budget is 10 MiB with an explicit maximum of 64 MiB. `saveDownload` streams through a byte limit and deadline, cancels failed downloads, and removes partial files. Teardown waits for in-flight operations and removes only the owned directory. This protects ordinary consumer mistakes and untrusted filenames, not a malicious process running as the same OS user and racing every filesystem operation.

## Verification and acceptance boundary

Run `npm test` for focused unit failures and `npm run test:integration` for native worker restart and failure propagation. The existing `npm run test:consumers -- template` path compiles and executes six additional fixture-contract browser cases through clean npm and pnpm installations. These cases are separate from the established demo/TeamBoard product inventories. The TeamBoard product suite uses the actual authentication/flag/file/clock adapters; LedgerGuard uses the actual session adapter in its independent consumers.

The [scoped requirements](../delivery/fixture-lifecycle-requirements.json) distinguish local implementation evidence from exact-source hosted acceptance. No npm publication, release promotion, or complete hard-termination acceptance is implied.

## Post-crash recovery

Private files and exported authentication state now have durable pre-acquisition ownership journals. See [crash recovery](recovery.md) for same-host recovery, explicit trusted adapters, dry-run/apply commands, active-run protection and the lost-runner boundary. Existing normal teardown remains mandatory.
