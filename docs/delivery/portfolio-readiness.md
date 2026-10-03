# Source-candidate portfolio acceptance

This checklist scopes a reviewable portfolio deliverable. It is not a public release, production-certification claim, or replacement for the broader [requirements ledger](requirements.json).

## Acceptance checklist

- [x] Source builds under strict TypeScript; lint, unit, native-runner integration and package boundary checks pass
- [x] Original failures remain inspectable; logical-test gate violations mark affected executions as policy-blocked
- [x] Report HTML escapes test content, refuses active/traversing evidence links and preserves artifact states/checksums
- [ ] Report filtering, sorting, empty-state recovery, focus, reload/back and local artifacts pass real browser checks
- [ ] No horizontal page overflow at 320, 390, 768, 1024 or 1440 CSS pixels, including expanded evidence
- [ ] Report remains readable with JavaScript disabled and makes no external requests
- [ ] Required hosted report checks pass in pinned Chromium, Firefox and WebKit
- [x] README provides a reproducible database-free walkthrough with explicitly synthetic data
- [ ] Existing hardening, cross-platform npm/pnpm consumers, genuine TeamBoard/Bad Penny flows and documentation CI pass on the implementation commit
- [ ] Main points to the reviewed revision, with its exact CI result checked

## Design and behavior

The report is an evidence-reading surface: warm paper, ink rules, compact monospace provenance, an explicit policy rail, and execution rows that reveal original diagnostics on demand. Outcome labels retain words as well as color. No charts, network fonts, decorative dashboard metrics or simulated live activity are added.

The runtime public API and package boundaries are unchanged. The report demo is created by `npm run demo:report`, served locally with `forgeqa report serve`, and is identified as synthetic in its run ID and repository label. Real consumer receipts stay separate.

## Explicit boundaries

Public npm publication, public action tags/Marketplace distribution, documentation deployment and claims of controlled cross-host performance remain unaccepted. Historical receipts establish only their named source revisions. This continuation does not run the public release job or add deployment permissions.

## Verification record

Local prepublication verification on October 3 passed strict compilation and lint, 321 unit/contract cases, 15 real native-runner integration cases, package audit, both independent npm/pnpm LedgerGuard consumer compilation checks, TeamBoard strict typechecking, invariant/compatibility hardening, and 18 documentation tests. The unchanged policy-kernel thresholds passed at 99.07% lines, 95.30% branches and 98.78% functions. Documentation preparation produced 49 pages.

These are working-tree checks, not a claim that the previous HEAD contains these changes. Local browser execution is blocked by the execution environment's socket restrictions; the supported cloud browser also refused the preview URL. Visual acceptance and three-engine browser results remain pending the exact-source hosted run.
