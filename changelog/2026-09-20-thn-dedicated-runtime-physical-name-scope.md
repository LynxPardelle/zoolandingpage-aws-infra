# THN dedicated runtime physical-name scope (TEST)

The first guarded `create` of `zoolanding-thn-auth-runtime-test` failed in
CloudFormation. The execution policy allowed only physical names beginning
`zoolanding-thn-auth-runtime-test-`, while CloudFormation generated the role
name with the truncated prefix `zoolanding-thn-auth-runti-`. `iam:CreateRole`
was denied and the rollback also denied `iam:DeleteRolePolicy`. The stack is
therefore `ROLLBACK_FAILED` with one residual generated role; the blog is not
activated.

Locally, the Lambda, generated IAM role, and log-group policy resources now
use the narrower common generated prefix `zoolanding-thn-auth-runti*` in the
same account and region. The dedicated policy test covers the observed role
shape, plausible function/log names, and exclusion of Auth Admin. The full
local Node test suite passed (315 passed, 1 skipped). A read-only IAM policy
simulation allowed `CreateRole`, `DeleteRolePolicy`, and `TagRole` on the
observed role ARN.

The current `dev` branch uses a separate managed GitHub policy. The revision
keeps that policy unchanged and updates only the execution policy's five ARN
patterns. Read-only comparison against both original and processed live TEST
templates confirmed exactly one resource difference, and the existing IAM
execution document matches the guarded baseline. The manual revision workflow
requires an exact reviewed TEST source and digest, then rejects any change set
that changes another resource or replaces the policy.

The correction was promoted to TEST as source only. Its manual read-only
`verify` passed. One authorized `apply` created an available change set with
exactly one nonreplacing execution-policy modification; both pending templates
matched the reviewed candidate. The guard then rejected the response because
it required `ChangeSetType`, which AWS omits from `DescribeChangeSet` even
though the request explicitly specified `UPDATE`. The change set was not
executed: the live execution policy remains at its old baseline, the
bootstrap stack is `UPDATE_COMPLETE`, and the runtime stack remains
`ROLLBACK_FAILED`.

The revision guard now accepts an omitted response type only in this workflow,
whose `CreateChangeSet` request is fixed to `UPDATE`; it still rejects an
explicit non-`UPDATE` value and any unexpected resource, property, or
replacement. A regression test reproduces the observed response. No retry,
recovery, or second runtime create has occurred. The existing
dedicated-identity workflow supports initial resource Adds, not this policy
revision; the guarded policy update and separate stack recovery are required
before another runtime create.
