# Quarantine

Quarantine is accountable metadata, not `skip`, `fixme`, expected failure, swallowed exceptions, or `continue-on-error`. Records require a stable test ID, owner, reason, issue, creation time and expiry. Optional project scope must name exact projects; wildcard, traversal-like and path scopes are rejected. The default maximum duration is 14 days.

Version 1 keeps quarantined tests in selection and continues to fail the build when they fail. Mutation is explicit and atomic:

```text
forgeqa quarantine add TEST_ID OWNER REASON ISSUE EXPIRES_AT [PROJECTS] \
  --file .forgeqa/quarantine.json --report forgeqa-results/report.json

forgeqa quarantine validate \
  --file .forgeqa/quarantine.json --report forgeqa-results/report.json

forgeqa quarantine remove TEST_ID [PROJECTS] \
  --file .forgeqa/quarantine.json
```

`add` refuses unknown tests, duplicate scopes, missing metadata, invalid dates and excessive duration. `remove` targets the exact stable ID and optional project scope. Concurrent mutations serialize through an owned lock file and replace the JSON document atomically.
