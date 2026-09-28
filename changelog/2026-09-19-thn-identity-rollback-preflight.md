# 2026-09-19 — THN IAM rollback preflight

The failed THN TEST IAM update was rejected by the existing API GitHub role's
inline-policy size quota: the live role has 9,239 non-whitespace characters,
and the reviewed addition has 1,572 (10,811 total versus a 10,240 limit).
The stack completed rollback. No second update was attempted.

Before considering a dedicated managed policy with the same actions, the
read-only inspection now reports the existing managed-policy attachment count
and whether the proposed execution role survived rollback. It emits no IAM
document or attachment ARN and changes no AWS resource.
