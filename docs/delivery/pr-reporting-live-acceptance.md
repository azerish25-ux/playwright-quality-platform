# Fork-safe PR reporting — hosted acceptance

This pull request is a data-only hosted acceptance probe for the ForgeQA pull-request publisher introduced at `d872bd3f7f5b24b9b68c2c03fb08b6045c91d96d` and permission-repaired at `9f607d13bfe7fcb314c66ea87220ea2e0448d8e9`.

It intentionally changes documentation only. It does not modify `.github/workflows/ci.yml`, `.github/workflows/forgeqa-pr-report.yml`, publisher source, action code, package code, tests, or consumer applications.

## Acceptance sequence

1. Run the complete required CI matrix from this pull request.
2. Let the trusted default-branch `workflow_run` publisher validate the run-bound report artifact and create one bot-owned ForgeQA comment.
3. Add a later documentation-only commit to this branch.
4. Run CI again and verify that the publisher updates the same comment instead of creating a duplicate.
5. Record the exact run IDs, publisher run IDs, comment ID, tested revisions, and final requirement status here and in the Phase 8 requirement ledger.

## Evidence collected so far

- Initial docs-only CI run `36323432365` completed successfully.
- Initial publisher run `36323734608` validated the workflow, pull request, bounded artifact metadata and downloaded report, but GitHub rejected comment creation because the token had only `pull-requests: read`.
- Permission-repair PR #8 passed full CI run `36323934631` at `b23540cf0709a9030a3c751a62772cb190846595` and was merged as `9f607d13bfe7fcb314c66ea87220ea2e0448d8e9`.
- First post-repair CI run `36324283050` completed successfully and the trusted publisher created bot-owned ForgeQA comment `5856548977` for head `bdf6fe59f99ec2885549b7fed64caf4fcb6008e4`.

This documentation-only revision is the required second probe. Its acceptance condition is that a new complete CI run causes the trusted publisher to update comment `5856548977` in place with the new run and head metadata while leaving exactly one ForgeQA report comment on PR #7.
