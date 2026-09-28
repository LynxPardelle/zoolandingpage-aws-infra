# THN TEST deletion protection

Date: 2026-09-07 (Central Time)

`tools/thn_test_stack_protection.py` audits the three existing Auth Admin, Content Hub and API Proxy TEST stacks. The default invocation is read-only. An explicit `--apply` enables CloudFormation termination protection after account, region and stability checks, then verifies the result. The allowlist is code-owned; there is no production, disable, template update or stack creation option. If a later operation fails, already-enabled protection is retained.

The approved AWS account is anchored by a SHA-256 digest; account identifiers and credential values are not emitted. Use an existing authorized AWS CLI session; never add long-lived keys to GitHub. Run `python -m unittest discover -s test -p test_thn_test_stack_protection.py` for six tests with no AWS access.

This protects against stack deletion, not template updates that remove individual resources. Keep retained state, change-set review and rollback controls. Image Upload is intentionally excluded because its TEST stack does not yet exist. These settings do not provision THN v2 state or activate any routes.

