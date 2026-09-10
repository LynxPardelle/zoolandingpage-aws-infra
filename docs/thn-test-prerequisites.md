# THN TEST retained prerequisites

The manual `.github/workflows/thn-test-prerequisites.yml` prepares only one
reviewed retained resource in one existing TEST stack. It is local implementation,
not evidence of issuance, role creation, effective assumed-role access or a live
deployment. It introduces no stack, bucket, hosted zone, cleanup service or public
route. The ordinary Frontend workflow is not a bootstrap path.

## Closed operations and ownership

| Operation | Existing owning stack | Only resource Add |
| --- | --- | --- |
| `certificate` | TEST Frontend | `ThnAdminTestCertificate`, native ACM certificate |
| `operator-role` | TEST ServiceRepositoryBootstrap | `ThnTestHumanOperatorRole`, permissionless human IAM role |

Both stack identities are independently pinned by hash, as are the account,
existing CDK roles, template bucket, encryption key and public hosted zone. The
human anchor is the exact independently verified IAM user of the approved operator
profile, not root, an arbitrary principal, another role or GitHub OIDC. Auth and
Hub separately own their closed mediator-invoke policies; the human role gets no
direct Cognito, DynamoDB, CloudFormation or registry-data permission here.

The existing live stacks were stable but did not have termination protection.
For only these two pinned StackIds, the runner first verifies identity and stable
baseline, enables protection, and requires a true readback before continuing.
Missing/denied authority stops; there is no disable or deletion operation.

## Inputs, source and exposure boundary

Dispatch requires the exact TEST promotion commit, one closed operation,
`approve_exact_prerequisite=true`, a canonical base64 ledger and its independently
approved SHA-256. The ledger is UTF-8, two-space JSON plus newline, at most 8 KiB,
with exactly:

`schemaVersion`, `environment`, `domain`, `operation`, `sourceSha`,
`stackIdSha256`, `originalTemplateSha256`, `processedTemplateSha256`,
`composedTemplateSha256`, `principalSha256`, `hostedZoneSha256`,
`dnsBaselineSha256`.

Schema version is 1; environment is `test`; domain is `thehairnarrative.com`.
Source is the exact 40-character commit. All applicable digests are lowercase
SHA-256, obtained through the separate reviewed capture/composition process;
inapplicable principal or zone/DNS fields are null. Hashing an unreviewed candidate
against itself is not approval. Template/DNS hashes use recursively ordinally
sorted object keys; arrays retain their contract order, with DNS records and
record values explicitly normalized by the tool. The ledger is not a cloud
snapshot and cannot prove that a capture or review was complete.

The new TEST secret `THN_TEST_OPERATOR_PRINCIPAL_ARN` supplies the private human
principal only for `operator-role`; its account/type and independent seal must
match. The existing TEST variable `FRONTEND_TEST_THN_ADMIN_HOSTED_ZONE_ID` supplies
the exact normalized zone for `certificate`, also matched to an independent seal.
Absent/mismatched input fails before OIDC. This work does not configure either
input, remove Environment protections, or create an Environment.

The uncredentialed preparation job derives authority from the exact checked-out
source. Its artifact contains the ledger, run/source coordinates, fixed verifiers,
and `authority.json`. **Authority is not hashes-only:** it contains the already
reconstructible TEST account/region, stack name, default CDK role names/ARNs and
template bucket. These are derived from the existing tracked repository context
and standard CDK qualifier, checked against independent fixed seals; no new free
authority input is accepted. Tests prove this projection for both real assemblies.
The artifact contains no human ARN, NoEcho value, zone input, live template, DNS
snapshot, private runtime binding or service configuration.

The execution job has no checkout, npm install or synthesis. Before running any
transported tool, it verifies the external manifest digest and every listed file.
The sealed verifier then checks the exact inventory, source/run/operation and
private-input seals before OIDC. It repeats authentication before role assumption
and every mutation. The original OIDC identity stays unchanged; existing lookup,
publisher and deploy sessions exist only in isolated process memory.

## Exact live composition and encrypted transport

Live Original and Processed template hashes must equal the reviewed ledger. The
runner composes each by adding only the reviewed resource; the operator operation
also adds one `NoEcho` string parameter. All original resources, properties,
metadata, outputs, conditions and parameters remain intact. Existing parameter
values and SSM resolved values are captured in memory and rechecked before each
mutation; the CreateChangeSet request uses `UsePreviousValue` for them.

The live templates exceed CloudFormation's inline body limit. The secret-free
composed template uses the existing private CDK bucket, exact operation/run/source/
template-hash key, `IfNoneMatch=*`, existing SSE-KMS key and checksum. It does not
downgrade encryption. The publisher and deploy roles each read and hash the exact
encrypted bytes before ExecuteChangeSet. CloudFormation must also accept the
pinned TemplateURL and return the exact reviewed Original and Processed templates
for that change set. Policy inspection or mocked Put/Get is not effective live
access; D must establish it. A transport denial stops without any IAM grant.

