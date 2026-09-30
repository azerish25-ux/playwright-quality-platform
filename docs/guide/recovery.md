# Recovering after a worker crash

Deadpan records ownership before acquiring a recoverable resource. Normal fixture teardown still runs first. After forced process termination, a separate `forgeqa recovery` process can reclaim abandoned private files and resources managed by explicitly registered adapters. Recovery never changes a failed or interrupted test result into a passing result and never reuses recovered login credentials.

## Scope and safe defaults

The built-in protocol is **same-host, same-PID-namespace recovery with a surviving private filesystem journal**. On Linux the host fingerprint includes the boot ID and PID namespace. A PID that is alive, inaccessible or reused is preserved even after the minimum grace period; a missing PID alone cannot authorize cross-host cleanup. The default acquisition grace is 30 seconds. An explicitly closed journal can be recovered without waiting because the owner has declared that all dependent use has stopped.

This is not distributed lease fencing or lost-runner recovery. If an ephemeral runner and its journal disappear, remote resources require an independently retained, authorized ownership catalog and external liveness authority. The PostgreSQL adapter's existing guarded `reclaimStale` remains available for separately authorized stale cleanup; it is not a substitute for proving that an active run is finished.

The default journal root is private and outside the project, under the canonical OS temporary directory. Set `FORGEQA_RECOVERY_ROOT` or supply an explicit `root` to retain it on a private volume. Do not upload the root as an artifact: it includes authentication storage files. `.forgeqa/recovery/` is ignored, but a path outside report/artifact roots is preferable. POSIX directories use 0700 and records/files use 0600; Windows relies on the user's private temporary-directory ACL. Network filesystems, cross-user sharing and hostile processes running as the same OS user are not supported trust boundaries. Publication handles process crashes, not a guarantee against power loss or storage failure.

## Inspect before applying

```sh
forgeqa recovery --root /private/forgeqa-recovery --dry-run --json
forgeqa recovery --root /private/forgeqa-recovery --apply --consumer teamboard --namespace exact-owner --json
```

These are command-shape examples: replace the root and exact ownership filters with your configured values. Omitting both mode flags means dry-run. `--apply` and `--dry-run` together are invalid; boolean flags accept no value. Recovery rejects unrelated execution flags such as `--workers`.

Use `--max-owners` (1–1000, default 100), `--timeout-ms` (1–60000, default 5000) and `--budget-ms` (1–300000, default 60000) to bound inspection and cleanup. Limits do not turn a partial scan into a complete one. JSON contains schema version, mode, scanned/reclaimed counts, completion information and sanitized per-owner/resource events. It does not contain cookies, tokens, callback errors, filenames or executable code. Unknown adapters, corrupt metadata, incomplete scans, unverifiable foreign-host owners, busy claims and cleanup failures return exit 3. Active owners and owners still inside their grace period are reported and left intact.

## Public resource protocol

`RecoveryJournal.create({runId, consumer, namespace}, {root, graceMs})` creates an immutable owner identity. Use `reserve({adapter, target, key})` **before** issuing the acquisition request. Wrap acquisition in `journal.acquire(record, operation)`. Persist the returned journal owner ID on the remote resource, or derive its physical key from that ID; a reused logical namespace alone is not ownership proof. If the remote write succeeds but its response is lost, the already-persisted descriptor still identifies the owned operation.

A trusted `RecoveryAdapter` has an ID, an exact target and an idempotent `reclaim(record, owner, signal)`. It must independently verify the actual target and the resource's owner ID, use bounded/cancellation-aware operations, and refuse foreign or borrowed resources. Never reconstruct a disposer by evaluating code, paths or URLs from metadata. Supply credentials to the trusted adapter through its normal private configuration, not through a recovery record.

For normal cleanup, call `journal.dispose(record, adapter, signal)`. It acknowledges only successful cleanup. Use `complete(record)` only after independently successful cleanup; it is not a deletion method. After every dependent fixture has finished, close the journal. In-flight acquisition/disposal prevents retirement. Failed cleanup records remain available for retry; completed resource acknowledgments make recovery idempotent.

`recoverResources({root, apply, adapters, consumer, namespace})` exposes the same protocol without the CLI. For CLI adoption, explicitly select a trusted `.mjs` or `.js` module exporting an array named `recoveryAdapters`:

```sh
forgeqa recovery --root /private/forgeqa-recovery --adapter-module ./recovery-adapters.mjs --apply --json
```

The explicit module is trusted application code and runs even during dry-run to construct adapters. Modules must not mutate resources during construction. Journal records cannot choose or load modules.

## Authentication, files and PostgreSQL

