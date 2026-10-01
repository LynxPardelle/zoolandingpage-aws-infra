# THN production owner pool bootstrap guard

Date: 2026-10-01. Scope: the protected `bootstrap` operation for the production deployment identities stack in account `765932874577`, region `us-east-1`.

## Incident and decision

The Auth Admin production stack owns a Cognito pool, but the identities stack still has `ThnProductionOwnerPoolArn=BLOCKED`. Four conditional IAM policies must become active before API Proxy can verify the owner metadata. The current bootstrap guard checks that a CloudFormation change set adds exactly those four policies, but does not verify its parameter value. A change set naming another pool can therefore pass inventory review. Keep the existing bootstrap operation and require the exact pool ARN captured from the Auth Admin stack in both review and execution.

## Preconditions and inventory

For an existing identities stack, require its single pool parameter to equal `BLOCKED` before creating or executing the change set. Capture the pool physical ID from the exact `ThnAuthAdminV2UserPool` resource and construct its account and region scoped ARN. Require the change set's complete parameter list to contain exactly one entry: `ThnProductionOwnerPoolArn` with that ARN. Reject `BLOCKED`, another ARN, duplicate or extra parameters, and parameter drift between review and execution. Preserve the existing template and physical identities; the only allowed native resource changes are the four conditional IAM policy Adds, without replacement. The historical first-time CREATE path remains valid with its own expected parameter list.

## Execution and verification

The retained review includes the parameter hash and native inventory. Execution repeats the baseline, parameter, template, resource and digest checks before calling CloudFormation. After completion, read the stack parameter and require the exact captured pool ARN. Check the expected 36 active resources and preserve the 32 prior physical identities. A failed postcheck stops the workflow and must not trigger an automatic retry or a different release. No Auth pool, user, route, article or other service changes belong to this operation.

## Verification and release

Add a regression using the production manifest and the four conditional policies: the correct pool parameter passes, and a wrong, blocked, duplicate, missing or extra parameter fails. Check the existing-stack baseline and post-execution parameter assertions separately. Run the complete local infra tests, workflow lint and read-only AWS comparison before a push. Promote source through `dev`, `test` and `main` with AWS jobs skipped. The protected review produces an exact inventory and digest for a separate approval; execution requires another explicit approval of that digest.

## Considered approaches

- An external preflight alone would not protect the retained change set against parameter drift, so it is insufficient.
- A new deployment scope would duplicate the existing bootstrap path and its review machinery without improving isolation.
