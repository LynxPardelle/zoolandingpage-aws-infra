# Exact THN TEST recovery permission revisions

This is a separate revision path, not a replay of the
[initial Hub/Image supplemental permission operation](thn-test-permissions.md).
It adds one named inline policy to an existing role in its verified owning
stack, independently selected for Config, API recovery, API runtime provisioning,
Config runtime inspection, or closed Auth provisioning. It also supports the
exact existing Image version-discovery correction described below. The Auth selection owns
only the new policy in Bootstrap; the existing manually created Auth deployment
role is never imported or recreated. No role, trust, original
policy, boundary, production resource or customer data is changed.

## Ownership and granted scope

### Hub native-version discovery correction

The independent `hub-version` selection modifies only the existing
`ThnTestHubSupplementalPolicy`. It adds `lambda:ListVersionsByFunction` to the
existing Lambda statement for the seven fixed Hub TEST functions and their
existing `test` alias ARNs. It introduces no resource selector, wildcard,
new role, policy, trust, version mutation, invocation, data access or production
change. Reusing the statement preserves the aggregate 10,240-character inline
policy limit; duplicating the seven resource ARNs in another statement exceeds it.

The private `THN_HUB_VERSION_BINDING_JSON` secret has the same six-field shape as
`image-version`, with `service=hub-version` and the exact reviewed Hub baseline
source. A fresh independently reviewed hash ledger binds the actual original
and processed owner templates and role policy. This selection requires the
protected, stable, unprovisioned Hub and absence of Stack.RoleARN. It verifies the
native service template has no THN runtime resources and refuses role adoption,
replay, unrelated policy differences, replacement, or additional changes.

Use the existing recovery permission workflow, first `verify`, then explicitly
approved `execute`. Do not replay the three-policy initial supplement operation
or Image recovery. Only one existing policy may be modified. This does not
provision or activate the Hub. Additional permissions for optional version
runtime/scaling/concurrency properties are not added by this correction; their
use requires separate evidence from the exact provider/property path.

| Selection | Owning source | Addition |
| --- | --- | --- |
| `config` | `createBackendSamDeployRoles`, Frontend | Exact versioned original ZIP/recovery record reads; exact Config TEST stack template/inventory reads |
| `config-runtime` | `createBackendSamDeployRoles`, Frontend | Separate `ThnTestRuntimeInspectionV1` policy: only `lambda:GetRuntimeManagementConfig` on the independently anchored, unqualified existing Config TEST function |
| `api` | `thn-test-deploy-identities`, ServiceRepositoryBootstrap | Exact versioned ZIP/record reads; exact API TEST stack template and `aws-recovery-*` change-set creation without a role argument; inspection and CloudFormation-mediated code updates of exactly three existing functions |
| `api-runtime` | `thn-test-deploy-identities`, ServiceRepositoryBootstrap | Separate `ThnTestRuntimeProvisioningV1` policy: exact forward package/plan and retained-route capture reads, dedicated Auth resource metadata, and narrowly bounded provider access for first provisioning/retained route transitions |
| `auth-provision` | ServiceRepositoryBootstrap, external existing Auth deploy role | Separate `ThnTestClosedProvisioningV1` policy: only the reviewed dedicated Auth TEST pool, functions, execution roles, table configuration and log groups |

`tools/thn-test-recovery-permission-policy.js` supplies both the canonical TEST
CDK hooks and the exact native-template addition. Each recovery policy is
`ThnTestObservedRecoveryV1`, with different owning roles/logical IDs. Runtime
provisioning is a later, separate one-policy addition; it never replaces or
rewrites that recovery policy. Selectors
are required NoEcho parameters, never defaults or raw values in source.
Production hooks are no-ops. Existing template resources/properties and original
policies are preserved, including the original baseline regression assertions.

This policy adds neither direct Lambda code-upload authority nor optional
bucket-control probes. It does not bind Lambda to a ZIP digest at the IAM layer:
the owning recovery driver must still verify the original versioned bytes and
exact change set. Denials or missing provider permissions stop the release;
they do not authorize broader roles or automatic scope expansion.

## Private binding and public ledger

