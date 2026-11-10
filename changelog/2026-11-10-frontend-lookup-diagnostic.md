# Stable frontend lookup diagnostics

- A read-only comparison confirmed that consecutive CDK lookup requests differed only at `Environment.Error.Message`: the denied KMS diagnostic embeds a request identifier.
- Omit only that diagnostic text when variables are hidden with the exact `AccessDeniedException` code. Preserve the error code, function revision, live code digest and every other configuration field.
- Native template release binding, immutable ZIP recovery verification and retained review drift checks remain required. No IAM permissions change.
