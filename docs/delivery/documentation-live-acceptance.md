# Phase 11B hosted documentation acceptance

## Exact accepted checkpoint

Source: `54f25b2a865b8b90c7fe00b34142cbb282d99a57`. Accepted September 28, 2026.

[Documentation run 36468235212](https://github.com/azerish25-ux/playwright-quality-platform/actions/runs/36468235212) completed successfully; its `docs-quality` job is `109083620021`. [Full platform CI 36468235190](https://github.com/azerish25-ux/playwright-quality-platform/actions/runs/36468235190) also completed successfully at the same source, including the cross-platform Node 22/24, packed-consumer, TeamBoard, LedgerGuard, hardening, action and aggregate gates.

These are observed checkpoint results, not assertions that a later commit has already passed. Every subsequent source revision must pass its own workflows.

## Verified documentation behavior

The strict MkDocs 1.6.1 build generated 46 documentation pages and the standard 404 page. Eight public API references derive from built package declarations; all 15 ADRs include context, decisions, alternatives, consequences and concrete validation paths. Guides cover clean adoption, migration, fixtures, configuration, CLI, consumers, distributed evidence, reports, history, quarantine, benchmarks, security and release maintenance.

Thirteen Node contract tests and seven Python link-checker tests passed. The built-site checker verified **3,543 local links, anchors and assets**, found no errors and explicitly did not claim HTTP verification for external links. Frozen-version tests rejected tampered hashes, changed file inventories and unsafe paths. The real version inventory contains only `next`; no historical release was fabricated.

The npm and pnpm onboarding harness independently installed all eight exact tarballs in bootstrap directories, invoked the **installed** CLI to scaffold fresh consumers, reinstalled through lockfiles, verified public export resolution and compiled the three exact embedded snippets. Each manager then ran doctor, plan, ForgeQA and native Playwright successfully. Both canonical reports contained the same two first-attempt passing identities: one browserless API case and one Chromium UI case. This small onboarding application is not a substitute for either real consumer.

Chromium verified desktop navigation, keyboard-driven search and opening the Quarantine result, mobile layout without horizontal overflow, and absence of page/asset errors. Actual desktop, search and mobile screenshots are retained in the artifact and were visually inspected. DOC-001 records the earlier failed driver invocation; its failure was repaired, not hidden or reclassified.

## Retained artifact

| Field | Value |
|---|---|
| Artifact ID | `10990396723` |
| Name | `documentation-54f25b2a865b8b90c7fe00b34142cbb282d99a57-1` |
| ZIP SHA-256 | `df6edc2527fb023fbb2e85904048f056072c3c46780853b34c323e3e135bf71d` |
| Compressed bytes | `7598808` |
| Retention expiry | `2026-10-12T18:53:50Z` |
| Documentation mount | `/playwright-quality-platform/` |

The downloaded ZIP digest was independently checked before inspecting its receipts. It contains the built site, Python toolchain and wheel hashes, source-bound build manifest, snippet hashes, local-link receipt, browser receipt, package checksums and both manager reports. Artifact retention is finite; expired evidence must be regenerated from the identified source and recorded as a new run rather than silently substituted.

## Evidence file hashes

Paths below are relative to the uploaded artifact, not repository paths.

| Evidence | SHA-256 |
|---|---|
| `docs/build-manifest.json` | `3f847805ba53e539eb28ff0970948e4203d74a7b832404a7935b1667fae4f95d` |
| `docs/links.json` | `ac6270867f9168efd1115d8934b4ae361a853ecc9e7cc9046dcf08b3b07326d7` |
| `docs/browser.json` | `84090db42b36d77d58b5394bcc85c2dd8128da338adcfc4942acd1c20386dfde` |
| `packed-docs/npm-onboarding.json` | `b8a5264c7bf7961072b5751fac5024acf1aea475f6ab4ffe4562f909d6d184a2` |
| `packed-docs/pnpm-onboarding.json` | `d639b529735d4d08c3136639460bc7130d94727bb0199a337f1753ba10d895f1` |
| `packed-docs/package-checksums.json` | `995d08984ecfc461fa77e7447a32e1fe6769396dd75b315ff528564d606010e1` |
| `docs/desktop.png` | `b11db84753119f4ac90a027699c7fab6bd52ed521cc75d55f3287d05e577002d` |
| `docs/mobile.png` | `f9586988a3c8159208ca38480f37f6cfee73828000120c7fe0a8913c8cdd10b2` |
| `docs/search.png` | `60c2ba805a41ff92ec6faf087c7216e4c76ed3d42a2eb586d863040f3790dad6` |

## Boundaries retained

P11B-01 through P11B-06 are accepted for this checkpoint. P11B-07 remains `NOT_RUN`: no live public documentation deployment or real released snapshot was verified. `next` is an unreleased source channel, and source-candidate tarballs do not establish npm publication.

Immutable public action tagging, a verified major alias, registry installation, publication recovery and final release audit remain separate work. LedgerGuard is still API-first. Heterogeneous benchmark hardware still blocks speedup claims. The separate read-only Documentation workflow does not alter or weaken the existing platform aggregate, and its success is an additional acceptance requirement rather than a public distribution claim.
