# Fork-safe PR reporting — hosted acceptance

This pull request is a data-only hosted acceptance probe for the ForgeQA pull-request publisher merged at `d872bd3f7f5b24b9b68c2c03fb08b6045c91d96d`.

It intentionally changes documentation only. It does not modify `.github/workflows/ci.yml`, `.github/workflows/forgeqa-pr-report.yml`, publisher source, action code, package code, tests, or consumer applications.

## Acceptance sequence

1. Run the complete required CI matrix from this pull request.
2. Let the trusted default-branch `workflow_run` publisher validate the run-bound report artifact and create one bot-owned ForgeQA comment.
3. Add a second documentation-only commit to this branch.
4. Run CI again and verify that the publisher updates the same comment instead of creating a duplicate.
5. Record the exact run IDs, publisher run IDs, comment ID, tested revisions, and final requirement status here and in the Phase 8 requirement ledger.

## Evidence

Live creation and update-in-place evidence is pending the hosted runs initiated by this pull request.
