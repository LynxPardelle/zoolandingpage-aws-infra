# THN Auth origin authorizer IAM repair

Date: 2026-09-19 (Central Time)

The TEST Auth enable attempt failed when CloudFormation tried to update the
fixed-name origin authorizer. Its name is outside the deploy role's standard
Lambda prefix. A read-only IAM simulation identified four missing lifecycle
actions on that exact Lambda ARN. The already-provisioned role, log group and
alarm scopes were checked separately; Content Hub's EventBridge name correction
remains present in live IAM.

This source change adds only those four authorizer actions to the existing
`ThnTestAuthEnableV1` managed policy, and permits its exact one-time IaC Modify
while the Auth service stack is protected, provisioned, disabled and in
`UPDATE_ROLLBACK_FAILED`. It does not recover the stack, deploy the policy or
activate the blog by itself. Those operations require the independent reviewed
ledger, verify/execute workflow and subsequent Auth stack recovery.
