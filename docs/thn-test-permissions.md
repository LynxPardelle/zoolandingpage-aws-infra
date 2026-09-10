# THN TEST supplemental deployment permissions

This separate one-time path adds three `AWS::IAM::RolePolicy` resources to the
existing TEST ServiceRepositoryBootstrap stack. Source tests and simulations do
not establish deployment, effective workflow access or client readiness.
Production, other drafts and service application resources remain outside it.

## Ownership and authority

`tools/thn-test-permission-policy.js` defines the stable policy name
`ThnTestSupplementalDeploymentV1` on three existing roles. Bootstrap declares
these logical resources only in TEST; no existing role is imported or recreated.

| Target | Supplemental authority |
| --- | --- |
| Hub deploy caller | Seven exact THN function/alias families; registry resource policy; configuration reads for three tables; eight runtime roles; two operator mediator-invoke policies; the exact private bucket; Auth/Image TEST stack metadata. |
| Image deploy caller | Exact Image TEST stack template/protection; private table/bucket and function alias/concurrency metadata. |
| Image CFN executor | Exact private function aliases and failed-create rollback; native private bucket/table configuration reads. |

The service call matrix and native provider schemas inform the grants. Metadata
reads do not enable optional features. There is no new object/item write, secret
read, Lambda invocation, account activation or schedule enablement. Existing
broader original policies are not rewritten.

Hub has no separate execution role. Supplemental IAM operations require
`aws:CalledViaFirst=cloudformation.amazonaws.com`; only `GetRole` on the exact two
operator roles is directly available for service preflight. Attachments are
limited to `AWSLambdaBasicExecutionRole`, and PassRole to Lambda. No operator
trust change or operator PassRole is granted. CloudFormation forward access
sessions must be confirmed live. The existing Image service role does not use
this FAS condition.

Lambda IAM cannot express the desired alias name in every creation request;
exact functions and the service's closed `test`-alias runner are complementary
controls. IAM also cannot restrict the termination-protection boolean: closed
clients permit only `true`. Aggregate inline-policy size, including originals,
must remain below 10,240 characters; the reviewed Hub combination is close to
this limit. Never expand scope or replace roles to evade a quota rejection.

## Immutable dispatch

Use `.github/workflows/thn-test-permissions.yml`, not the
[single-Add prerequisite workflow](thn-test-prerequisites.md). It requires manual
TEST invocation, an exact two-parent promotion with current dev as second parent
and identical tree, and the existing shared TEST stack concurrency group.

Inputs: `approve_exact_permissions=true`, `reviewed_ledger_base64`, and
`reviewed_ledger_sha256`. The independently reviewed ledger is UTF-8, two-space
JSON plus newline, at most 8 KiB, with exactly:

`schemaVersion`, `environment`, `domain`, `sourceSha`, `stackIdSha256`,
`originalTemplateSha256`, `processedTemplateSha256`, `composedTemplateSha256`,
`composedProcessedTemplateSha256`, `policyResourcesSha256`, `roleBaselinesSha256`.

Version is 1, stage is `test`, domain is `thehairnarrative.com`, source is the
exact promoted 40-character SHA. Hashes use recursively ordinally sorted object
keys and preserve array order. The role map contains the three policy logical
IDs. Capture full role/trust/original policies in memory; `roleSnapshot` ignores
only dynamic RoleLastUsed and sorts tags. It rejects recreation, boundaries,
unexpected policies and name collisions. No raw private captures belong in
ledgers, logs or artifacts. Self-generated hashes are not independent approval.

`node tools/thn-test-permissions.js prepare|verify|run DIRECTORY` is a closed
GitHub entrypoint. Uncredentialed validation seals tools, hashes and source/run
coordinates. Authority includes already reconstructible account/CDK-role/bucket
coordinates, not just hashes. Execution downloads by artifact ID, verifies the
external manifest and exact inventory before OIDC, and has no checkout, install
or synthesis. Existing sealed lookup/publisher/deploy/CFN identities are reused;
temporary sessions stay isolated in process memory.
The shared Linux CLI adapter supplies a real anonymous stdin pipe without writing
private JSON to files, arguments or logs; the fixed launcher and native offline
regression are described in [the prerequisite transport](thn-test-prerequisites.md).

Before each mutation, artifact authentication, live Original/Processed templates,
parameters and all three role baselines must still match. The exact stable stack
must retain its existing CFN RoleARN. Protection is enabled if absent and read
back as true. The only template delta is three policies; previous parameters use
UsePreviousValue, including NoEcho values. All other resources/properties,
metadata, conditions and outputs remain unchanged.

The secret-free template uses the existing private CDK bucket and SSE-KMS key,
an exact run/attempt/source/content-hash prefix and a non-overwriting conditional
PutObject. Publisher and deploy sessions verify checksum and encrypted bytes.
The native UPDATE review accepts only three expected RolePolicy Adds, no
replacement, removal, modification, nesting or extra resources. Unknown request
fields and side effects are rejected. Execution uses the returned immutable
change-set ARN plus pinned StackId. Final verification requires UPDATE_COMPLETE,
protection, exact templates/parameters, owned policies and unchanged original
roles/trust/policies. Simulations do not prove SCP/resource/session-policy or
provider behavior; the real workflow remains a gate.

## Failure, preservation and cost

Failure emits a sanitized guard error and requires reconciliation. Native
rollback is not success; new policies are not retained so CFN can roll back
their failed addition without deleting existing roles. After success, this
initial-only runner deliberately rejects replay/name collisions. Policy revision
or removal needs another independently reviewed exact change set and impact
assessment. Never delete stacks, original policies, data, buckets or DNS to
recover. Future Bootstrap updates must preserve these logical IDs and stable
policy/role names; old assemblies cannot silently remove them.

IAM has no additional charge per the [AWS IAM FAQ](https://aws.amazon.com/iam/faqs/).
This path reuses existing infrastructure and requires no GitHub plan upgrade.
Artifact storage/requests, Actions usage and later blog services retain their
normal billing; this is not a zero-cost guarantee or automatic spending cap.
No cleanup service or schedule is introduced; retained metadata is not assumed
to purge itself.

Client readiness still requires approved service releases, private origin,
human MFA, publish/withdraw/rollback QA and
[bounded resource-inventory acceptance](thn-test-resource-inventory.md).
