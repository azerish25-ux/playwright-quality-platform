# Fork-safe PR reporting — hosted acceptance

This pull request is a data-only hosted acceptance probe for the ForgeQA pull-request publisher introduced at `d872bd3f7f5b24b9b68c2c03fb08b6045c91d96d` and permission-repaired at `9f607d13bfe7fcb314c66ea87220ea2e0448d8e9`.

It intentionally changes documentation only. It does not modify `.github/workflows/ci.yml`, `.github/workflows/forgeqa-pr-report.yml`, publisher source, action code, package code, tests, or consumer applications.

## Acceptance sequence

1. Run the complete required CI matrix from this pull request.
2. Let the trusted default-branch `workflow_run` publisher validate the run-bound report artifact and create one bot-owned ForgeQA comment.
3. Add a later documentation-only commit to this branch.
4. Run CI again and verify that the publisher updates the same comment instead of creating a duplicate.
5. Record the exact run IDs, publisher run IDs, comment ID, tested revisions, and final requirement status here and in the Phase 8 requirement ledger.

## Hosted evidence

- Initial docs-only CI run `36323432365` completed successfully.
- Initial publisher run `36323734608` validated the workflow, pull request, bounded artifact metadata and downloaded report, but GitHub rejected comment creation because the token had only `pull-requests: read`.
- Permission-repair PR #8 passed full CI run `36323934631` at `b23540cf0709a9030a3c751a62772cb190846595` and was merged as `9f607d13bfe7fcb314c66ea87220ea2e0448d8e9`.
- First post-repair CI run `36324283050` completed successfully. Publisher run `36324606250` created bot-owned ForgeQA comment `5856548977` for head `bdf6fe59f99ec2885549b7fed64caf4fcb6008e4`.
- The required second documentation-only probe was committed as `24a5894628da0f5d21323202ca0628de0517523a`.
- Its complete CI run `36327735451`, attempt 1, succeeded. The tested pull-request merge revision was `81f739943683a63833924f6021f4441810b28570`.
- Trusted publisher run `36328071048` completed successfully from default-branch source `9f607d13bfe7fcb314c66ea87220ea2e0448d8e9`.
- Report artifact `10934428253`, `forgeqa-pr-report-36327735451-1`, was retained with GitHub artifact digest `sha256:a6fcb0aba7fb8ab958f7e1c9cea901b43c0462d84d0128dbeb52070c8634d89e`. The validated report was 707 bytes and the published comment displayed report digest prefix `6b7f32fc4cdbea9d…`.
- Comment `5856548977` retained its original creation time `2026-09-27T14:04:45Z` and changed its update time to `2026-09-27T15:02:26Z`.
- The updated marker metadata names run `36327735451`, attempt 1, PR #7, head `24a5894628da0f5d21323202ca0628de0517523a` and base `d872bd3f7f5b24b9b68c2c03fb08b6045c91d96d`.
- PR #7 contains exactly one ForgeQA marker comment, owned by `github-actions[bot]`; no duplicate comment was created.

## Result

**PASS.** Hosted creation and update-in-place behavior are proven. The trusted default-branch publisher validated run-bound data-only evidence, preserved the pull-request trust boundary, and idempotently updated the existing bot-owned report comment.
