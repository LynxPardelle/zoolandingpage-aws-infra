# THN TEST private-origin change-set review correction

Date: 2026-09-22 (Central Time)
Scope: TEST Frontend stack only; no production or shared application API change.

The guarded deployment's property-value view showed a single-resource CloudFront change set, then
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

## Follow-up: complete change inventory (local, not released)

A later read-only comparison of the same prepared change set showed that the
ordinary `DescribeChangeSet` view contains three changes, while its
`IncludePropertyValues` view contains only the private distribution change.
The two additional dynamic entries are the THN TEST alias-record custom
resource and distribution-domain SSM parameter, both caused by that
distribution's domain name. The earlier reviewer did not see those entries.

The local follow-up now requires both views for the opaque-origin exception,
matches their change-set identity, and accepts only the exact three known
resource changes and dependency profiles. The execution-boundary guard repeats
the complete-inventory check. Other drafts and ordinary TEST changes retain
their existing path. The local Node suite passes (323 passed, one skipped);
shell and JavaScript syntax checks pass. This follow-up has not been published,
promoted, or executed in AWS. The current workstation has no AWS CLI credentials
for a fresh live replay, so a new guarded deployment must perform that review
before any change-set execution.
