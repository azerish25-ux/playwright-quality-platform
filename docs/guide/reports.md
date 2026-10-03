# Interpret evidence before the status badge

## First inspect completeness

A successful report must account for the immutable expected inventory. Missing executions, unexpected identities, duplicates, incomplete journals, invalid checksums or absent finalization are integrity failures. A shard cannot manufacture a passing aggregate simply by uploading fewer results.

## Understand attempt outcomes

A passing retry does not erase the failed first attempt. Deadpan retains all attempts and reports the recovered test as flaky under the default strict gate. Expected failures, skipped tests and unexpected skips are distinct. A quarantined test still executes and its failure still fails.

## Choose the right output

| Output | Use |
|---|---|
| `report.json` | Canonical data, inventory and gate decision |
| JUnit | CI test presentation; not a replacement for evidence validation |
| Markdown | Compact job or PR summary |
| Static HTML | Human inspection without a separately operated backend |
| Artifact manifest | Captured/missing/unavailable files and integrity data |
| Playwright blob / native report | Native debugging, reconciled against canonical identities |

Static reports are not public by default. Use `forgeqa report serve` for a loopback preview. Trace archives, screenshots and videos may contain credentials or personal data even when textual diagnostics are redacted.

## Historical reliability

History groups compatible consumers, environments and configuration cohorts. Missing history is insufficient evidence, not a zero-percent flake rate. Retry attempts do not increase the execution denominator. See [history](../history.md), [GitHub import](../github-history.md) and [quarantine](../quarantine.md).

## Failure categories

Console errors, uncaught page errors, transport failures and HTTP responses with failing status are different evidence categories. A browser event collector is not proof of complete diagnostic coverage across all adapters. Inspect the retained event kind and the actual test failure together.

## Navigate the HTML report

The overview separates the configured gate decision from completion and observed inventory. An incomplete or unevaluated run is never introduced as a clean pass. The four counts are distinct executions, retained attempts, retry-recovered executions and missing expected executions; attempt durations are summed work, not parallel wall-clock time.

Use **Search tests** for a title, logical ID, project, environment or owner. Search and outcome filters combine. **Needs attention** puts policy-blocked executions first; **Slowest first** uses summed attempt duration; **Test name** provides an alphabetical view. The visible count announces changes to assistive technology. Clear or reset returns all executions and focuses search.

Filters are stored in the local report URL, so refreshing or returning from an artifact preserves context. They are not sent to a telemetry service. If you share a URL, its query may reveal the search text; treat it with the same care as the report. A file preview that prohibits URL changes still supports filtering.

Expand **Attempts & evidence** for the first and final outcomes, complete attempt sequence, owner, history denominator and original errors. Captured local attachments can be opened; missing, unavailable, disabled and inapplicable declarations remain explicit. Available SHA-256 hashes are shown beside attachment records. The HTML does not manufacture a link or checksum for absent evidence.

The report is self-contained, makes no external requests, and uses system fonts. All execution and attempt content remains readable without JavaScript; only search, filtering and sorting need it. Keyboard users can skip to executions, operate the native disclosures, and follow local evidence links. The layout is checked from 320 to 1440 CSS pixels.

## Try the synthetic walkthrough

From a source checkout after `npm ci --ignore-scripts`:

```bash
npm run demo:report
npm run forgeqa -- report serve evidence/report-demo
```

The fixture includes passed, failed, retry-recovered, timed-out, skipped and expected-failure outcomes. It is prominently marked **SYNTHETIC DEMO** and must not be represented as actual test evidence. Use the genuine consumer receipts for execution claims.

Maintainers can run `npm run test:report-browser` after building and installing the pinned Playwright browsers. This exercises Chromium, Firefox and WebKit under the required TeamBoard CI lane, including filtering, empty states, reset/focus, sorting, reload/back, local attachments, responsive overflow, hostile strings, and the no-JavaScript path. Browser captures and the result manifest are retained in the normal CI evidence artifact.
