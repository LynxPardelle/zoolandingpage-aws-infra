# THN production Hub import-read postcheck

The protected IAM execution applied `HubImportPreflightReadPolicy` successfully, but its final inventory guard reported `production_identities_post_inventory_mismatch`. CloudFormation finished `UPDATE_COMPLETE` with 32 resources, the inline policy matched the source manifest, and all five bounded read permissions simulated as `allowed`. No second IAM execution is required.

The guard used the Auth User Pool discovered in another stack to count conditional resources. This identities stack intentionally kept `ThnProductionOwnerPoolArn=BLOCKED`, so those four conditional resources were not active. The postcheck now uses the stack's preserved parameter for `hub-import-read-patch`, as it already did for `hub-rule-policy-patch`. A regression test covers an existing Auth pool with the identities parameter still blocked.

Verification: `node --test test/thn-production-identities-hub-import-read.test.js`; `npm test` (465 passed, one skipped).
