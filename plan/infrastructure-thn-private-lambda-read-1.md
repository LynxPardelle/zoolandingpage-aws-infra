---
goal: Restore the guarded THN private admin TEST release preflight without changing the CDK lookup role
version: 1.0
date_created: 2026-09-27
last_updated: 2026-09-27
owner: THN infrastructure
status: 'In progress'
tags: [infrastructure, bug, test]
---

# Introduction

![Status: In progress](https://img.shields.io/badge/status-In%20progress-yellow)

Make the manual THN Admin TEST Private Release Rotation read the one private SSR Lambda configuration through its existing GitHub OIDC session. Keep every other live read and all mutations behind the existing CDK role guards.

## 1. Requirements & Constraints

- **REQ-001**: Compare live Lambda environment variables with the active CloudFormation Original template before review and after execution.
- **REQ-002**: Read only `zoolandingpage-test-frontend-thn-admin-ssr` through the OIDC role `zoolandingpage-infra-test-github-oidc-deploy` in account `765932874577`, region `us-east-1`.
- **SEC-001**: Keep the CDK lookup role's `DontReadSecrets` KMS deny intact. The OIDC inline policy allows only `lambda:GetFunctionConfiguration` for the exact Lambda ARN.
- **SEC-002**: Fail closed on wrong caller, malformed AWS response, `Environment.Error`, absent variables, or environment mismatch; emit no variable values or AWS error messages.
- **CON-001**: Do not alter the release candidate, change-set allowlist, frontend stack, QA articles, or general TEST deployment.
- **CON-002**: Apply IAM permission only after checking that the intended inline policy name is absent and its exact JSON has been reviewed.

## 2. Implementation Steps

### Implementation Phase 1

- GOAL-001: Add a narrow, testable OIDC Lambda read path.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Add failing tests in `test/test-infra-aws.test.js` for exact OIDC caller, exact Lambda command, `Environment.Error`, absent variables, and no sensitive output. | Yes | 2026-09-27 |
| TASK-002 | Implement the guarded direct read in `tools/infra-test-aws.js` and call it from `tools/thn-admin-private-release-rotation.js`; keep `createRoleClient(..., "lookup")` for all other reads. | Yes | 2026-09-27 |
| TASK-003 | Add the exact one-statement IAM policy JSON and guarded installation/verification instructions to `docs/thn-admin-test-release.md`. | Yes | 2026-09-27 |

### Implementation Phase 2

- GOAL-002: Validate and promote code without deploying AWS.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-004 | Run the focused rotation tests, full infrastructure test suite, and credential-free TEST validation. | In progress | 2026-09-27 |
| TASK-005 | Review the diff, commit, open a draft PR into `dev`, and promote the approved code-only diff into `test` after CI. | | |

### Implementation Phase 3

- GOAL-003: Verify the bounded AWS permission and complete the private release through separate gates.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-006 | Re-read IAM role trust and inline policies, apply only `ThnAdminPrivateReleaseLambdaRead`, and verify the OIDC role's exact Lambda read permission. | | |
| TASK-007 | Dispatch `execution=review` with the pinned APP artifact and current TEST SHA; inspect the complete change-set inventory and confirm cleanup without execution. | | |
| TASK-008 | Dispatch `execution=execute` only with an approved review digest; verify stack postconditions and QA immediate image preview in TEST. | | |

## 3. Alternatives

- **ALT-001**: Remove the bootstrap lookup role's KMS deny; rejected because it affects unrelated reads.
- **ALT-002**: Skip environment comparison; rejected because it weakens Lambda drift detection.
- **ALT-003**: Create another IAM role; rejected because it adds a trust path for one read.

## 4. Dependencies

- **DEP-001**: Approved design in `docs/superpowers/specs/2026-09-27-thn-private-lambda-read-gate-design.md`.
- **DEP-002**: Existing TEST OIDC role, protected `test` branch, and immutable APP artifact `10939780047`.

## 5. Files

- **FILE-001**: `tools/infra-test-aws.js` and `tools/thn-admin-private-release-rotation.js` — scoped Lambda read and validation.
- **FILE-002**: `test/test-infra-aws.test.js` — exact allow and deny tests.
- **FILE-003**: `tools/thn-admin-private-lambda-read-policy.json` and `docs/thn-admin-test-release.md` — IAM policy and rollback instructions.

## 6. Testing

- **TEST-001**: A valid OIDC session returns environment variables; a CDK lookup role or different function is rejected.
- **TEST-002**: KMS `Environment.Error` and missing variables fail before any change set.
- **TEST-003**: Full infrastructure suite and TEST validation pass without AWS deployment.
- **TEST-004**: Review mode creates, inspects, and deletes only an unexecuted change set; execute mode requires a matching approved digest.

## 7. Risks & Assumptions

- **RISK-001**: The AWS managed `aws/lambda` key may still hide variables from the OIDC role. Stop and revise the design if the real read fails.
- **RISK-002**: A new IAM inline policy expands read access to the named Lambda's configuration. Check the exact role, policy name, and resource before applying it.
- **ASSUMPTION-001**: The TEST OIDC role trust remains bound to `repo:LynxPardelle/zoolandingpage-aws-infra:environment:test`.

## 8. Related Specifications / Further Reading

- `docs/superpowers/specs/2026-09-27-thn-private-lambda-read-gate-design.md`
- `docs/superpowers/specs/2026-09-27-thn-admin-test-private-release-rotation-design.md`
- [AWS Lambda environment-variable encryption](https://docs.aws.amazon.com/lambda/latest/dg/configuration-envvars-encryption.html)
