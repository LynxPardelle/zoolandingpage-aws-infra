# 2026-09-12 — Exact THN TEST recovery permission revisions

Local implementation only; dates are Central Time. No AWS permission application
or blog activation is claimed by this entry.

- Added independent Config/API one-policy additions with exact object versions,
  stack/function scopes and NoEcho private selectors.
- API recovery requires an absent service-role argument; code updates are
  CloudFormation-mediated. Original role/trust/policies are not replaced.
- Added the isolated immutable revision runner/workflow and matching canonical
  TEST CDK hooks. It does not replay the initial-only supplemental workflow.
- Added scope, synthetic orchestration, transport, masking, drift and preserved
  production/baseline tests; shared test fixtures do not register duplicate tests.
- Fresh reviewed ledgers, immutable source promotion and effective AWS readback
  remain pending. Closure-specific permissions and first API forward release
  remain separate gates.

See [the owning guide](../docs/thn-test-recovery-permissions.md).
