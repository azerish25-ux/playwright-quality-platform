# Configuration

Precedence is: defaults → project configuration → selected environment → allowlisted environment overrides → explicit CLI overrides. Arrays replace rather than concatenate. Unknown top-level options, unsupported browsers, unsafe paths, invalid durations, and out-of-range concurrency fail before execution. `resolveForgeConfig` emits a redacted representation and a deterministic hash that excludes executable adapters and secret environment values.
