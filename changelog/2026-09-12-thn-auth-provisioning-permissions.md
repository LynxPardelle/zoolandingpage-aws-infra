# Closed Auth TEST provisioning permission correction

Date: 2026-09-12, Central Time.

- Added the independent `auth-provision` selection to the existing one-policy
  native revision workflow, with an Auth-only private binding and sealed module.
- Bootstrap declares only the supplementary policy, never the pre-existing
  manually created Auth deployment role. Original roles, trust, policies and
  other targets keep their existing behavior and baseline hashes.
- Scope is the reviewed dedicated Auth TEST pool, three functions/execution
  roles, five table configurations and four retained log groups. Writes require
  CloudFormation mediation; the one new exact-role PassRole is Lambda-only.
- Tests reject foreign bindings, stale source, role adoption, active or ambiguous
  lifecycle flags, transport substitution and inline-policy overflow.
- Live preflight identified an untouched legacy Auth template without the new
  flags. A follow-up verifies that exact original template contains neither THN
  resources nor flag definitions before accepting absent flags for the first
  provisioning. No permission document or other target changes.

This is source preparation, not a deployment or customer-activation receipt.
Use the [owning permission runbook](../docs/thn-test-recovery-permissions.md#closed-auth-test-provisioning-correction)
for the immutable verify/apply sequence and live acceptance gates.
