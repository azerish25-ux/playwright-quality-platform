# Release readiness — candidates are not public releases

The interrupted implementation is retained on `main`, not replaced with a new scaffold:

| Source commit | Implemented behavior |
| --- | --- |
| `c2687f515e2075bafff3fcfc20896d53734dec07` | Interleaved serial/two-worker/four-worker benchmark on one runner, warm-ups, identical inventories, canonical/native reports and cleanup checks. |
| `1d8b28a775a91a6b0b778630cf656262029bc1e5` | Complete-tarball SHA-256/SHA-512 staging, installed npm/pnpm audit binding, recovery state machine and promotion guards. |
| `d5bdf5858a1e70a4e080ab2188c9f2c643e04fb5` | Concurrent CLI initialization, late conflict refusal and interruption/resumption regressions. |
| `a21432dbf42995322f8bd20d2961361368a10029` | PostgreSQL target verification, ownership checks and literal-prefix stale reclamation with real database acceptance. |

Full [CI run 36487423852](https://github.com/azerish25-ux/playwright-quality-platform/actions/runs/36487423852) passed at `a21432dbf42995322f8bd20d2961361368a10029`. That source is the baseline for the additional candidate gate described below, not proof that later changes have passed hosted acceptance.

## Hosted acceptance

The additional source gate passed at `c8304873cfce584f352eca69d7ccae068fd3e3b1` in CI `36494379888`, Documentation `36494380027` and Release candidates `36494379998`. All eight downloaded tarballs and the source receipt were independently verified. See [exact acceptance](release-readiness-live-acceptance.md); this does not authorize publication or close the remaining boundaries below.

## Exact-source candidate gate

The read-only `Release candidates` workflow builds and verifies source, runs hardening, stages all eight packages and checks their complete tarballs. `scripts/release-evidence.mjs` then queries GitHub for successful `main` push runs of both `CI` and `Documentation` at the candidate SHA.

It requires all fourteen named CI jobs and the documentation job, bound to the selected run and attempt. Missing, duplicate, unexpected, failed, skipped or canceled jobs cannot satisfy it, even if an aggregate reports success. The newest matching run is authoritative; an older green run cannot replace a newer failed run. A second inventory read detects reruns started during inspection. Pagination and responses are bounded; incomplete data or denied permissions fail closed.

The candidate directory is independently checked before and after workflow verification. The retained `source-acceptance.json` binds the source SHA, version, full manifest digest and workflow/job IDs. Failure also leaves a non-passing receipt. This is point-in-time source acceptance: it is not a permanently valid authorization to publish or evidence of registry availability.

The GitHub read token is supplied only to this verification step, not to package installation, test processes or the tarball builder. There are no write permissions or publication commands. Successful receipts retain `publicationAuthorized: false`.

## Local verification

```sh
node --test tests/release-*.test.mjs
node scripts/static-check.mjs
```

The new source-gate and state-boundary tests run in the ordinary platform unit suite. Recovery tests use explicitly synthetic transports, not a claimed npm publication. Publication authorization must be a boolean, manifest fields must have their declared types, contradictory verification states are rejected, and prerelease versions cannot be promoted as stable.

## Remaining release blockers

The controlled benchmark compares local worker counts only. Distributed hardware comparability and separate readiness/reporting/shutdown timing remain incomplete; `fullBenchmarkAcceptance` remains false. The generic authentication-state and fixture override/lifecycle acceptance remains partial. Neither a successful candidate build nor the newer database and initialization tests close those broader requirements automatically.

The semantic-release coordinator, lockstep preparation and owned-loopback-registry recovery passed [Phase 12A acceptance](release-engine-live-acceptance.md). Process-local authentication and recoverable fixture behavior subsequently passed [scoped lifecycle acceptance](fixture-lifecycle-live-acceptance.md). Generic hard-termination authentication/private-file reclamation remains incomplete. Live public registry authorization, public publication/recovery, both consumers against actually published versions, an immutable public action release and major alias, documentation deployment and the final audit remain unaccepted. Do not promote `latest` or turn these source/candidate receipts into public release claims.

The [scoped matrix](release-readiness-requirements.json) supplements, rather than silently overrides, the [broader requirements](requirements.json) and [previous checkpoint](STATUS.md).