`OwnedFiles` and the native `forgeFiles` fixture now allocate stamped directories inside ownership journals. Authentication storage export uses the same mechanism automatically. Directory allocation is reserved before `mkdir`; a crash before its identity stamp permits removal only while the allocation is still empty. Replaced roots, directory identity changes, unsafe names and symlink/multiply-linked metadata fail closed.

An authentication adapter may provide `recovery: {adapter, key(identity, owner)}`. Its `authenticate` method then receives a fourth `AuthenticationRecoveryContext` argument with the durable `owner` and `record`. The application must write that owner ID at resource creation and verify it on cleanup. Existing three-argument authentication adapters remain compatible. Do not add deletion recovery for pre-existing accounts, LedgerGuard's seeded administrator or borrowed TeamBoard users. Existing consumer context/session teardown remains in place; this milestone does not claim lost-runner reclamation of the consumers' entire infrastructure.

`GuardedPostgresAdapter.provisionRecoverable(journal)` reserves before its INSERT and returns `{provision, record}`. Its physical namespace is `forgeqa-<journal UUID>`, so even identical logical run/consumer/namespace labels do not share mutable tenants. Register `adapter.recoveryAdapter()` for replay against that exact authorized database. Database identity, parameterized SQL, exact namespace matching and affected-row checks remain enforced. No application-wide deletion is introduced.

## Claims and failure evidence

Reclaimers acquire append-only claim generations. A live claimant's claim is never removed or stolen because of an old timestamp. A fresh process can resume after confirmed claimant death; failed or partial cleanup retains its descriptors. If a cleanup deadline expires while its callback is still executing, its claim remains held. Arbitrary JavaScript or an already-sent remote write cannot be forcibly cancelled by a timeout; adapter idempotence and owner verification are required.

The required test suite includes forced termination after state export, death between server acquisition and response, active-neighbour protection, colliding logical identities, a killed reclaimer, dry-run/idempotence, corrupted metadata and path redirection. Installed npm/pnpm consumers execute the public CLI against separately killed owner processes. The required PostgreSQL lane exercises real SQL recovery without replacing real application tables. See the [scoped recovery ledger](../delivery/crash-recovery-requirements.json) for implemented versus hosted-verified acceptance and remaining boundaries.
## Database-authoritative recovery when a runner disappears

`DurablePostgresAdapter` from `@azerish25-ux/forgeqa-test-data` adds an opt-in
reference contract for an authorized `forgeqa_test` PostgreSQL database. An owner
lease and its tenant are durable database rows, so reclamation needs neither a
runner's disk journal nor its PID/hostname. This is separate from the local-file
recovery contract above.

Apply the exported `DURABLE_POSTGRES_SCHEMA` explicitly with a migration role.
Give the runtime role only the documented table privileges and schema usage;
the adapter never installs schema or grants permissions. Keep database
credentials out of lease identities and evidence. Use a dedicated test database,
not production data. Example after the authorized migration:

```ts
import { DurablePostgresAdapter } from '@azerish25-ux/forgeqa-test-data';

const adapter = new DurablePostgresAdapter(sqlExecutor, 'forgeqa_test_team');
const owner = await adapter.createOwner({
  consumer: 'teamboard', namespace: 'nightly', runId: 'run-123'
}, 60_000);
const tenant = await adapter.provision(owner);
// Await successful renewals well before expiry while doing owned work.
await adapter.renew(owner, 60_000);
await adapter.close(owner);
// A separate trusted runner can inspect or reclaim expired exact-scope owners.
await adapter.reclaimExpired({ consumer: 'teamboard', namespace: 'nightly' });
await adapter.reclaimExpired({ consumer: 'teamboard', namespace: 'nightly', apply: true });
```

The PostgreSQL server clock decides expiry. Row locks serialize provisioning,
renewal, close and reapers. Expired owners cannot renew or provision, and sealed
owners are never resurrected. Reclamation seals ownership and deletes only its
tenant in one atomic statement. Concurrent reapers skip locked owners; repeat a
bounded scan to continue after an in-flight transaction finishes. The default
is a nonmutating preview. Both consumer and namespace filters are exact, and
scans are limited to 100 owners by default (maximum 1,000).

On a renewal error, stop owned work and create a fresh owner after connectivity
is restored. Do not continue using a stale handle. Database unavailability is
an error, not proof of a clean scan. Tombstones are retained intentionally; their
administrative retention is outside runtime reclamation.

This reference fences its own leased-tenant operations. It does not fence raw
application SQL, external account/API writes, borrowed users, or browser storage
files. Those resources need their own atomic authority contract; merely placing
a timestamp beside an account does not make deletion safe. Cross-connection and
hard-killed-process acceptance is required in the TeamBoard CI lane; passing it
does not claim that arbitrary external systems share the same authority.