Use `tools/thn-test-recovery-permissions.js` and the manual
[recovery permission revision workflow](../.github/workflows/thn-test-recovery-permissions.yml).
Inputs select one service and default to `execution=verify`. Execution also
requires `approve_exact_permissions=true`. The existing owning TEST concurrency
group serializes the operation.

The private canonical JSON binding has exactly these fields: `schemaVersion`,
`service`, `environment`, `account`, `stackId`, `package`, `record`, `functions`
for the two recovery selections.
Each object selector contains exactly `bucket`, `key`, `versionId`.
`functions` is empty for Config and contains exactly the three approved logical
function names/physical ARNs for API. Each API physical ARN must match its
independently observed SHA-256 identity anchor, remain unqualified, and belong to
the same account and region. Do not derive physical names from complete logical
IDs: provider-generated names may be shortened. Rebinding a reviewed ledger does
not replace these independent identity anchors. The execution preflight also
reconciles each physical ARN with its exact CloudFormation logical resource.
No wildcard or additional function permission is introduced by this validation.
The package selector/version is anchored
to the previously byte-verified original recovery evidence. The record is one
exact immutable version in its existing service channel. Config uses its
`system/deploy-artifacts/<sha>/<run>/<attempt>/aws-live-snapshot.json` family;
API uses its own TEST stack prefix. These are not wildcard grants.

Store each binding and channel name only in private TEST secrets:
`THN_CONFIG_RECOVERY_BINDING_JSON`, `THN_CONFIG_RECOVERY_CHANNEL_BUCKET`,
`THN_API_RECOVERY_BINDING_JSON`, `THN_API_RECOVERY_CHANNEL_BUCKET`.
Do not print, commit or place these values in public workflow inputs/artifacts.

For `config-runtime`, retain the original Config package/record selectors and
the same closed binding schema, set `service` to `config-runtime`, and supply
exactly `functions.ConfigAuthoringFunction`. Store this separate binding in
`THN_CONFIG_RUNTIME_BINDING_JSON`; reuse `THN_CONFIG_RECOVERY_CHANNEL_BUCKET`.
The original Config binding and recovery policy remain unchanged. The driver
checks the original object versions and reconciles the function with its
CloudFormation logical resource. Only one new required NoEcho parameter,
`ThnConfigRuntimeFunctionArn`, enters the owning template. No alias/version
wildcard, runtime-update action, code write, data access or service creation is
granted. A fresh reviewed ledger is required for this independent one-policy
Add; it does not replay the already-applied recovery addition.

For `api-runtime`, replace `functions` with `runtime` containing exactly
`apiId`, `authStackId` and `routesRecord`. The package is the reviewed forward
THN ZIP and the record is its canonical first-provisioning plan, both versioned
in the existing private service channel. `routesRecord` contains only `bucket`
and `key`: that capture is created *after* first provisioning. IAM permits
version reads at this one exact future key, never a prefix; the separate route
controller must pin and verify its precise version and digest before using it.
Store this binding/channel only in TEST secrets `THN_API_RUNTIME_BINDING_JSON`
and `THN_API_RUNTIME_CHANNEL_BUCKET`. The observed API physical ID must match
the existing API stack resource before any permission revision is applied.

`tools/thn-test-api-runtime-permission-policy.js` defines 14 required NoEcho
parameters and only the bounded runtime grants. Native generated function and
role names use the fixed THN namespace within the existing TEST API stack; no
shared function write or direct application-data access is granted. IAM and
Lambda writes and API PUT/POST/PATCH require CloudFormation forward access.
PassRole is additionally restricted to Lambda, AttachRolePolicy to the AWS
Lambda basic execution policy. The API body, deployment collection and Prod
stage are exact existing API resources. No delete action is added. Provider
reads include tags for the tagged function. Inspect effective permissions and
provider responses; this policy is not a guarantee that every future property
or optional Lambda feature is supported.

Independently review a canonical public hash ledger containing schema/service,
TEST/domain, exact source SHA and these digests: owning/service stack, binding,
original/processed templates, both composed templates, original role snapshot
and resolved new policy. `validateLedger` defines the closed schema. Pass only
its canonical base64 bytes and SHA-256 as workflow inputs. Do not build an
unreviewed ledger from whichever resources happen to be present at dispatch.

