# Private analyzer-only semantic-release runtime

This directory retains the unmodified JavaScript runtime, declarations and MIT
license from the official `semantic-release@25.0.9` npm distribution. `UPSTREAM.json`
records the source URL and SHA-256 of every retained upstream file. Only package
metadata differs: this copy is private, has no executable, and omits the unused
default npm/GitHub publishing plugins and upstream development tooling.

Deadpan's `release.config.mjs` and coordinator supply an explicit commit-analyzer
plugin. Release notes are generated separately. Public package publication still
uses Deadpan's exact-artifact, explicitly authorized release engine. This private
copy is never shipped in any of the eight public packages or the GitHub Action.

Why: as of 2026-09-30, both npm 11.20.0 and 12.1.0 bundled undici 6.28.0 and
ip-address 10.5.0, with active security advisories. npm's bundled dependencies
ignore ordinary transitive overrides, and `npm audit fix` cannot repair them.
The unused default publisher pulled that bundle into an analyzer-only toolchain.
Removing this unused dependency eliminates those installed bytes and preserves
the unchanged high-severity audit gate. No advisory is suppressed.

Updates must use an official upstream tarball, retain its MIT notice, compare
every runtime file against its recorded digest, regenerate both dependency locks,
and run the semantic-version, registry-protocol, package, full CI and documentation
gates. Prefer returning to the upstream package once its default dependency graph
has a supported vulnerability-free installation.