Only an UPDATE request with the exact existing CFN execution role is sent. The
review requires the exact returned change-set identity, available status and
exactly one matching resource Add, without replacement or nested stacks. RoleARN
is pinned in the request and checked through DescribeStacks, not demanded from
DescribeChangeSet, whose native response omits it. Existing parameters must match
the baseline (or explicitly reflect previous-value use); new NoEcho must return
the native `****` mask. That mask does not prove the hidden value: equality is
anchored in the authenticated request and exact final IAM trust readback.

The human value is passed to AWS CLI through stdin JSON, never command arguments,
files or logs. Only `Ref` to its NoEcho parameter appears in the private template.
On Linux, the shared CLI adapter uses a fixed Bash process-substitution pipe:
Node's stdin socket cannot be reopened through `/dev/stdin`. The launcher saves
that input on a separate descriptor before starting the asynchronous producer,
explicitly redirects the producer from it, and closes the extra descriptor for
AWS CLI. `exec` preserves
the child timeout target; privileged-shell mode ignores inherited shell startup
files, functions and tracing without acquiring privileges. All arguments remain
quoted positional values and private JSON remains stdin-only. Linux CI reproduces
the original descriptor error and verifies the native CLI with offline skeleton
generation, without credentials or cloud access.
The S3 body uses the CLI's streaming-file argument, not a JSON path interpreted as
object content. [AWS CLI PutObject contract](https://docs.aws.amazon.com/cli/latest/reference/s3api/put-object.html).

## Native certificate and future preservation

The native certificate has the exact admin FQDN as DomainName and in its singleton
DomainValidationOptions, the pinned existing parent hosted zone, DNS validation,
export disabled, no extra SAN and both retention policies set to Retain. Native
CloudFormation owns DNS validation. The tool never calls Route53 change APIs;
it does not claim the provider's internal operation is CREATE-only.

The runner captures every bounded page of the exact zone before mutation and
again at closeout. Every previous record, including mail, must remain identical;
only the exact validation CNAME returned by this certificate may be added. An
existing identical CNAME is accepted; collisions or any other DNS difference fail.
Readback requires the same owned logical certificate, account/region, `ISSUED`,
exact domain and singleton SAN. The selected ARN hash is then recorded for the
normal immutable release, not printed as a raw identifier.

Current [CloudFormation validation rules](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-certificatemanager-certificate.html)
and the [CDK parent-zone example](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_certificatemanager.CertificateValidation.html)
support this design. An [older AWS blog warning](https://aws.amazon.com/blogs/security/how-to-use-aws-certificate-manager-with-aws-cloudformation/)
conflicts on subdomain/parent-zone behavior. Local tests do not establish progress
in AWS: direct D observation remains an operational risk check. Timeout/failure
stops and requires reconciliation of the planned retained resource; no retry may
create a second certificate, delete data or remove validation DNS.

TEST Frontend synthesis preserves the same logical certificate whenever its
selected ARN and zone are configured, even with the admin origin disabled. Normal
deploy/rollback proves the live resource already exists, has the same exact
properties/retention and selected physical ARN, and is issued before any mutation.
The ordinary reviewer rejects all certificate Adds, modifications, replacements
and removals. Artifacts predating this ownership cannot silently remove it.
TEST bootstrap synthesis likewise preserves the human role and NoEcho parameter;
future approved updates must retain its parameter value and service-owned grants.
Production synthesis does not declare either prerequisite.

## Remaining execution gates

This dispatch cannot carry Image caller/execution-role corrections or a policy
for the pre-existing Hub caller: those would violate its single-Add review. Image
identity IaC belongs to this repository's `thn-test-deploy-identities.js`; the Hub
caller's original IaC ownership remains unproven. Their exact reviewed permission
matrix is implemented separately by the [three-policy supplemental path](thn-test-permissions.md),
not by a third operation in this single-Add dispatch or a new Hub CFN role.
That path still requires verified promotion, reviewed live baselines and execution.
No operative grant is established by this prerequisite source alone.

Before D: configure the sealed private inputs and reviewed ledger, establish
successful source promotion/artifact transport, verify effective existing-chain
access, then execute and directly observe each approved prerequisite. Hub owns
its complete absent mediated-registry bootstrap, separately from its seven-pair
THN release. Auth owns the approved QA path. Capture the QA inventory only after
planned activation/deployment/rollback is complete; QA itself adds zero resources.
The [offline resource comparator](thn-test-resource-inventory.md) is not a collector
or cleanup tool and does not establish an account-wide or zero-cost claim.
