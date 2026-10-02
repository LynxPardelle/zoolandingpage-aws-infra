---
goal: Add exact read permissions required before the THN production owner operator review
version: 1.0
date_created: 2026-10-01
last_updated: 2026-10-01
owner: THN production release
status: 'In progress'
tags: [infrastructure, iam, production]
---

# Introduction

![Status: In progress](https://img.shields.io/badge/status-In%20progress-yellow)

Implement the IAM prerequisite in `docs/superpowers/specs/2026-10-01-thn-production-owner-parameter-review-design.md` in the Auth repository. This plan affects only the production deployment-identities release. The subsequent Auth owner release has its own plan and approval gates.

## 1. Requirements & Constraints

- **REQ-001**: Add only the reviewed read actions to `AuthGithubReleasePolicy` for exact production resources. No data mutation or Lambda invoke action is allowed.
- **REQ-002**: A new `auth-owner-read-patch` scope may change only the `PolicyDocument` of `AuthGithubReleasePolicy`; its change set must contain one `Modify` without replacement and no other resource.
- **REQ-003**: Both preflight and postcheck must simulate every exact action/resource pair; the review must fail before a write if any decision is not `allowed` after the candidate policy is applied to the simulator.
- **REQ-004**: Preserve the identity of all existing resources and all unrelated role policies and trust documents.
- **CON-001**: Never dispatch an AWS workflow before all local tests, `actionlint`, a replay to the pre-write barrier, and fresh AWS CLI baseline checks pass.
- **CON-002**: Promote source by `dev → test → main` with exact selectors; keep automatic AWS jobs omitted. Review and execute each need separate user authorization.
- **SEC-001**: Do not widen resources to `*` if an action rejects the exact ARN. Diagnose before continuing.

## 2. Implementation Steps

### Implementation Phase 1

- GOAL-001: Define a candidate and native inventory that cannot include unrelated policy changes.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Add tests in `test/thn-production-identities-auth-owner-read.test.js` for exact candidate policy, unchanged unrelated resources, wrong baseline hash, extra action, unexpected change, and replacement. Run them red. | | |
| TASK-002 | Update `tools/production/thn-deployment-identities.json` and `tools/thn-production-identities.js` with a dedicated candidate composer and one-resource inventory validator. | | |
| TASK-003 | Make `captureExternalRoles` in `tools/thn-production-identities.js` compare stack-owned inline policies to the deployed Original template, so a policy transition does not falsely count the previous owned version as an external policy. Test both before and after states. | | |

### Implementation Phase 2

- GOAL-002: Wire a retained IAM review with exact authorization checks.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-004 | Add exact `auth-owner-read-patch` operation allowlists in `tools/thn-production-identities.js`, `tools/thn-production-certificate-release.js`, and `.github/workflows/thn-production-identities.yml`; add the new test to workflow validation. | | |
| TASK-005 | Add preflight for `AWS::IAM::Policy` handler actions, exact role ARN, and current policy size; assert policy simulator decisions on the candidate via `SimulateCustomPolicy` before upload. | | |
| TASK-006 | Extend retained review/execute to seal source, baseline, template, inventory and IAM proof; after execute verify policy hash, unchanged identities, and exact new effective permissions. | | |

### Implementation Phase 3

- GOAL-003: Validate before any GitHub Action.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-007 | Run focused and complete local Node tests, `actionlint`, manifest validation, and `git diff --check`. | | |
| TASK-008 | Refresh production stack, IAM role, policy, effective simulations and CloudFormation provider schema using AWS CLI; replay captured responses to the first write barrier. | | |
| TASK-009 | Prepare the reviewed diff and PR. Obtain the repository approvals before push, merge, promotion, AWS review, and digest execution. | | |

## 3. Alternatives

- **ALT-001**: Add broad `Resource: "*"` grants to the Auth role. Rejected because the read actions support exact resource ARNs.
- **ALT-002**: Launch the Auth owner review with the current role. Rejected because current IAM simulation predicts `implicitDeny` before its change set.

## 4. Dependencies

- **DEP-001**: Auth design `docs/superpowers/specs/2026-10-01-thn-production-owner-parameter-review-design.md` at local commit `d9e6e78` in the Auth worktree.
- **DEP-002**: Production deployment-identities stack and its current Original template, exact `AuthGithubReleasePolicy`, IAM role, and provider schema.
- **DEP-003**: Existing retained review contract in `tools/thn-production-retained-review.js`.

## 5. Files

- **FILE-001**: `tools/production/thn-deployment-identities.json` — exact candidate IAM policy.
- **FILE-002**: `tools/thn-production-identities.js` — composer, preflight, review, execute, postcheck.
- **FILE-003**: `tools/thn-production-certificate-release.js` — exact IAM simulator operation allowlist.
- **FILE-004**: `.github/workflows/thn-production-identities.yml` — manual scope and offline tests.
- **FILE-005**: `test/thn-production-identities-auth-owner-read.test.js` — candidate and integration tests.

## 6. Testing

- **TEST-001**: Candidate changes only the exact policy document and no statement is widened or removed.
- **TEST-002**: Native inventory rejects additions, removals, replacement, and extra property changes.
- **TEST-003**: Preflight rejects a denied IAM simulation before any S3 or CloudFormation write.
- **TEST-004**: Postcheck requires every exact permission to be allowed and all prior identities unchanged.
- **TEST-005**: Local replay reaches the write barrier with fresh AWS captures before the first GitHub Action.

## 7. Risks & Assumptions

- **RISK-001**: AWS may report a different `PolicyDocument` change detail; the guard must stop and diagnose it, not widen the inventory.
- **RISK-002**: IAM propagation after execution may be delayed; postcheck should poll only bounded reads and fail with evidence if decisions remain denied.
- **ASSUMPTION-001**: The production IAM policy document remains under the 10,240-byte inline-policy limit.

## 8. Related Specifications / Further Reading

- `docs/superpowers/specs/2026-10-01-thn-production-owner-parameter-review-design.md` in `zoolanding-auth-admin-thn-guard-integration`.
- https://docs.aws.amazon.com/service-authorization/latest/reference/list_iam.html
- https://docs.aws.amazon.com/service-authorization/latest/reference/list_awscloudformation.html
