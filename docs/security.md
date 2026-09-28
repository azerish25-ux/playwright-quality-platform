# Security and trust boundaries

## Separate test execution from privileged publication

Pull-request jobs run with read-only repository permissions. The trusted `workflow_run` publisher checks out default-branch source, not the PR. It validates repository/workflow identity, source and tested revisions, run attempt, associated PR and current head before processing evidence, then checks freshness again immediately before comment mutation.

Before download, the publisher rejects changed originating CI workflows and missing, duplicate, expired or oversized artifacts. Archive extraction checks paths, counts and sizes; report schemas and exact-attempt GitHub job conclusions are cross-checked before a clean result can be published. Artifact JSON is data, never executable input. Missing comment permission must not erase the original failed test result. See [GitHub Action](github-action.md) and the [hosted publisher receipt](delivery/pr-reporting-live-acceptance.md).

## Credentials and application boundaries

Action working paths are confined to `GITHUB_WORKSPACE`, including canonical-path and symbolic-link checks. Application and test child environments remove GitHub, Actions and registry credentials; installation receives registry authentication only where required. Do not log environment dumps or place tokens in URL userinfo. Browser storage state and cookies are credentials and must stay in ignored, access-restricted owned temporary storage.

The HTTP helper scopes requests to an origin and refuses silent retries for non-idempotent writes. Cleanup may remove only resources owned by the active run; concurrency isolation does not authorize deletion of unrelated data. Use synthetic accounts and non-production targets. An arbitrary application adapter is trusted code and must enforce its own authorization contract.

## Artifact privacy

Text redaction covers supported diagnostic fields and is tested with seeded canaries. It is not a claim to sanitize screenshots, traces or video. Those binary artifacts can capture cookies, personal data, DOM values and application content. Limit collection, access and retention; never publish raw production captures or commit complete run directories to source history.

The documentation workflow uploads a static-site build, toolchain receipts and synthetic onboarding evidence with a 14-day retention period. It has no Pages, registry or release-write permissions. A local screenshot and a passing local link checker do not establish public HTTP accessibility or external-link availability.

## Supply chain and releases

All eight package tarballs are inspected and installed into clean consumers. Third-party action references are immutable commits. The docs-only Python toolchain is pinned and isolated from the npm runtime; downloaded wheels and hashes are retained with its build evidence. Pinning alone does not replace vulnerability review or publisher authorization.

Registry release, public action tags, major aliases, partial-publication recovery and documentation deployment remain separate controlled steps. Do not promote a successful source-candidate build into a public release claim.

## Reporting a vulnerability

Follow [SECURITY.md](../SECURITY.md). Avoid posting exploit credentials or sensitive captures in a public issue. Preserve exact affected revision, reproduction steps, sanitized evidence and the boundary that failed. The [defect ledger](delivery/defects.md) distinguishes repaired implementation faults from later hosted verification.
