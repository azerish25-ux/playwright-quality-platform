# Quarantine

Quarantine is accountable metadata, not `skip`, `fixme`, expected failure, swallowed exceptions, or `continue-on-error`. Records require a stable test ID, owner, reason, issue, creation time, and expiry. The default maximum duration is 14 days. Version 1 keeps quarantined tests in selection and continues to fail the build when they fail.
