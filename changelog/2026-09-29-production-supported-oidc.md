# Production deployment identity trust patch

Correct the canonical deployment identities to use AWS-supported exact aud/sub conditions. Three production GitHub roles previously required an unsupported custom ref key. Production branch restriction is independently enforced and checked through protected GitHub environments.

The identity workflow has an explicit trust-patch scope. It requires an existing identity stack, owner pool BLOCKED, identical Original/Processed templates, unchanged parameters, and exactly three Modify AWS::IAM::Role changes without replacement, solely for removal of ref from AssumeRolePolicyDocument. Bootstrap remains Add-only.

The operation checks effective GetRole/UpdateAssumeRolePolicy permissions for the exact three roles, fingerprints the CloudFormation execution role and provider schema, and seals the prior template and baseline in private versioned S3 before native review. Execution reuses the reviewed ARN and digest, verifies recovery bytes, repeats authority/baseline checks, and verifies role IDs, policies, boundaries, all resource identities, templates, parameters, owner-pool gate and bucket configuration afterward.

No IAM or CloudFormation update is authorized by this commit. A fresh protected review, its inventory/digest approval, and separately approved source-bound selectors are required before execution or service activation.
