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

## Exact API physical identity validation

- A live read-only preflight found that two original Lambda physical names do
  not contain their complete CloudFormation logical IDs. The earlier naming
  regex rejected their otherwise verified recovery binding before any mutation.
- Replaced inferred physical naming with independent SHA-256 anchors for each
  of the three observed original identities. Unqualified, same-account/region
  Lambda ARN validation and exact CloudFormation resource reconciliation remain.
- No policy action, resource count, wildcard, trust, workflow, Config validation,
  runtime policy or production hook changes. Only the exact originally observed
  three functions can pass; changing a ledger alone cannot substitute a function.
- Synthetic shortened-name regression failed before the correction. Focused
  tests reject substituted/swapped functions, missing or altered anchors,
  qualifiers, foreign accounts/regions and invalid physical-name lengths.
- Three complete local suite rounds passed all 253 tests each with the pinned
  native scanner enabled and no skips. Read-only candidate validation against AWS passed
  the exact private binding, eight NoEcho parameters, one-policy-only template
  composition, all 29 original owning-stack resources and prior role/trust.
  This local candidate check did not configure secrets or apply IAM changes.
