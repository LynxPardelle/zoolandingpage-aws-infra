# Config TEST runtime inspection permission source

Date: 2026-09-12 (Central Time)

- Added an independent `config-runtime` selection to the existing reviewed
  native permission workflow. It grants only `lambda:GetRuntimeManagementConfig`
  to the existing Config TEST deployment role for the exact, independently
  anchored unqualified function.
- Preserved the already-applied recovery policy and all previous roles, trust,
  policies and parameter values. The separate addition uses one required
  NoEcho function-ARN parameter and one inline policy, not a new service.
- Added regression coverage for exact scope, original-policy preservation,
  production no-op, function identity reconciliation and no-write rejection.
- Source preparation does not certify application in AWS or blog activation.
  A fresh reviewed ledger and verify/apply/readback remain required.

See [the permission revision guide](../docs/thn-test-recovery-permissions.md).
