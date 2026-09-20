# 2026-09-19 — THN identity final-readback diagnosis

The guarded IAM repair workflow exited after CloudFormation reached
`UPDATE_COMPLETE`. A read-only inspection confirmed one managed-policy
attachment, but the workflow's generic error did not identify which final
assertion failed. No second apply was attempted.

The existing read-only `inspect` operation now reports allowlisted statuses for
the three reviewed resources, plus exact/mismatch flags for their current
template definitions and policy attachments. It emits no physical IDs, policy
documents, role trust, or customer data. This is diagnostic only; no deployment
scope or IAM grant changes.