## Closed Auth TEST provisioning correction

`auth-provision` is tied to the reviewed immutable Auth TEST source. Its binding
contains only `schemaVersion`, `service`, `environment`, `account`, `stackId` and
`releaseCommit`. The source identity and every function, table, log and execution
role name are code-owned, not configurable grant selectors. Store this canonical
binding only in `THN_AUTH_PROVISION_BINDING_JSON` in the existing TEST environment.
No package/record selector or recovery-channel secret is needed for this target.

The private binding derives 24 required NoEcho parameters. The policy is owned by
Bootstrap, while the existing Auth deploy role remains outside that template.
Composition rejects attempted role adoption, an unexpected existing policy, stale hashes,
or any other resource change. Execution preserves the original role identity,
trust, policies and masked previous parameters. Auth must remain protected,
stable, not enabled and not provisioned when applying this initial correction;
duplicate or inconsistent flags fail closed. If both flags are absent, a direct
read of the exact service's native processed template must show no THN resources or flag
definitions, proving the legacy first-provision baseline. That exception cannot
read another stack, unprocessed source or a pending change set. The native document
also avoids parsing arbitrary SAM YAML in the sealed runner. No execution role is associated with
the Auth service stack.

The policy covers only:

- Cognito pool creation with region, exact stack/logical request-tag and
  CloudFormation conditions; client/group creation and MFA setup require the
  matching pool resource tags. Pool metadata needed by the closed verifier can
  be read directly. No account administration or user data permission is added.
- The three fixed THN functions and metadata, the owner's immutable versions,
  `test` alias and resource policy. The origin authorizer's fixed function and
  execution role use a different namespace from the original role's grant, so
  only that exact role/function receive missing creation/rollback operations.
  Its PassRole requires CloudFormation and `iam:PassedToService=lambda.amazonaws.com`.
  There is no human-role update, operator PassRole or new managed-policy grant.
- Backup/configuration metadata for five exact THN tables and the audit table's
  declared resource policy, never item access or retained-table deletion.
- Creation/retention/tag metadata for four exact retained log groups, never log
  events or log deletion. `DescribeLogGroups` is regional discovery on `*`, not
  resource-level isolation. Modern tagging uses the bare group ARN; other log
  operations use its `:*` access ARN.

