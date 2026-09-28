# 2026-09-19 — THN TEST Git-blob runtime package correction

Prepared locally; this entry does not claim an AWS or GitHub deployment.

- Added a separate TEST-only, Add-only inline policy for two exact versioned
  reads of a corrected API runtime package and plan. The original runtime
  policy, recovery policy, role trust, other drafts, and production remain
  unchanged.
- Bound both private object keys to one reviewed Git-blob package digest and
  the approved API TEST source. Added a distinct private binding selector to
  the existing manual workflow; its default remains verify-only.
- Added local regression and synthetic orchestration checks. Object publication,
  binding selection, change-set review, TEST execution, and API provisioning
  remain separate gated steps.
