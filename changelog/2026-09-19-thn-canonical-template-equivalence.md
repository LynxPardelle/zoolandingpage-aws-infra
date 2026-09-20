# 2026-09-19 — Canonical THN identity template equivalence

The dedicated THN TEST IAM release now compares pending and final CloudFormation templates as canonical JSON. This ignores object insertion order while preserving every key and value. The prior raw Python comparison could reject an equivalent, order-sensitive mapping even when the redacted structural diff reported no changed fields.

The diagnostic flags, pre-execution change-set review, and post-execution readback use the same strict comparison. No IAM scope, resource name, candidate artifact, or TEST release selector changes in this patch. A focused regression verifies that a reordered mapping is accepted and a changed IAM resource type is rejected.
