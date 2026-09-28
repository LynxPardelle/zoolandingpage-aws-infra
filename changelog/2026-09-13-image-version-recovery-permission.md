# Image version-discovery permission revision

2026-09-13, Central Time. Source implementation, not evidence of deployment.

- Add only `lambda:ListVersionsByFunction` for the private TEST Image function
  to its existing CloudFormation executor supplement.
- Extend the independent revision workflow with an exact one-policy MODIFY,
  retaining old roles/trust/policies, parameters and resource identities.
- Require the closed protected partial Image stack and immutable source binding;
  reject changed, wider, missing or already revised policy baselines.
- Cover synthesis isolation and revision orchestration with regression tests.
  No production or other draft runtime changes are included.

See [the owning revision guide](../docs/thn-test-recovery-permissions.md#image-version-discovery-revision).
