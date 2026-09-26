# Security and trust boundaries

Fork pull requests receive read-only permissions and no release credentials. A privileged completion job, when added, must validate repository, workflow, run, pull request, head SHA, artifact count, archive paths, expanded size, checksums, and schemas. It may publish sanitized data but must never install or execute pull-request-controlled content. Storage-state files are credentials and belong in ignored, permission-restricted temporary directories. Binary traces, screenshots, and videos require access control and short retention.
