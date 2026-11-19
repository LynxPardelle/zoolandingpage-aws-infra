# Reproducible Node runtime for TEST release review

Date: 2026-11-18 (Central Time)

- Pin both `Deploy Test` jobs to Node.js `22.23.5`. The floating `22` selector resolved to `22.23.4` and `22.23.5` across independent review/execute runners, changing only synthesized CDK telemetry and causing the exact public SSR review digest to reject execution.
- Add a regression requiring the validation and credential-bearing jobs to use that same exact patch. The regression failed against the previous floating selectors before the workflow change.
- Preserve the protected source promotion, immutable artifact, APP selection, native template, review digest, IAM, and execution boundaries. A runtime upgrade requires updating both pins and obtaining a fresh review.
- This source change does not activate a frontend release or alter AWS resources.
- Local verification passed: 527 tests passed, zero failed, and one native scanner test was skipped because `GITLEAKS_BINARY` was unavailable; CDK synthesis and diff checks passed. Protected CI and a fresh TEST review/execute pair remain required before activation.
