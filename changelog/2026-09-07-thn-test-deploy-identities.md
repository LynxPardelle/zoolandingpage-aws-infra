# TEST deployment identities — 2026-09-07 (Central Time)

Added separate GitHub OIDC and CloudFormation execution roles for API Proxy and Image Upload in TEST. GitHub trust requires the exact repository, environment `test`, audience, and branch `refs/heads/test`. Only the matching CloudFormation role can be passed; artifact writes use the matching service stack prefix. Production synthesis retains its existing role count.

The bootstrap change set was inspected before execution: eight new IAM resources and CDK metadata only, with no removals or application resources. The TEST bootstrap update completed. This does not activate THN or provision service capacity.

Validation: CDK unit suite (65 tests), offline identity workflow, TEST synthesis and prepared change-set review. OIDC exchange and application deployment have not been exercised. API Gateway's generated Image Upload REST API id requires regional REST control-plane scope in its CloudFormation role; after first creation, narrow that scope to its verified TEST id. Runtime role creation and inline policy management remain privileged CloudFormation capabilities: repository write access is trusted deployment access, not a sandbox for untrusted templates. Inspect all IAM changes in application change sets. Existing runtime IAM boundaries were not redesigned.

API Proxy and Image Upload must adopt the accompanying workflow changes: pass the CloudFormation execution role and package under the exact TEST stack prefix. Previous release packages must not be assumed compatible with this contract. Validate a recovery release before enabling THN. Billing: IAM roles add no provisioned capacity; publishing the bootstrap template to the existing private S3 artifact bucket incurs small request/storage usage.

