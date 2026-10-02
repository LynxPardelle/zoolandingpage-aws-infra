# THN production API Gateway tag permission recovery

The protected deployment-identities workflow adds `api-tag-path-patch`. Its candidate appends one region-scoped `apigateway:GET`/`PUT`/`DELETE` statement to the existing `ThnProductionApiNative0` managed policy. The only accepted CloudFormation inventory is one no-replacement `Modify` of `ApiCfnNativePolicy0.PolicyDocument`; a broader path, another resource, or a changed role identity fails closed.

Before a review can upload a template, the scope compares the live stack and managed-policy version with the approved baseline, checks the CloudFormation provider permissions, simulates the policy writer's exact actions, and simulates the proposed encoded tag-path grant. Execution repeats the proof and verifies the role and policy after update. The failed private API release remains rolled back; this code change does not remove its protected stack or retained log group.

Local identity tests and the full infrastructure suite are required before promotion. IAM review, IAM execution, failed-stack cleanup, and a fresh private API review and execution remain separate production operations under the approved recovery design.
