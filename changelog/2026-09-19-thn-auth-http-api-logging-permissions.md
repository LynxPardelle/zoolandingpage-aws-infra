# 2026-09-19 — Proposed Auth TEST HTTP API logging permission revision

Status: prepared locally for review; not published, applied to AWS or used for another Auth enable attempt.

The first Auth enable after the origin-authorizer IAM repair reached the TEST HTTP API stage and failed because the Auth deploy identity lacked `logs:CreateLogDelivery`. CloudFormation rolled the service stack back to its protected, provisioned, disabled state.

This proposal extends only the existing `ThnTestAuthEnableV1` managed policy from its exact deployed `v2` document to a proposed `v3` document. It adds the documented HTTP API log-delivery and resource-policy actions on `Resource: "*"`, conditioned on CloudFormation forward access and `us-east-1`. The wildcard is required for those permission-only/account-level actions; it is not an ARN-prefix workaround. The role attachment, trust, two inline policies, other selectors, Hub and Image Upload policies, and Auth service template are unchanged.

The runner requires the exact `v2` policy and sole Auth deploy-role attachment before writing; after a reviewed change set it expects `v3` and unchanged attachments. The account-level `logs:PutResourcePolicy` action remains a security consideration for the review. No service activation or private access follows from this permission proposal alone.

Local review: 49 focused tests passed. The proposed document retains its ten prior statements byte-for-byte in their existing order and adds one logging statement; it remains below the managed-policy size limit. IAM simulation allowed the two sensitive logging actions only with the CloudFormation and TEST-region context, and implicitly denied direct or wrong-region requests. The full local suite passed 299 tests, skipped one, and retained one unrelated Windows line-ending failure in `classify-test-promotion.test.js`; no source or workflow file for that test changed. Neither simulation nor local tests prove API Gateway will supply the expected forward-access context during a real stage creation.
