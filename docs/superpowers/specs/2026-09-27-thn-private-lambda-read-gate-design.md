# THN TEST private Lambda configuration read gate

Date: 2026-09-27. Scope: the manual THN Admin TEST Private Release Rotation workflow and the existing GitHub OIDC role for `LynxPardelle/zoolandingpage-aws-infra:environment:test`.

## Problem and evidence

Review run `36346402691` stopped at `private_release_live_state_invalid_lambda` before creating a change set. The private SSR Lambda is active, its last update succeeded, and its name, ARN, code hash shape, physical ID, and environment variables match the active CloudFormation Original template when read with the account administrator. Its function revision and the frontend stack have not changed since 2026-09-26.

The CDK bootstrap lookup role returns `Environment.Error.ErrorCode=AccessDeniedException` and no environment variables from `GetFunctionConfiguration`. Its `LookupRolePolicy` has `DontReadSecrets`, an explicit `kms:Decrypt` deny on `*`. The function uses the AWS managed `aws/lambda` key, with no customer `KMSKeyArn`. The workflow's TEST OIDC role currently has an implicit deny for `lambda:GetFunctionConfiguration` on this function and no explicit KMS deny. The CDK deploy role cannot read this function either. Therefore the preflight is comparing absent variables with the live template, rather than detecting Lambda drift.

## Selected design

Preserve the CDK bootstrap lookup role and its secret-read deny. Add a separate inline policy named `ThnAdminPrivateReleaseLambdaRead` to `zoolandingpage-infra-test-github-oidc-deploy` with one allow statement: `lambda:GetFunctionConfiguration` on `arn:aws:lambda:us-east-1:765932874577:function:zoolandingpage-test-frontend-thn-admin-ssr`. Do not grant `kms:Decrypt`, other Lambda actions, wildcard resources, or permissions to another role. The existing trust limits this role to the infrastructure repository's GitHub `test` environment.

During the manual rotation preflight, use the already established OIDC session only for that exact Lambda read. Continue using the CDK lookup role for every other live read and the existing guarded role for change-set operations. Pin and verify the OIDC caller account and role before the direct Lambda call. The command wrapper accepts only `get-function-configuration` for the exact function and does not accept arbitrary CLI arguments, profiles, or endpoints. A missing `Environment.Variables`, any `Environment.Error`, a mismatched caller, or a mismatch with the Original template fails closed with a specific sanitized code. Never log variable values, credentials, or the AWS error message.

The release candidate, three-resource change-set allowlist, race checks, and postcheck remain as defined in `2026-09-27-thn-admin-test-private-release-rotation-design.md`. This correction changes neither the TEST frontend stack nor a public host, authoring service, QA account, or article.

## Verification and rollback

First review the exact inline policy JSON and confirm no policy with that name already exists. Apply it only after a separate, concrete AWS permission approval. Verify through IAM simulation that the OIDC role can read only this function, then run the manual workflow in `review` mode. A successful review must still inspect and delete its unexecuted change set; it is not permission to execute. If the AWS managed key still prevents the OIDC read, stop and revise the design rather than weakening the environment comparison.

Offline tests cover accepted caller and command identity, wrong role/function/region rejection, `Environment.Error` rejection, exact variable equality, no sensitive output, and unchanged change-set gating. Run the infrastructure suite and credential-free TEST validation before code-only promotion. The inline policy can be removed by its exact name to restore prior permissions if the read fails or the workflow is retired. A later `execute` requires its own reviewed change-set inventory and release approval.

## Alternatives considered

- Changing the CDK lookup role's global KMS deny would expand access for unrelated consumers and conflicts with its `DontReadSecrets` policy.
- Creating a new read role would require a new trust path and more IAM resources for this single read.
- Accepting absent environment variables would remove the drift check that protects the private SSR Lambda release.

## References

- `tools/thn-admin-private-release-rotation.js` and `tools/infra-test-aws.js`
- `.github/workflows/deploy-thn-admin-private-release-test.yml`
- [AWS Lambda environment-variable encryption](https://docs.aws.amazon.com/lambda/latest/dg/configuration-envvars-encryption.html)
