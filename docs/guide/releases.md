# Release and documentation maintenance

## Source, acceptance and release are different states

A source commit can pass every implemented CI lane without being an npm release. Packed tarballs prove candidate installation; they do not prove registry availability. A local `uses: ./` action run proves a source distribution, not a tagged public action or a Marketplace listing.

Before Phase 12, keep the `next` documentation channel visibly unreleased. Do not add a `v0.1.0` page merely because package manifests already contain that number.

## Documentation workflow

Documentation is compiled with MkDocs 1.6.1 using a separately pinned Python toolchain; no Python dependency enters any public npm package. The build stages maintained Markdown, compiles public API declaration pages from the built packages, embeds exact tested snippets and retains source hashes. Search and navigation are local static assets.

```sh
python3 -m venv .tmp/docs-venv
.tmp/docs-venv/bin/python -m pip install --no-deps -r docs/site/requirements.txt
.tmp/docs-venv/bin/python -m pip check
npm run build
npm run docs:prepare
.tmp/docs-venv/bin/python -m mkdocs build --strict --config-file docs/site/generated/mkdocs.yml
python3 scripts/docs/check_site.py --site evidence/docs/site --base /playwright-quality-platform/
```

On Windows, use the equivalent virtual-environment executable under `Scripts`. The hosted documentation lane uses Ubuntu 24.04 / CPython 3.12. A local build directory and an artifact are not a visited production website. Deployment remains an explicit release action.

## Immutable version contract

`docs/versions.json` declares `next` and zero or more real released versions. Each release record identifies a semantic version, exact source SHA and SHA-256 of `docs/versions/vVERSION/manifest.json`. That manifest lists every frozen Markdown file and its digest. The builder rejects missing files, extra files, checksum changes, duplicate versions and path escapes.

Create a frozen snapshot only after the release audit establishes the corresponding registry/action/source versions. Freeze the generated `next` Markdown tree, retain its source SHA and file hashes, then add its version record through review. Released content must not be silently rebuilt from current source. Version navigation links to those checked snapshots; it does not invent earlier releases.

## Publication and recovery

Coordinate all eight npm packages, their internal dependency ranges, action distribution, documentation snapshot and release manifest. Test a partial-publication recovery path before stable publication. Verify actual registry installation in new consumers, callable immutable action references and the intended major alias. Marketplace account approvals are separate from callable action publication.

Keep exact-source CI and distribution evidence in the final audit. The current release rehearsal alone is not a publishing workflow. [Delivery status](../delivery/STATUS.md) identifies remaining blockers, including genuine LedgerGuard UI coverage and benchmark limitations.
