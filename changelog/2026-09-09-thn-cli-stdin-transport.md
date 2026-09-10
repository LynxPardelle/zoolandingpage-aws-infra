# THN TEST CLI stdin transport

Date: 2026-09-09 (Central Time)

The shared prerequisite/permissions CLI adapter must not ask AWS CLI to reopen
Node's socket-based stdin directly as `/dev/stdin` on Linux. Native diagnostics
also confirmed that AWS CLI loads the JSON reference twice: a regular pipe is
exhausted by the second read. The fixed Python launcher uses sealed anonymous
memory descriptors, with no named filesystem input or raw private argv values.
It uses the runner's existing Python 3 in isolated/no-site mode and replaces
itself with AWS CLI so the timeout still targets the command. No package install,
new IAM permission, role, workflow approval, artifact input or AWS resource is
introduced.

GetObject does not accept `--cli-input-json`; its four closed string parameters
now use separate in-memory file references. Its existing exact-byte template
readback and all source/authority/resource guards are preserved.

Regression coverage checks argument/privacy boundaries and sanitized failures.
Linux CI checks repeated exact reads above a pipe buffer, anonymous backing and
write seals, then native AWS CLI empty/nonempty JSON skeleton generation.
GetObject parsing uses a closed loopback endpoint and unsigned synthetic inputs,
with no credentials or connection to AWS. This is transport verification, not
deployment or client-readiness evidence.

References: [Node stdio contract](https://nodejs.org/api/child_process.html#optionsstdio)
and [THN prerequisite transport](../docs/thn-test-prerequisites.md),
[CLI argument loading](https://github.com/aws/aws-cli/blob/v2/awscli/clidriver.py),
[CLI JSON loading](https://github.com/aws/aws-cli/blob/v2/awscli/customizations/cliinput.py),
and [GetObject arguments](https://docs.aws.amazon.com/cli/latest/reference/s3api/get-object.html).
