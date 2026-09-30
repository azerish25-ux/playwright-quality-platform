# Coordinated release engine

Deadpan separates source candidates, semantically prepared artifacts, candidate
publication, and stable promotion. A passing dry run is not a public npm release.
The scoped acceptance ledger is [Phase 12A](../delivery/release-engine-requirements.json).

## One version, eight packages

`release.config.mjs` and `scripts/release-version.mjs` invoke the locked
`semantic-release` JavaScript API with the Conventional Commits preset. A `fix`
produces a patch, a `feat` a minor, and `!` or a `BREAKING CHANGE` footer a major
relative to a real previous release tag. Documentation-only commits do not force
a release. Without a prior release, semantic-release's normal initial version is
used; the source manifests' `0.1.0` is not treated as a historical release.

Analysis requires a clean `main` checkout, complete Git history and fetched tags.
It uses disposable local copies of the real history because semantic-release
checks push permissions even in dry-run mode. Neither analysis nor preparation
creates a source tag, fabricates history or needs source-branch write permission.
Generated notes are marked unreleased. Temporary copies are deleted on exit.

Preparation first verifies source tarball bytes against the hardening audit; ignored
build-output changes are rejected. It copies the audited package allowlists into
owned temporary staging,
rewrites all eight versions and internal dependency/peer/optional/dev ranges,
and packs/audits those final copies. Private packages and source manifests remain
unchanged. The final file inventory must match source hardening. Runtime files,
declarations, export targets, CLI executable, license and metadata are checked.
The CLI reads its installed package version, including when generating consumer
configuration; it does not keep a compiled `0.1.0` constant.

## Verification sequence

With `FORGEQA_SOURCE_SHA` set to the checkout's full SHA, the release workflow runs
source verification and hardening, retains the original source candidates, and
requires all fourteen exact-source CI jobs plus independent Documentation.
It then installs the matching Chromium version and runs:

```sh
npm run release:prepare
npm run release:test-registry
```

The first command calculates the version and installs the final eight tarballs in
fresh npm and pnpm consumers. Both bootstrap the **installed** CLI, check its
version and generated dependency versions, compile public fixture composition,
run the real demo's API/UI tests, and verify a native Playwright run. Only those
results can mark the prepared manifest's consumer gates PASS.

The second command publishes all eight actual prepared tarballs using npm against
an owned `127.0.0.1` registry. It interrupts the fourth upload, retains partial
state, independently downloads existing package bytes, resumes the remaining set,
and checks an additional rerun does not republish any version. Fresh npm/pnpm
consumers then install from that registry, not local tarball paths. Separate
regressions cover lost acknowledgement after an accepted PUT, conflicting bytes,
permission/network errors, origin escapes and stale consumer receipts.

This is real npm protocol/CLI testing in an isolated registry. It does **not**
prove npmjs.com publication or npm account ownership. The loopback registry has no
upstream proxy and never accepts non-Deadpan package writes. Normal package reads
for external consumer dependencies still use the public npm registry.

`evidence/release-prepared/` contains the plan and its digest, unreleased notes,
all eight final tarballs, SHA256SUMS, consumer receipts, prepared acceptance and
the scoped registry acceptance. The immutable prepared manifest is kept separate
from mutable publication checkpoints. Existing preparation directories are never
silently overwritten: retain the receipt and use a clean workspace to regenerate.
A no-release decision emits `NO_RELEASE`, not successful publication evidence.

## Authorized candidate publication

Public writes are disabled on pushes and by default on manual runs. The separate
`publish-candidate` job is eligible only when `publish_candidate` is explicitly
selected on a manual run and preparation/registry tests succeeded. It requires:

- Exact-source confirmation and explicit npm-scope/trusted-publisher confirmation.
- The trusted `main` release workflow, GitHub OIDC context and npm 11.5.1 or newer.
- Downloaded prepared artifacts matching the digest from the successful prepare job.
- Reverified exact-source CI/Documentation and complete matching consumer receipts.

Each of the eight public packages must have its real npm trusted-publisher
association configured for this repository's `release.yml` workflow. First
publication/account prerequisites are separate from GitHub repository access;
`npm whoami` is not used as proof of OIDC readiness. No account association or
security setting is automatically changed. The publisher requests npm provenance.
The implementation follows the official [npm trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/).

The transport accepts only public npm or an explicitly enabled owned loopback
origin. Reads have deadlines and size limits, never forward credentials and never
follow redirects. A registry 401, 403, 429 or 5xx is not treated as an absent
version. A private verified byte copy is passed to npm with lifecycle scripts
disabled, rather than repacking or rereading a mutable source package at publish
time. Credentials remain outside retained artifacts.

All public writes target **forgeqa-candidate**, never `latest`. Each successfully
published version is downloaded and matched to the prepared manifest's complete
SHA-256/SHA-512/size metadata. Interruption leaves a partial checkpoint under
`evidence/release-publication/`; a new run reconciles the registry even if a prior
runner's local checkpoint was lost. A conflicting immutable version stops the
entire attempt. Release workflow concurrency and a local exclusive lock prevent
overlapping publication into the same checkpoint. A hard-killed local process
may leave its lock; do not delete it until ownership/process termination is
established. A fresh runner can recover from registry state without that file.

Registry-installed npm and pnpm consumers must pass before a public candidate
receipt is written. This still is not complete TeamBoard/LedgerGuard public-release
acceptance. Stable promotion is deliberately separate: `assertStablePromotion`
continues to require matching platform, both registry consumers, immutable action,
documentation, benchmarks, lifecycle and semantic-version evidence. This slice
never creates stable tags, moves an action alias or deploys the documentation site.

## Evidence boundaries

The private maintainer dependency uses an analyzer-only local distribution of the
unchanged semantic-release 25.0.9 runtime under `tools/semantic-release`. Its MIT
license, original registry integrity and per-file source hashes are retained.
The private manifest excludes the default npm/GitHub publishing plugins, which
this coordinator never selects. This removes npm's vulnerable bundled transitives
without suppressing the audit gate, changing version semantics, or changing the
public packages' Node contract. Provenance and release-version tests enforce the
boundary; return to the upstream dependency when its default graph is safely
installable. The independent guarded public release engine remains unchanged.

The Phase 12A source implementation does not mark live npm authorization,
public publication, complete generic fixture/auth lifecycle, distributed benchmark
comparability, the released action, website deployment or the final audit as PASS.
Those statuses are retained until their actual external acceptance executes.
