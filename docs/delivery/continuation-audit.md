# Source continuation audit — 2026-09-30

This checkpoint preserves the continuation on `main`. It is a source-quality and
portfolio review, **not authorization to publish and not a completed public
release**. Existing source-specific receipts remain bound to their original SHAs.

## Final exact-source acceptance

Source `ba9d622fdf35f7f764fa2e18bbcc2e7d3de19cb9` passed all 14 required
[CI jobs](https://github.com/azerish25-ux/playwright-quality-platform/actions/runs/36654683715),
[Documentation](https://github.com/azerish25-ux/playwright-quality-platform/actions/runs/36654683762)
and [Release candidates](https://github.com/azerish25-ux/playwright-quality-platform/actions/runs/36654683662).
The hosted suite passed 304 unit and 14 integration tests; the dependency audit
reported zero vulnerabilities. The public publishing job was skipped.

Four downloaded archives independently matched GitHub's digests and exact source.
All 16 complete source/prepared tarballs matched their SHA-256, SHA-512 and sizes.
The eight prepared packages remain version 1.0.0 candidates. All four prepared and
loopback-registry npm/pnpm consumers passed, with eight clean first attempts total.
The final documentation has 50 pages and 3,937 checked local references; its
screenshots are byte-identical to the desktop/mobile/search images reviewed below.
The PostgreSQL receipt confirms hard-kill recovery, concurrent-reaper isolation
and zero leftover acceptance resources. See [the retained source receipt](continuation-acceptance.json)
and [scoped database receipt](durable-postgres-acceptance.json).

This later documentation checkpoint records those immutable source bindings; it
does not pretend the downloaded artifacts originated from a newer documentation SHA.

## Implemented and verified

| Change | Source | Evidence |
| --- | --- | --- |
| PostgreSQL-authoritative lost-runner tenant ownership | `865b0296f847d02b283bc3179516298652aae763` | [CI TeamBoard job](https://github.com/azerish25-ux/playwright-quality-platform/actions/runs/36653199858/job/109691778123) passed real SQL, hard-killed-process, concurrent-reaper, lock and exact-namespace isolation checks. The full CI at this source failed a newly reported dependency audit; it is not represented as green. |
| Unmodified private semantic-release runtime without unused vulnerable publishing dependencies; existing-suite migration acceptance | `40dae9101f723d07a7cce337d988548dfc52070f` | Local full verification passed 303 unit tests, 14 integration tests, package audit and both isolated npm/pnpm LedgerGuard consumer typechecks. Local hardening passed eight exact tarballs and two clean consumers. The tested local commit and published commit have the same Git tree `6bd95d6cc7a24923f3b1d5e1a35970c943b0ffb5`. |
| Exact upstream bytes on Windows checkout | `ee28b780ac53421c8204549afae32f39f5821700` | `.gitattributes` prevents CRLF conversion of the retained upstream runtime and license. The preceding Windows failure is retained as a failed attempt, not hidden by normalizing the provenance assertion. |

The follow-on provenance regression verifies the checkout attributes themselves,
and release candidates now rerun when `.gitattributes` changes. Later commits must
pass their own exact-source CI, Documentation and Release candidates workflows.

The new database module achieved 100% line/branch/function unit coverage. The
unchanged aggregate 90/85/85 gates passed at 99.07% lines, 95.29% branches and
98.78% functions across 17 release-critical modules. SQL behavior is independently
covered by real PostgreSQL; unit mocks are not substituted for that acceptance.

Migration acceptance executes five original native cases across a setup dependency
and two projects, then compares the adopted native and CLI inventory and identities.
Custom directories, fixtures, hooks, tags and project metadata remain exercised;
application source and assertions remain byte-for-byte unchanged. This verifies
a concrete integration contract, not an automatic rewrite of arbitrary suites.

The dependency audit reports zero vulnerabilities after a clean installation.
Both official npm 11.20.0 and 12.1.0 were inspected and contained the affected
bundled versions; neither an ineffective override nor an audit exception was kept.
The private analyzer distribution retains the upstream MIT license, source integrity
and file hashes. Public package names, `forgeqa` CLI compatibility and Node `>=22`
remain unchanged.

## Documentation and visual review

[Documentation run 36654159566](https://github.com/azerish25-ux/playwright-quality-platform/actions/runs/36654159566)
passed at exact source `40dae9101f723d07a7cce337d988548dfc52070f`. Artifact
`11070894141` was downloaded and independently matched SHA-256
`38243b171a982dca44454ad509297d444efcc3f7e1671295f70e5b2d94f68527`.

The retained source receipt matches that SHA. All 3,936 local references across
50 HTML pages passed. Chromium verified navigation, search and mobile overflow;
there were no console/page/asset errors. Desktop, mobile and search screenshots
were visually inspected: content hierarchy, navigation, search results and the
unreleased-version label render clearly. The archive expires on 2026-10-14 and
can be regenerated from the exact source; it is not a public deployment.

External-link HTTP availability and a publicly deployed website are not implied
by the local-link check. No screenshot substitutes for LedgerGuard product UI.

## Remaining full-product boundaries

1. **Public npm distribution.** All eight `@azerish25-ux/forgeqa-` packages
   (`core`, `api`, `test-data`, `reporter`, `flake-analysis`, `playwright`, `github`,
   `cli`) still require actual scope ownership/trusted-publisher authorization and
   explicit publication approval. `1.0.0` is a prepared initial candidate, not a
   published version. Recalculate and verify the exact source before any write;
   use `forgeqa-candidate`, not `latest`, until stable gates pass.
2. **Released Action and Marketplace.** Immutable version tags, controlled major
   alias, external released-action acceptance and Marketplace listing are not
   completed. Account-owner terms and any security setup require the owner.
3. **Documentation deployment.** The version-aware site builds and is visually
   reviewed, but public hosting and real frozen release snapshots remain pending
   approval and actual deployment verification.
4. **Consumer interfaces.** Genuine TeamBoard API/browser acceptance exists.
   LedgerGuard remains pinned to the verified API-first source; a real LedgerGuard
   product UI/contract is required before adding browser acceptance. No mock UI
   or changed financial rules are substituted.
5. **Distributed measurements.** Heterogeneous hosted runners remain explicitly
   `NOT_COMPARABLE`. Comparable multi-machine speedup needs an approved identical
   runner class and new retained measurements; same-runner results cannot close it.
6. **External recovery contracts.** Database-authoritative leased tenants no longer
   require a lost runner's journal. Arbitrary external account APIs, raw application
   SQL, borrowed users and cross-host browser credentials still require their own
   fencing/ownership authority. A generic timestamp cannot make those writes safe.

The broader matrix's PARTIAL/BLOCKED/NOT_RUN entries must remain until their actual
acceptance executes. This source audit does not relabel them PASS or close the
full distribution audit. See [the scoped database ledger](durable-postgres-requirements.json),
[broader matrix](requirements.json), and [release guide](../guide/release-engine.md).
