# THN TEST private-origin change-set review correction

Date: 2026-09-22 (Central Time)
Scope: TEST Frontend stack only; no production or shared application API change.

The guarded deployment prepared a single-resource CloudFront change set, then
stopped at `admin_change_evidence_missing`. CloudFormation supplied the private
distribution's `DistributionConfig` as an opaque context value, omitting its
unchanged alias. The previous reviewer required the alias to appear in the
change-set context, so it could not recognize this otherwise bounded update.

The reviewer now accepts this exact opaque, static, non-replacing private
distribution update only when an independent comparison of the complete live
and immutable desired templates proves that the sole difference is the
dedicated TEST API origin domain. The normal host-evidence rule remains in
place for every other change. The template comparison runs before preparation
and is repeated at the execution boundary; a mismatched or additional change
fails closed.

Local verification: focused negative tests, the complete Node test suite, and
read-only comparison against the prepared TEST change set and current stack.
No change set was executed, no GitHub Actions run was dispatched, and no AWS
resource was mutated by this correction.
