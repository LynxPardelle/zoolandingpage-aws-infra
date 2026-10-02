---
goal: Restore the private THN production API after a denied API Gateway tag operation
version: 1.0
date_created: 2026-10-02
last_updated: 2026-10-02
owner: THN production release
status: 'In progress'
tags: [infrastructure, bug, production]
---

# Introduction

![Status: In progress](https://img.shields.io/badge/status-In%20progress-yellow)

Implement the approved [API tag permission recovery design](../docs/superpowers/specs/2026-10-02-thn-production-api-tag-permission-recovery-design.md). The failed API execute run is `37049791094`; its CloudFormation stack is `ROLLBACK_COMPLETE` and protected. No AWS write occurs during local implementation.

## 1. Requirements & Constraints

- **REQ-001**: Allow the production CloudFormation execution role to tag only REST APIs and their stages in `us-east-1` via the encoded `/tags/.../restapis/*` path.
- **REQ-002**: API release review must reject a permission plan that omits that exact action/resource pair before S3 or CloudFormation writes.
- **REQ-003**: Review, execute, and recovery each require separate approvals and exact live-state checks.
- **SEC-001**: Do not widen the GitHub role, grant `apigateway:*`, or expose application data.
- **CON-001**: The old API review and digest are consumed; use a new review after cleanup.
- **CON-002**: The retained log group may be deleted only after checking zero bytes, zero streams, and exact stack ownership.

## 2. Implementation Steps

### Implementation Phase 1

- GOAL-001: Add an exact protected infrastructure policy patch.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | In `tools/production/thn-deployment-identities.json`, append one region-scoped statement to `ApiCfnNativePolicy0.PolicyDocument` with `apigateway:GET`, `PUT`, `DELETE` on `arn:aws:apigateway:us-east-1::/tags/arn%3Aaws%3Aapigateway%3Aus-east-1%3A%3A%2Frestapis%2F*`. | | |
| TASK-002 | In `tools/thn-production-identities.js`, add a one-purpose scope that verifies the live old policy and changes only `ApiCfnNativePolicy0.PolicyDocument`; seal one no-replacement `Modify`, prove the candidate through IAM simulation, and verify the live role after execution. | | |
| TASK-003 | Register that scope in `.github/workflows/thn-production-identities.yml`; add focused tests in `test/` for denial, scope, inventory, and postcheck. | | |

### Implementation Phase 2

- GOAL-002: Close the API preflight gap.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-004 | In API Proxy `tools/run_thn_production_release.py`, require the exact tag-path permission request for an Add of `AWS::ApiGateway::RestApi` or `Stage` when the live provider schema is tag-on-create; retain the existing action projection. | | |
| TASK-005 | In API Proxy `tests/`, first reproduce acceptance of the old 136-pair plan, then assert that the patched guard stops that plan and accepts the exact separate `GET`/`PUT`/`DELETE` tag request. | | |
| TASK-006 | Prepare the API production permission plan with the separate tag-path request and new MAIN `sourceSha`; leave parameters and other secrets untouched. | | |

### Implementation Phase 3

- GOAL-003: Verify before GitHub Actions and recover with separate approvals.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-007 | Run focused and full local tests, workflow syntax validation, live IAM simulation for concrete encoded API and stage tag ARNs, policy-size checks, all nine provider handler permission checks, and exact stack/log inventory. | | |
| TASK-008 | Promote code through `dev → test → main` with required PR checks and source selectors while confirming automatic AWS jobs are skipped. | | |
| TASK-009 | After separate approval, review and apply only the one-resource IAM patch; verify the effective execution-role policy and unchanged identity stack. | | |
| TASK-010 | After separate approval and fresh empty-resource checks, remove only the failed `ROLLBACK_COMPLETE` API stack and its empty retained log group. | | |
| TASK-011 | After separate approvals, review and apply the new nine-resource API change set; verify its private route without creating users or publishing articles. | | |

## 3. Alternatives

- **ALT-001**: Remove template tags. CloudFormation still propagates stack tags, so the API Gateway tag operation remains necessary.
- **ALT-002**: Grant `apigateway:*` on all resources. This exceeds the reviewed deployment scope.

## 4. Dependencies

- **DEP-001**: Exact AWS account `765932874577`, region `us-east-1`, and active read-only CLI session for preflight.
- **DEP-002**: The approved specification and separate user approvals for AWS review, IAM execute, cleanup, API review, and API execute.

## 5. Files

- **FILE-001**: `tools/production/thn-deployment-identities.json` in infrastructure.
- **FILE-002**: `tools/thn-production-identities.js` and `.github/workflows/thn-production-identities.yml` in infrastructure.
- **FILE-003**: `tools/run_thn_production_release.py` in API Proxy.
- **FILE-004**: Focused infrastructure and API Proxy tests and dated changelogs.

## 6. Testing

- **TEST-001**: A simulated tag request on the exact encoded REST API ARN is allowed only by the proposed candidate policy, while the live policy remains denied before patch.
- **TEST-002**: The protected infrastructure review rejects all inventories except one `Modify` of `ApiCfnNativePolicy0.PolicyDocument` without replacement.
- **TEST-003**: The API guard rejects an old 136-pair permission plan and accepts the new exact tag-path request.
- **TEST-004**: Full repository suites and workflow validation pass locally before the first push.

## 7. Risks & Assumptions

- **RISK-001**: An unobserved AWS operation may still differ from provider schema; any unexpected change or denial stops release rather than triggering a blind retry.
- **RISK-002**: `ROLLBACK_COMPLETE` and the retained log group block reuse of the old review; cleanup is destructive and requires exact rechecks and approval.
- **ASSUMPTION-001**: CloudFormation's encoded REST API tag path remains as reported by its event and documented API Gateway tag endpoint.

## 8. Related Specifications / Further Reading

- [Approved design](../docs/superpowers/specs/2026-10-02-thn-production-api-tag-permission-recovery-design.md)
- [AWS API Gateway tag IAM reference](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-tagging-iam-policy.html)
- [AWS API Gateway stage tag path](https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-tags.html)
