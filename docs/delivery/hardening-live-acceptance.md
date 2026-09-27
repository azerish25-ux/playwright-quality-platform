# Phase 10A hosted hardening acceptance

## Result

Phase 10A passed hosted exact-source acceptance on September 27, 2026.

- ForgeQA source revision: `75b30f421514c18416a687725caf2c6a0ab6367a`
- Pull request: `#11`
- Main-branch CI run: `36350020241`, attempt `1`
- Workflow conclusion: `success`
- Aggregate `forgeqa-quality` job: `108707814220`, conclusion `success`
- Hardening job: `108706773253`, conclusion `success`
- Hardening artifact: `10941996762`
- Artifact name: `hardening-evidence-75b30f421514c18416a687725caf2c6a0ab6367a`
- Artifact digest: `sha256:f32085587534f8dc5fe344426f2232c46e54ff3878aa957165285421d7c260e3`

## Hardening evidence

The exact source revision completed all 23 hardening tests and enforced the maintained policy-kernel thresholds without exclusions being added to hide production modules.

| Metric | Required | Observed |
|---|---:|---:|
| Lines | 90% | 98.63% |
| Branches | 85% | 96.74% |
| Functions | 85% | 98.77% |

The same job also:

- packed and deeply inspected all eight public ForgeQA packages;
- rejected unresolved local protocols, private source imports, forbidden package paths, missing export/bin targets and credential-like content;
- installed the exact audited tarballs into independent clean npm and pnpm consumers;
- imported every public package through its published interface;
- compiled public declarations with strict TypeScript and `skipLibCheck: false`;
- executed the installed `forgeqa` binary through the package-manager shim;
- exercised deterministic merge, gate, identity, namespace, cleanup, quarantine, redaction and changed-area-selection invariants;
- demonstrated that seeded defects in gates, merge completeness, selection fallback, quarantine enforcement and redaction are detected.

## Whole-platform acceptance

The exact main-branch run passed every required lane before the aggregate gate passed:

- six Linux/macOS/Windows Node 22/24 verification jobs;
- three independent cross-platform packed-consumer jobs;
- PostgreSQL-backed TeamBoard with Chromium, Firefox and WebKit;
- the genuine API-first LedgerGuard consumer against pinned P07A source;
- the source-distributed GitHub Action acceptance;
- the Phase 10A hardening job;
- the final `forgeqa-quality` aggregate.

Retained companion artifacts include TeamBoard artifact `10942131460` with digest `sha256:5991076c1a36bd2b98dc6f98c879eddccc9584cc3cadf52b93d220fcb30e6c5b`, LedgerGuard artifact `10942595299` with digest `sha256:90cf1c8643fc1a1e7c471cf622d977c2572f2ad5f945d090afbd63452200ca41`, and exact-source package candidate artifact `10941104781` with digest `sha256:321f4c2d06aa9afea90ddeae98133b97d13ce5f908330373752e654143d23429`.

## Defects found and repaired by the gate

Hosted hardening found four root causes before acceptance:

1. Gate violations were semantically deterministic but emitted in input-dependent order. Evaluation now canonicalizes execution, artifact, quarantine, affected-identity and final violation ordering.
2. Clean declaration consumers lacked explicit Node and DOM type-library context. The acceptance consumer now compiles the real package declarations with those peer requirements and keeps library checking enabled.
3. pnpm resolved nested internal package dependencies from the registry instead of the staged candidate set. Consumer-local overrides now bind every internal dependency to the exact audited tarball.
4. The published CLI’s direct-execution check used raw path equality, so package-manager symlinks could suppress command execution. The CLI now compares canonical real paths, and both a focused symlink regression and clean npm/pnpm binary acceptance protect the behavior.

These repairs are recorded as D-012 through D-015 in `defects.md`.

## Boundaries that remain

This acceptance is not an npm publication, immutable public action tag, Marketplace listing, live versioned documentation deployment, comparable production benchmark result, or final delivery audit. Those remain Phase 11 through Phase 13 work and are not represented as completed by this record.
