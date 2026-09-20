# THN dedicated runtime identity in TEST

This is a separate, manual release for the three IAM resources added to the
existing TEST `ServiceRepositoryBootstrap` stack. It does not deploy the Frontend
stack, the API application, another draft, or production. Source preparation and
local tests do **not** establish that these resources exist in AWS.

The owning workflow is `.github/workflows/thn-dedicated-identity-test.yml`.
It accepts `verify` (read-only), `diagnose` (read-only postmortem of one failed
`apply` change set), `inspect` (read-only CloudFormation events for one failed
`apply`), or `apply` (one guarded update), a reviewed full
TEST promotion SHA and an independently reviewed SHA-256 of the three CDK
resource definitions. The workflow runs only on the exact TEST promotion merge
whose tree matches current `dev`. It validates its source and candidate before
obtaining GitHub OIDC credentials.

## Reviewed scope

- `ThnDedicatedRuntimeTestCloudFormationRoleCF799F56`: retained execution role
  for the standalone THN TEST runtime stack.
- `ThnDedicatedRuntimeTestGithubPolicy`: adds only the dedicated-stack release
  permissions to the existing API TEST GitHub role.
- `ThnDedicatedRuntimeTestExecutionPolicy`: bounds the new execution role to
  the dedicated runtime resources.

The candidate exporter reads these resources from the TEST CDK synthesis and
rejects a different resource set. The release guard compares the digest with
the separately selected input, checks the live GitHub role's exact TEST OIDC
trust, requires stable and termination-protected bootstrap state, and composes
the change from the live Original and Processed templates. Existing parameters
are reused, not read as plaintext or replaced. A change set must report exactly
three nonreplacing resource Adds before execution. The final stack template and
all three resource statuses are read back.

Pending and final templates are compared as canonical JSON (sorted object keys,
unchanged values). Raw Python mapping equality can reject equivalent
order-sensitive mappings returned by CloudFormation. Canonical comparison
does not permit a changed resource, parameter, or value.

To calculate the digest for review from the pinned source, without writing a
private binding, use the candidate exporter and canonical JSON helper:

```bash
node tools/thn-dedicated-identity-candidate.js | python -c 'import json,sys,hashlib;sys.path.insert(0,"tools");from thn_dedicated_identity_release import canonical;v=json.load(sys.stdin);print(hashlib.sha256(canonical(v["additions"])).hexdigest())'
```

An automatically calculated digest is not an independent review. Compare the
PR's exact resources and source SHA before dispatch. Run `verify` first. If it
fails, inspect that run's failed stage and the live stack; do not retry the same
candidate blindly. `apply` is the only operation that writes one immutable CDK
asset and executes the reviewed CloudFormation update. A failed change set is
left for diagnosis, not automatically retried or deleted.

For a failed `apply`, use `diagnose` with that run's ID, attempt, and source
SHA. The source SHA must be one of the five recent commits on the TEST
first-parent line before the new reviewed promotion; the diagnostic cannot
select an unrelated release. It checks asset encryption,
whether the exact candidate object exists, whether the exact change set exists,
and whether its resource delta, parameters, Original template and Processed
template match the reviewed candidate. It reports only fixed Boolean flags,
plus at most twenty redacted structural paths and a bounded difference count,
not template or parameter values. It never writes an object or executes a
change set. Errors from guarded AWS calls report only an allowlisted stage and
an AWS error code, never the service error message, template, object body, or
credentials. Analyze that
result and existing CloudFormation events before proposing a fix or another
`apply`.

When execution has started and the stack waiter fails, `inspect` uses the
failed run ID, attempt, and source SHA to select only events with that run's
CloudFormation client request token. It reports the protected stack status,
allowlisted failing logical IDs and statuses, and fixed reason categories or
IAM action names. It does not print the raw status reason or any event body,
and returns before the update path. Use it before considering recovery or a
second apply.

After a successful `apply`, verify the new role ARN from the live IAM readback
and configure `THN_DEDICATED_RUNTIME_CFN_ROLE_ARN` in the API proxy TEST
Environment. That variable is not a secret. The API's separate private release
plan and immutable, versioned runtime package are still required before its own
`verify` / `create` workflow. This IAM workflow does not activate the blog.

There is no automated destructive rollback. If access must be halted, keep the
runtime stack and data intact, close access through its service-owned gate, and
prepare a separately reviewed IAM change set if this identity must be removed.
