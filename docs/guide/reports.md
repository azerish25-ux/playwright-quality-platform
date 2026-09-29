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
