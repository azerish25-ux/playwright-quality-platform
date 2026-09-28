# Source-candidate quickstart

## Prerequisites and publication boundary

Use Node 22 or 24 and the exact Playwright version in the candidate (`1.58.2`). The package manifests currently identify `0.1.0`, but **the packages are not represented as published to npm**. Do not substitute an unverified `npm install @azerish25-ux/forgeqa-cli` command.

Obtain the `forgeqa-candidate-<SHA>` artifact from a successful CI run of the desired source commit. It contains eight `.tgz` packages, `SHA256SUMS`, `source.tar` and `source-sha.txt`. Verify its run/commit association and checksums before using it. GitHub artifact access may require authentication; expired artifacts must be regenerated from the same source rather than silently replaced with a newer revision.

## Exact automated onboarding

The repository provides one executable version of this procedure. From a source checkout, run:

```sh
npm ci --ignore-scripts
npm run build
npx --no-install playwright install --with-deps chromium
npm run docs:onboarding
```

This is a **maintainer acceptance command**, not a requirement to copy ForgeQA into an adopting application. It packs the built source, creates disposable consumers outside the monorepo, and performs the following procedure independently with npm and pnpm. Its receipts appear in `evidence/packed-docs/`.

## Adopt a candidate in your own directory

Create a fresh private bootstrap package outside the source workspace. Install **all eight exact candidate tarballs together** into that bootstrap using your package manager; use an array of absolute tarball paths instead of relying on shell wildcard expansion on Windows. For pnpm, set overrides for all eight package names to those same `file:` tarball paths so internal dependencies cannot resolve to a registry package with the same version.

Use the installed `forgeqa` binary to scaffold another new directory:

```sh
forgeqa init --template demo --destination ../my-forgeqa-consumer --package-manager npm --json
```

Use `--package-manager pnpm` for the pnpm variant. Initialization does not install dependencies and will not overwrite conflicting files. In the generated package manifest, replace the generated ForgeQA dependency versions with the absolute `file:` references to your candidate tarballs, including the internal dependency overrides for pnpm. Keep the generated Playwright and TypeScript versions. Install explicitly, retain the generated lockfile, and prove a clean reinstall (`npm ci --ignore-scripts` or `pnpm install --frozen-lockfile --ignore-scripts`). Install matching Chromium through the consumer's own Playwright CLI.

Run these commands with the **consumer's installed binary** on PATH, not the provider's source CLI:

```sh
forgeqa doctor --json
forgeqa plan --suite release --json
forgeqa run --suite release --json
```

Acceptance requires two clean first attempts: an HTTP readiness case and one Chromium UI case. The demo HTTP server starts and stops through Playwright's `webServer` lifecycle. This tiny onboarding application is not TeamBoard and is never used as proof of TeamBoard or LedgerGuard coverage.

## Configuration used by the tested example

<!-- forgeqa:include docs/snippets/forgeqa.config.ts -->

The generated native Playwright configuration imports this file and declares an API project and a Chromium project. Keep the generated web-server readiness configuration for the demo. See [migration](migration.md) before connecting a real application.

## Inspect the result

`forgeqa run --json` returns the owned run directory and policy result. Open its static HTML report or use `forgeqa report serve`; inspect `report.json` and the finalized evidence before accepting success. A process exit of zero alone is not sufficient evidence when the expected inventory is missing.

## What documentation CI verifies

The docs consumer mode uses the same installed tarballs for npm and pnpm; compiles the **exact snippet files embedded above and in the fixtures guide**; verifies all public exports resolve inside each consumer; runs doctor, plan, ForgeQA and native Playwright; and compares the resulting identities between package managers. A clean-install failure or a retry-recovered result fails documentation acceptance. No private application source imports or workspace symlinks are accepted.
