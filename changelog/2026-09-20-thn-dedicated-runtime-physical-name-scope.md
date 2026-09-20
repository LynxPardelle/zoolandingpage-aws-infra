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
local Node test suite passed (314 passed, 1 skipped). A read-only IAM policy
simulation allowed `CreateRole`, `DeleteRolePolicy`, and `TagRole` on the
observed role ARN.

This is source-only preparation. No corrected IAM policy has been published or
applied, and no recovery or second runtime create has been attempted. The
existing dedicated-identity workflow supports initial resource Adds; a
separately reviewed policy revision and stack recovery are required before a
new runtime create.
