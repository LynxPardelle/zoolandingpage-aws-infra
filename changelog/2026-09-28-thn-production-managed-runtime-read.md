# Production Runtime managed runtime read

- Add `lambda:GetRuntimeManagementConfig` only to the production Runtime deployment caller policy on the exact existing production function ARN. Preserve the existing role, resource, conditions, trust and all other statements.
- Mirror that action in the retained identities template and permission proof matrix. The CloudFormation executor and TEST functions receive no new permissions.
- Reproduce the missing read with a failing regression, then verify the exact grant, denial of other function/qualifier targets and runtime mutation actions, canonical policy hash and sealed bootstrap policy match with Node 22.
- This source change does not apply IAM permissions or activate AWS. Its new template and source package hashes require a fresh protected review and separate exact inventory authorization.
