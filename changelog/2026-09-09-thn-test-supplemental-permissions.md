# THN TEST supplemental permission preparation

2026-09-09, Central Time. Local source preparation; not a deployment receipt.

- Added three separate TEST-only policies for existing Hub/Image deployment
  identities. Original roles, policies and trust remain unchanged; production
  synthesis retains its independently captured baseline.
- Reconciled short runtime-role/private-bucket scope, native alias rollback and
  provider configuration reads. Hub IAM mutation uses CloudFormation FAS, with
  exact managed-policy and Lambda PassRole conditions.
- Added a separate immutable-artifact/manual TEST workflow and fail-closed runner:
  baseline/role/parameter drift checks, inline quota, encrypted conditional
  transport, exact three-Add review and final policy/ownership verification.
- Replaced candidate value-based Gitleaks exceptions with default rules. Keep
  existing historical fingerprints; any new verified false positive must use
  its exact committed fingerprint, never a value/path/rule bypass.
- Added positive/negative tests, native-shaped cloud fixtures and
  [operator guidance](../docs/thn-test-permissions.md). Local tests and read-only
  IAM simulations do not establish effective workflow access or client readiness.
- No production change, new compute, background cleanup service, blog data write
  or AWS activation is part of this preparation.
