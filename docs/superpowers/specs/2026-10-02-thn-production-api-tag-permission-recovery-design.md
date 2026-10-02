# THN production API: API Gateway tag permission and failed-create recovery

## Incident and verified cause

The protected API review `37049166005` sealed nine `Add` changes at API Proxy MAIN
`042ad1c26962196decd849054ddef66655eff7fa`. The approved execute run
`37049791094` reached CloudFormation, then failed while creating `ThnRuntimeApi`.
The CloudFormation event and CloudTrail `CreateRestApi` event both report the
CloudFormation execution role missing `apigateway:PUT` on
`arn:aws:apigateway:us-east-1::/tags/arn%3Aaws%3Aapigateway%3Aus-east-1%3A%3A%2Frestapis%2F*`.
The live role policy allows `apigateway:PUT` only on `/restapis` and
`/restapis/*`. IAM simulation permits the latter and denies the tag path.

The live CloudFormation provider schema marks both `AWS::ApiGateway::RestApi`
and `AWS::ApiGateway::Stage` as taggable on create, with `apigateway:GET`,
`PUT`, and `DELETE` tagging permissions. Neither resource declares `Tags` in
the processed candidate template; CloudFormation still propagates stack tags.
The current API permission plan simulated 136 allowed action/resource pairs,
but omitted the tag path. Its guard checked the provider's action names without
requiring the corresponding tag resource ARN. This is why the preflight passed.

The stack ended `ROLLBACK_COMPLETE` with termination protection enabled.
CloudFormation removed the Lambda function, alias, and REST API. The retained
`/aws/lambda/zlp-thn-auth-runtime-production` log group exists with zero stored
bytes and zero streams. The version is marked `DELETE_SKIPPED` in stack history,
but the parent function no longer exists. No new execution may reuse the old
review or digest.

## Chosen approach

Patch only the retained `ThnProductionApiNative0` managed policy on the exact
CloudFormation execution role. Add a separate statement permitting
`apigateway:GET`, `apigateway:PUT`, and `apigateway:DELETE` in `us-east-1` on
the URL-encoded `/tags/.../restapis/*` resource path. This covers the REST API
and its `Prod` stage without broadening the preexisting `/restapis/*` rule or
the GitHub OIDC role. Do not grant `apigateway:*` or application data access.

In the infrastructure repository, add a protected, one-purpose identity patch
operation. Its candidate derives from the live identity-stack template and
changes only `ApiCfnNativePolicy0.PolicyDocument`. It must check the exact old
policy document, role attachment, stack identity, current resources, and source
SHA; reject any additional direct or conditional change, replacement, or
identity drift. Review creates a temporary change set and seals an inventory
and digest; execution repeats the checks, applies only that digest, and proves
the effective permission on the exact tag path afterward. The review and
execution require separate approvals.

In the API repository, extend the native permission projection so an Add of
the REST API or stage requires a simulated execution-role request for the tag
path and the three tagging actions from the live provider schema. Reject a
missing or widened request before creating a change set. Extend the production
permission plan with a separate tag-path request; keep the existing API path
request and all other secrets unchanged except `sourceSha` when code is
promoted. A regression test must reproduce the original 136/136 false pass
and prove that omitting the tag path now blocks review before AWS writes.

Alternatives considered: removing template `Tags` cannot prevent CloudFormation
stack tags on the API or stage; a broad API Gateway policy would cover unrelated
resources. Neither is selected.

## Recovery and release order

1. Finish a read-only audit of the failed stack, retained log group, other API
   names, nine provider handler schemas, IAM action/resource pairs, and source
   selections. Save exact IDs and hashes. Stop if any resource or state differs.
2. Implement and locally test the infrastructure and API guard patches. Promote
   each through `dev → test → main` with the repository's source selectors and
   mandatory CI; keep AWS deployment jobs skipped. No production mutation is
   authorized by source promotion.
3. Review the infrastructure IAM patch. Require an inventory with only one
   `Modify` of `ApiCfnNativePolicy0.PolicyDocument`, no replacement, and an
   exact digest. Apply only after separate approval, then simulate the real
   execution role against the tag path and recheck all prior API permissions.
4. Recover the failed API stack separately: recheck its exact stack ID and
   `ROLLBACK_COMPLETE` state, termination protection, resource history, and
   zero-byte/zero-stream log group with matching stack tags. After separate
   explicit approval, disable protection and delete only that failed stack and
   the exact empty retained log group. Verify the Lambda, API, and log names are
   free. Do not delete a log group containing data or another stack's resource.
5. Update only the API permission-plan and prerequisite `sourceSha` secrets for
   the promoted API MAIN. Perform a fresh protected API `review`; compare all
   nine resources, package bytes, templates, parameters, source, IAM, and
   owner-stack hashes. Obtain a new inventory and digest. Apply only after a
   separate approval. Verify stack resources, Lambda alias, API stage, logs,
   registry prerequisites, and the private route without creating users or
   publishing articles.

## Acceptance and stop conditions

- The local guard rejects the old plan's missing tag ARN and accepts only the
  exact tag path with `GET`, `PUT`, and `DELETE` under `us-east-1`.
- IAM simulation of the proposed statement permits all three lowercase
  simulator actions for a concrete encoded API and stage tag ARN; the live role
  postcheck must match after its protected IAM execution.
- Infrastructure review has one policy-document modification, no replacement;
  API review has only the nine previously reviewed Adds.
- Any new resource, drift, denial, unexpected CloudFormation status, nonempty
  log group, changed branch SHA, or changed review digest stops the sequence.
- A successful API stack alone does not activate the public editor or admit
  the owner. Those are separately reviewed production steps.
