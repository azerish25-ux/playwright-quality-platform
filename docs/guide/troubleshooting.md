# Troubleshooting

## Configuration or usage exits with 2

Check the first error before starting the application. Unknown options, unsafe output paths, out-of-range workers/retries and unsupported browser names are refused. Arrays replace rather than concatenate. Run `forgeqa doctor --json` from the consumer directory; it verifies installed components, not remote application business health.

## Installed CLI cannot resolve a package

Confirm all eight candidate tarballs came from one exact source artifact and matching version. Reinstall with the consumer lockfile. For pnpm, internal candidate dependencies require overrides pointing to the same tarballs. Do not repair adoption by importing `packages/*/src` or adding a workspace symlink. The clean-consumer lane checks this boundary.

## Browser executable is missing

Install binaries through the same Playwright package that executes the tests. An API-only job does not need Chromium. A job that includes UI projects must not skip its browser installation or change its inventory merely to pass doctor.

## A retry passed but quality failed

This is intentional under the default policy. Inspect the original failure and retained trace; increasing retries or hiding the test is not a repair. Quarantine requires accountable metadata and expiry and does not make a failure non-blocking.

## Distributed merge exits with 3

Supply one immutable manifest and every finalized shard record, including completion markers, journals, attachments and native blobs. Verify matching run/config/selection identities. Do not pass an obsolete top-level merge command or only the journal filename. The supported contract is described in [distributed evidence](../distributed-evidence.md).

## A PR comment is absent

The trusted publisher may reject stale evidence, a changed CI workflow, missing/expired artifacts or insufficient comment permission. The originating CI conclusion remains authoritative; absence of a comment never means success. See the [GitHub trust model](../github-action.md).

## A docs build fails

Run the strict build and the built-site link checker separately. Broken anchors, missing included snippets, untracked snapshot files, modified frozen hashes and stale public declaration paths are build defects. Repair the source rather than disabling strict mode. External GitHub links are source-pinned but are not certified HTTP-live by the offline link checker.
