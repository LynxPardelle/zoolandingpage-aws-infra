# TEST Infrastructure Delivery Hardening

Date: 2026-09-04 (Central Time)

## Changed

- Replaced direct TEST frontend deployment with an immutable CDK assembly,
  prepare-review-execute change-set flow, exact stack binding, and post-change
  smoke check.
- Added separate, default-off approvals for the THN admin DNS/TLS/distribution
  boundary and its shared SSR route association.
- Added immutable rollback selection bound to the successful source workflow
  run, artifact ID, source SHA, manifest digest, and exact artifact name.
- Added a fail-closed change-set reviewer for
  `admin-test.thehairnarrative.com`, including exact shared SSR host membership
  changes and the generated CDK analytics metadata exception.
- Bound the deployment role, STS caller, CDK release metadata, stack ARN, and
  change-set ARN to TEST account `765932874577` in `us-east-1`.
- Updated `aws-cdk-lib` from `2.261.0` to `2.268.0`; synthesized TEST and
  production templates are functionally unchanged by the dependency update,
  and the bundled vulnerable `brace-expansion` version is replaced by `5.0.9`.

## Verified

- The complete Node test suite passes.
- The enabled THN synthesis inventory is accepted by the same reviewer shipped
  in the release artifact.
- TEST and production synth outputs remain functionally unchanged by the CDK
  dependency update, excluding CDK analytics metadata.
- Workflow lint, shell syntax, Node syntax, dependency audit, and diff checks
  pass.
- No workflow was dispatched and no AWS state was changed.
