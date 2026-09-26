# First-consumer verification and report semantics

The supported source-candidate runtime is Node 22/24. The tested Playwright version is pinned to 1.58.2, with a declared peer range >=1.58.2 <2. That peer range is not evidence that every future release has been exercised. Packages are ESM-only with TypeScript declarations. Node's actual type declarations replace the original handwritten shims.

## Native integration

Use `defineForgePlaywrightConfig(forgeConfig, nativeConfig)` and `createForgeTest(test)` from the public Playwright package. The helper retains native projects, webServer, project dependencies and assertions while adding strict focused/flaky safeguards and the ForgeQA reporter. The fixture extension preserves callable Playwright TestType and consumer fixture composition. The page fixture collects bounded console/page errors, transport failures and HTTP error responses separately. Browserless API tests do not request a page.

The reporter processes real public lifecycle callbacks. Every callback is guarded because exceptions thrown by a reporter can otherwise be swallowed by Playwright. A queue writes attempt journals incrementally; journal hashes and explicit finalization are checked. Missing or malformed evidence is not green. Native Playwright entrypoint failures/retry recovery are tested independently of the CLI.

## Reports

JSON, JUnit, Markdown and self-contained searchable HTML derive from the same canonical result. Test executions and attempts are distinct. Retry recovery is labeled `flaky`; the initial failed or timed-out attempt remains visible. Under strict policy the JUnit testcase is a failure. Expected failures remain explicit and are represented as skipped in JUnit, not ordinary passed coverage. Global gate violations use suite properties and system-err instead of fabricating successfully executed application cases; consumers must respect the process exit code as well as JUnit.

Attachments record captured/missing/disabled/inapplicable/unavailable states and actual hashes/sizes where captured. Paths escaping owned output, including symlink escapes, are refused. Text diagnostics are bounded and redacted. Binary traces/screenshots/video are sensitive, not claimed sanitized. Reports without comparable history state NO_BASELINE. Full historical comparison, quarantine UI and rich timeline enhancements are not claimed complete.

## Evidence layout

CI retains `forgeqa-candidate-SHA` package tarballs, `packed-consumer-OS-SHA` clean-install evidence, and `teamboard-evidence-SHA` PostgreSQL/browser results. These are authenticated artifact downloads with finite retention, not public report websites. PostgreSQL credentials and storage state are not committed. App test runs use synthetic users only.

The fast verification matrix covers Node 22/24 on Linux, Windows and macOS. A separate clean npm/pnpm consumer matrix runs actual Chromium on each OS. The Linux PostgreSQL job runs TeamBoard directly and through both packed-package installation modes across all three browsers. A stable aggregate job requires every lane to succeed; failed, cancelled and skipped lanes remain blocking.

## Installer and package-boundary checks

The workspace and pnpm-generated workflow pin pnpm 10.34.5. Installer advisories apply even when lifecycle scripts are disabled, so `--ignore-scripts` is not described as a sandbox. The dependency maintenance workflow produces lockfiles and a dated audit artifact without repository write permission; ordinary CI enforces its high/critical audit threshold.

Packed consumers copy an ESM probe into the temporary consumer directory, dynamically import each public package and validate canonical paths. CommonJS resolution is deliberately not used to test import-only exports. The CLI executable comes from its installed `bin` metadata. TeamBoard consumers compare actual logical-test/project/environment identity sets and assert zero database resources after each mode; equal counts alone are insufficient.
