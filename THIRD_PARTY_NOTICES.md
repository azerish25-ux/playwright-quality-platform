# Third-party notices

The private maintainer toolchain includes the unmodified semantic-release 25.0.9
runtime under `tools/semantic-release`, licensed under MIT. Its original copyright
and permission notice is retained in `tools/semantic-release/LICENSE`; source and
per-file hashes are recorded in `tools/semantic-release/UPSTREAM.json`. The private
manifest omits unused publishing plugins; see that directory's README. This
maintainer-only code is not distributed in the eight public packages or Action.

Consumers install Playwright Test and other optional adapters under their
respective licenses. Release automation must review this file before distributing
bundled code.
