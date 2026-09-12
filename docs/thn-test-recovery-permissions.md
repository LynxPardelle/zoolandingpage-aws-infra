# Exact THN TEST recovery permission revisions

This is a separate revision path, not a replay of the
[initial Hub/Image supplemental permission operation](thn-test-permissions.md).
It adds one named inline policy to an existing role in its verified owning
stack, independently selected for Config or API. No role, trust, original
policy, boundary, production resource or customer data is changed.

## Ownership and granted scope

| Selection | Owning source | Addition |
| --- | --- | --- |
| `config` | `createBackendSamDeployRoles`, Frontend | Exact versioned original ZIP/recovery record reads; exact Config TEST stack template/inventory reads |
| `api` | `thn-test-deploy-identities`, ServiceRepositoryBootstrap | Exact versioned ZIP/record reads; exact API TEST stack template and `aws-recovery-*` change-set creation without a role argument; inspection and CloudFormation-mediated code updates of exactly three existing functions |

`tools/thn-test-recovery-permission-policy.js` supplies both the canonical TEST
CDK hooks and the exact native-template addition. Each policy is
`ThnTestObservedRecoveryV1`, with different owning roles/logical IDs. Selectors
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
`service`, `environment`, `account`, `stackId`, `package`, `record`, `functions`.
Each object selector contains exactly `bucket`, `key`, `versionId`.
`functions` is empty for Config and contains exactly the three approved logical
function names/physical ARNs for API. The package selector/version is anchored
to the previously byte-verified original recovery evidence. The record is one
exact immutable version in its existing service channel. Config uses its
`system/deploy-artifacts/<sha>/<run>/<attempt>/aws-live-snapshot.json` family;
API uses its own TEST stack prefix. These are not wildcard grants.

Store each binding and channel name only in private TEST secrets:
`THN_CONFIG_RECOVERY_BINDING_JSON`, `THN_CONFIG_RECOVERY_CHANNEL_BUCKET`,
`THN_API_RECOVERY_BINDING_JSON`, `THN_API_RECOVERY_CHANNEL_BUCKET`.
Do not print, commit or place these values in public workflow inputs/artifacts.

Independently review a canonical public hash ledger containing schema/service,
TEST/domain, exact source SHA and these digests: owning/service stack, binding,
original/processed templates, both composed templates, original role snapshot
and resolved new policy. `validateLedger` defines the closed schema. Pass only
its canonical base64 bytes and SHA-256 as workflow inputs. Do not build an
unreviewed ledger from whichever resources happen to be present at dispatch.

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
its bytes/encryption, and reviews exactly one `AWS::IAM::RolePolicy` Add.
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

- Route closure-specific metadata reads, its separate versioned capture, or
  provider permissions for API/stage/deployment changes.
- First THN API forward provisioning without the excluded broad service role.
- New compute/storage, front door, DNS, Cognito/owner account, writer activation,
  live recovery drills or customer acceptance.

Source/test success does not prove effective IAM access. Complete immutable
source promotion, fresh private/public ledger review, verification dispatch,
exact application and readback before claiming that permissions are deployed.
Config remains the first service deployment in the separate activation sequence.

## Local verification

```powershell
node --test test/thn-test-recovery-permission-policy.test.js test/thn-test-recovery-permissions.test.js
npm test
```

Tests use synthetic providers for actual orchestration and rejection decisions.
Production synthesis and original-policy baseline assertions remain unchanged.
