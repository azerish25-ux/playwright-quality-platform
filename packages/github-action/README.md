# @azerish25-ux/forgeqa-github

The maintained JavaScript action runtime for [ForgeQA](../../README.md). It executes in the consumer checkout and resolves the consumer's installed `@azerish25-ux/forgeqa-cli`; it does not assume the ForgeQA monorepo exists in that checkout.

## Execution modes

- `mode: run` without `shard-index` plans once, runs a bounded local shard pool, merges complete evidence, and propagates the final quality or infrastructure exit code.
- `mode: plan` writes one immutable distributed manifest for a reusable-workflow matrix.
- `mode: run` with `shard-index` executes exactly one manifest-bound matrix shard.
- `mode: merge` validates the downloaded shard tree, refuses symbolic links or contradictory shard dimensions, and publishes the canonical merged report.

The runtime confines paths to `GITHUB_WORKSPACE`, strips GitHub and registry credentials from application and test child processes, uses argument arrays for ForgeQA and package-manager commands, and treats `build-command` and `application-command` as explicit trusted workflow code. An application command requires a credential-free HTTP(S) readiness URL.

## Single-runner source example

```yaml
permissions:
  contents: read

steps:
  - uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6
    with:
      persist-credentials: false
  - uses: azerish25-ux/playwright-quality-platform@<immutable-release-sha>
    id: forgeqa
    with:
      suite: regression
      browsers: chromium,firefox,webkit
      workers: '4'
      shard-count: '2'
      application-command: npm run start:test
      readiness-url: http://127.0.0.1:3000/health
  - uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4
    if: always()
    with:
      name: ${{ steps.forgeqa.outputs.artifact-name }}
      path: ${{ steps.forgeqa.outputs.evidence-path }}
      retention-days: ${{ steps.forgeqa.outputs.artifact-retention-days }}
      if-no-files-found: error
```

A step-level action cannot create independent GitHub jobs. Use `.github/workflows/forgeqa-reusable.yml` for a real job matrix. The repository does not claim an immutable public action release or major alias until the release workflow and an external consumer have verified them.