CloudFormation-mediated writes do not grant direct application-data access.
The unavoidable `CreateUserPool` wildcard is restricted by the conditions above;
system-tag presence during the real create call remains a live release check,
not a conclusion from policy simulation. See the official
[Cognito authorization reference](https://docs.aws.amazon.com/service-authorization/latest/reference/list_cognito-idp.html).
No optional SMS, customer KMS, VPC, EFS, managed capacity or provisioned-concurrency
write is granted. Unused provider features are not inferred from denied inventory
probes. The original policy plus this exact correction is close to the IAM inline
quota; the runner checks the complete live aggregate and must stop on any drift.
Do not replace originals or switch to broader roles to work around the quota.

Applying this policy does not provision Auth or activate client access. Retry
only the owning immutable closed Auth provisioning workflow after independent
readback, required-action simulations and shared-resource baseline checks.

### Creation-time tagging revision

The Auth existing-policy exception is a correction from the exact original
`ThnTestClosedProvisioningV1` template. Cognito evaluates creation-time
`TagResource` against `userpool/*`, not `userpool/us-east-1_*`. Only that
statement uses the additional `ThnAuthProvisionPoolCreateTagArn` NoEcho value,
derived within the same fixed account and region. Its CloudFormation mediation
and exact stack/logical request-tag conditions remain unchanged. All other pool
operations keep the original, narrower resource scope.

The driver rejects already-corrected, widened, duplicated or drifted policies.
It requires the exact original 23 parameter definitions, sends their previous
values unchanged, and adds only the new tagging parameter. The native change
set must contain exactly one `AWS::IAM::RolePolicy` Modify with replacement
`False` and the independently observed existing physical identity. IAM readback
must match the approved replacement, with the original role/trust and all other
inline/attached policies unchanged. Quota checks count the replacement once.
The same existing binding secret is reused; no additional private selector is
accepted. Only Auth tagging and Image version discovery permit an exact existing-policy
revision; the other service selections remain Add-only.

## Image version-discovery revision

`image-version` modifies only the existing `ThnTestImageExecutorSupplementalPolicy`
in Bootstrap. Its sole new statement permits `lambda:ListVersionsByFunction` on
the unqualified private THN TEST Image function. It does not grant that action to
the GitHub caller, Hub or other functions. The original role, trust, other policy
statements, physical policy identity and owning-stack parameters stay unchanged.

The binding has `schemaVersion`, `service`, `environment`, `account`, `stackId`
and `releaseCommit`; source and target names are code-owned. Keep the canonical
binding in the existing TEST environment secret `THN_IMAGE_VERSION_BINDING_JSON`.
No new stack parameter or package/channel secret is used. Review the existing
hash-ledger schema against the exact old and composed templates and live role.

Composition requires the exact previously deployed policy including its executor
dependency; already revised, missing, widened, duplicated or foreign resources
fail closed. Other Hub/Image supplements with the same policy name on different
roles are preserved. The service must still be protected, closed CREATE_FAILED
with its existing CFN executor. The owner stack remains stable and protected.
The native change set must be one non-replacing policy Modify, never an Add or
whole-stack redeployment. IAM readback checks all original role/trust/policies.

Apply this correction through the independent revision workflow after verification.
Do not replay the initial three-policy ADD path or the failed Image `create`.
Image's owning retained-recovery operation must independently verify the partial
state and preserve the five resources. Neither the permission nor source promotion
enables uploads or the blog.

## Execution boundary

The unprivileged job proves the exact two-parent TEST promotion/current dev tree,
runs tests, then seals a fixed source/authority/ledger artifact. The credentialed
job performs no checkout, install or synth. It verifies that exact artifact
before OIDC and before every mutation, then assumes the existing separate
lookup, template publisher and deployment roles through private memory-only
credential transport. Service API recovery still has no associated CF role;
this permission revision uses only the owning Infra stack's existing executor.

Verification binds account, stable/protected owning stack, original templates,
parameters, role ID/trust/policies/quota, current service stack and exact object
versions/ownership. The execution path publishes only the NoEcho-reference
native template to the existing private content-addressed CDK channel, checks
its bytes/encryption, and reviews exactly one `AWS::IAM::RolePolicy` Add (or the
exact Auth tagging, Image version-discovery or Hub version-discovery Modify described above).
No other resource modification, replacement, deletion or original parameter
change is allowed. Returned native templates must match exactly; new parameter
readback must be masked. Final IAM readback must equal the original role/trust
and policies plus the one resolved approved addition.

Canonical source hooks retain these required selectors. They do not authorize
an ordinary full-stack deploy to apply the change. Before later full-stack
delivery, preserve the now-existing NoEcho values with the owning previous-value
mechanism; do not insert defaults, remove the policy or silently widen a normal
review guard to make synthesis deployable.

Failures are sanitized and stop. Existing change sets or content-addressed
template objects may remain for reconciliation; the runner never deletes them
or changes stack protection. There is no automatic rollback/uninstall policy
operation. Any removal or subsequent revision needs its own exact review.

## Not included or certified

- Applying the runtime policy does not run first provisioning or close/reopen,
  create the private captures, or establish that those live operations succeed.
- No broad service execution role is associated with the API stack.
- New compute/storage, front door, DNS, Cognito/owner account, writer activation,
  live recovery drills or customer acceptance.

Source/test success does not prove effective IAM access. Complete immutable
source promotion, fresh private/public ledger review, verification dispatch,
exact application and readback before claiming that permissions are deployed.
Config remains the first service deployment in the separate activation sequence.

## Local verification

```powershell
node --test test/thn-test-recovery-permission-policy.test.js test/thn-test-api-runtime-permission-policy.test.js test/thn-test-recovery-permissions.test.js
npm test
```

Tests use synthetic providers for actual orchestration and rejection decisions.
Production synthesis and original-policy baseline assertions remain unchanged.
