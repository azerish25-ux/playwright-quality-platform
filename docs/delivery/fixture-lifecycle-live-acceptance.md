# Fixture lifecycle — scoped hosted acceptance

**Process-local authentication and recoverable fixture lifecycle acceptance passed at `3c13c2bf0c84d1ac46f877ae81beaa56f3c56902`. This accepts FL-01 through FL-06, not generic forced-termination recovery or a public release.**

The implementation is commit `e378dcf6749283b51948c71b547b35c615277135`; commit `3c13c2bf0c84d1ac46f877ae81beaa56f3c56902` repairs the installed-consumer receipt path without removing any acceptance assertion. The accepted source tree is `fc4be5d05f0ecef1e54d6bd0414ac11c70b4a5e0`.

## Exact-source verification

| Workflow | Run | Result |
| --- | --- | --- |
| CI | [36517554945](https://github.com/azerish25-ux/playwright-quality-platform/actions/runs/36517554945) | All 14 required jobs passed, including aggregate `109244535351`. |
| Documentation | [36517554767](https://github.com/azerish25-ux/playwright-quality-platform/actions/runs/36517554767) | Installed npm/pnpm onboarding, strict site build, links and Chromium checks passed. |
| Release candidates | [36517554884](https://github.com/azerish25-ux/playwright-quality-platform/actions/runs/36517554884) | Exact-source gate, prepared artifacts and isolated registry acceptance passed. Public publication was skipped. |

The six Linux/macOS/Windows Node 22/24 verification lanes passed. The three independent consumer lanes each installed with npm and pnpm, compiled public fixture contracts, and ran the six new Chromium contract cases with no skips or retry recovery. The source includes 23 focused lifecycle cases and two native failure/restart cases. Native retry recovery still fails the strict gate; the outer regression verifies that failure rather than hiding it.

## Real consumers

TeamBoard passed the same 20 execution identities in workspace, npm and pnpm modes: eight API cases and four UI journeys on each of Chromium, Firefox and WebKit. Every attempt passed first time. Its real authentication adapters validate the user and workspace role. The actual product journey exercises flag restoration, isolated browser time, owned upload files and bounded downloads. All three cleanup receipts report zero owned namespaces, tenants and accounts.

LedgerGuard passed all twelve API-first journeys independently with npm and pnpm against pinned application source `9478663f97f9dc65d0c85117f244e1b8b80c37cb`. Its adapter retains application CSRF/session behavior. Both canonical reports passed without retry recovery; reconciliation found zero discrepancies, and both infrastructure cleanup receipts recorded zero containers, volumes and networks. No LedgerGuard browser UI is claimed.

The six-case fixture-contract browser service is explicitly separate from these product consumers. It verifies native composition, real cookie-state adoption, expected route interception and restoration, clock isolation, owned files and failure cleanup. It is not presented as a third production application.

## Independent artifact checks

Five downloaded archives matched their GitHub SHA-256 digests: source candidate, hardening, Linux packed consumer, TeamBoard and LedgerGuard. All eight source-package tarballs and the source archive matched their retained checksums. All 327 tracked source files matched the local implementation byte for byte; the local staged tree matched the remote tree. The Linux npm/pnpm fixture receipts were checked for source SHA, installed versions, six passing cases and zero unexpected/flaky/skipped cases. TeamBoard's three full canonical inventories and LedgerGuard's two reports and cleanup records were inspected independently.

The coverage scope contains fourteen release-critical modules, including the four new lifecycle modules. Thresholds were not reduced. Downloaded LCOV totals independently reproduce:

| Metric | Required | Observed | Covered / total |
| --- | ---: | ---: | ---: |
| Lines | 90% | 98.82% | 1009 / 1021 |
| Branches | 85% | 96.45% | 597 / 619 |
| Functions | 85% | 98.11% | 156 / 159 |

Exact artifact IDs, digests, workflow/job IDs and verification boundaries are retained in [the machine-readable receipt](fixture-lifecycle-acceptance.json). These are scoped coverage measurements, not whole-repository coverage claims.

## Remaining boundaries

FL-07, R-008, M1-03 and RR-06 remain PARTIAL. Coordination is within a worker process; shared cross-process authentication-state recovery and a generic guarded reclamation protocol for credentials/private files after forced termination remain incomplete. A hard-killed process cannot run teardown. Deadlines request cooperative cancellation and bound waiting; they cannot force arbitrary promises to stop or undo remote writes.

Public npm publishing, stable promotion, released Action references, public documentation deployment and the final whole-product audit remain separate. The recorded verification applies to the exact source above; later revisions require their own workflow evidence.

See the [scoped matrix](fixture-lifecycle-requirements.json), [broader matrix](requirements.json), [release-readiness matrix](release-readiness-requirements.json), and [public fixture guide](../guide/fixtures.md).
