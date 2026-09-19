# 2026-09-19 CT - THN admin Angular hash compatibility

- The TEST-only immutable admin release preflight accepts the pinned Angular
  compiler's eight-character URL-safe mixed-case module tokens alongside the
  existing bounded hex names. It does not admit additional hosts, routes,
  extensions, directories, or unlisted objects.
- Exact APP release selection, canonical bytes, source/run identity, complete
  inventory, and SHA-256 validation remain mandatory before AWS mutation.
- Local positive and negative release-preflight tests pass. This change alone
  does not deploy a distribution, switch the public release, or enable writing.
- A local handoff using the real app build passed the read-only verifier with
  36 selected assets and a 72-file sealed delivery. No S3 objects were read or
  written during this check.
