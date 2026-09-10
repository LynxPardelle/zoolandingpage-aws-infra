# THN TEST CLI stdin transport

Date: 2026-09-09 (Central Time)

The shared prerequisite/permissions CLI adapter must not ask AWS CLI to reopen
Node's socket-based stdin directly as `/dev/stdin` on Linux. A fixed Bash
process-substitution pipe preserves the private-JSON stdin boundary and replaces
the shell with AWS CLI so the existing timeout still targets the command.
Inherited Bash startup files, functions and tracing are ignored; argument data
is never interpolated into shell source. There is no new IAM permission, role,
workflow approval, artifact input, dependency or AWS resource.

Regression coverage checks argument/privacy boundaries and sanitized failures.
Linux CI additionally executes native AWS CLI skeleton generation with no
credentials or network: the legacy direct descriptor must fail and the new
transport must succeed. This is transport verification, not deployment or
client-readiness evidence.

References: [Node stdio contract](https://nodejs.org/api/child_process.html#optionsstdio)
and [THN prerequisite transport](../docs/thn-test-prerequisites.md).
