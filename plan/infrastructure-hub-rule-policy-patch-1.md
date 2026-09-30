---
goal: Apply two production Hub EventBridge policy documents through a retained CloudFormation review
version: 1
date_created: 2026-09-29
last_updated: 2026-09-29
owner: THN production release
status: 'In progress'
tags: [infrastructure, iam, production]
---

# Introduction

![Status: In progress](https://img.shields.io/badge/status-In%20progress-yellow)

Implement the approved [design](../docs/superpowers/specs/2026-09-29-thn-production-hub-rule-policy-patch-design.md) in the existing protected identities release. The incident is Content Hub run `36632270213`; no AWS write is part of the implementation or local validation phases.

## 1. Requirements & Constraints

- **REQ-001**: The candidate differs from the live Original template only in `Properties.PolicyDocument` of `HubCfnNativePolicy2` and `HubCfnNativePolicy3`.
- **REQ-002**: The change set contains exactly two static direct `Modify` entries without replacement.
- **REQ-003**: Review, execute and cleanup bind the source SHA, purpose, live baseline, immutable package, inventory and digest.
- **REQ-004**: Review and execute check live managed-policy identities, attachments, versions and the exact relevant IAM permissions.
- **REQ-005**: Execute verifies templates, physical IDs, policy documents, role identities and three EventBridge rule permissions after CloudFormation completes.
- **SEC-001**: Existing `bootstrap` and `trust-patch` behavior remains unchanged; Hub state, orphan cleanup and article publication are excluded.
- **CON-001**: Do not dispatch GitHub Actions until local suite, workflow lint and read-only AWS comparison pass.
- **CON-002**: Do not execute the retained change set without separate approval of its exact review inventory and digest.

## 2. Implementation Steps

### Implementation Phase 1

- GOAL-001: Specify fail-closed behavior with tests before release code.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Add `test/thn-production-identities-hub-rule-patch.test.js` for candidate composition, exact policy deltas, baseline and policy-version failures, two-entry native inventory, stale review, and postcheck drift. Run the focused test and confirm failure due to missing scope. | ✅ | 2026-09-29 |
| TASK-002 | Add workflow source checks to the same test for `identity_scope=hub-rule-policy-patch`, distinct retained purpose and focused test invocation. Confirm the new test fails before editing the workflow. | ✅ | 2026-09-29 |

### Implementation Phase 2

- GOAL-002: Implement the policy patch within the existing retained review protocol.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-003 | Add `composeHubRulePolicyPatch`, baseline/permission checks, `reviewHubRulePolicyInventory`, and postverification to `tools/thn-production-identities.js`; reuse `sourcePackageHash`, sealed objects and retained digest. | ✅ | 2026-09-29 |
| TASK-004 | Add the new choice, purpose mapping and test invocation to `.github/workflows/thn-production-identities.yml`; retain exact MAIN checks and production environment. | ✅ | 2026-09-29 |
| TASK-005 | Run focused tests, full `npm test`, manifest validation, `actionlint`, `git diff --check`, and a read-only AWS CLI comparison of stack, two policy versions/attachments, execution role permissions and three rule ARNs. Fix failures before any remote write. | ✅ | 2026-09-29 |

### Implementation Phase 3

- GOAL-003: Integrate code and stage one retained production review.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-006 | Inspect the exact local diff, commit the approved files on the current branch, prepare a PR preview and follow repository PR/merge approvals; do not include ignored diagnostic files. | | |
| TASK-007 | Promote the validated infra commit to TEST and MAIN with exact selectors and confirm AWS jobs are skipped. | | |
| TASK-008 | Dispatch one `identity_scope=hub-rule-policy-patch`, `execution=review` run, verify exactly two allowed change-set entries, and present its digest for separate execute approval. | | |

## 3. Alternatives

- **ALT-001**: Direct IAM policy-version editing creates CloudFormation drift and loses the reviewed change set.
- **ALT-002**: Broadening `bootstrap` to change existing resources weakens the normal identities release guard.

## 4. Dependencies

- **DEP-001**: Healthy identities stack in account `765932874577`, `us-east-1`; preserve its observed termination-protection setting without changing it.
- **DEP-002**: Authenticated read-only AWS CLI for the live preflight.
- **DEP-003**: Existing protected MAIN workflow and exact promotion selectors.

## 5. Files

- **FILE-001**: `tools/thn-production-identities.js` implements the narrow scope.
- **FILE-002**: `.github/workflows/thn-production-identities.yml` exposes and validates the scope.
- **FILE-003**: `test/thn-production-identities-hub-rule-patch.test.js` verifies candidate, inventory and operation failures.
- **FILE-004**: `tools/production/thn-deployment-identities.json` already contains the three corrected rule ARN patterns.
- **FILE-005**: `changelog/2026-09-29-production-hub-rule-prefix.md` records the incident correction.

## 6. Testing

- **TEST-001**: Focused node tests fail before implementation and pass after it.
- **TEST-002**: Full infrastructure `npm test`, manifest validation, `actionlint` and `git diff --check` pass.
- **TEST-003**: Read-only AWS comparison proves the candidate differs only in the two managed policy documents and effective permissions are sufficient for the exact patch.
- **TEST-004**: Retained review reports two `Modify` entries with `Replacement=False`; execution is a separate approval gate.

## 7. Risks & Assumptions

- **RISK-001**: CloudFormation can classify an unexpected dependency or replacement; the inventory guard aborts the review.
- **RISK-002**: IAM policy versions or attachments may drift before execution; the repeated baseline check aborts.
- **ASSUMPTION-001**: The live identity stack Original and Processed templates agree, as observed in the preceding read-only investigation.
- **ASSUMPTION-002**: The four orphan Hub resources remain outside this operation and require separate assessment.

## 8. Related Specifications / Further Reading

- [Approved design](../docs/superpowers/specs/2026-09-29-thn-production-hub-rule-policy-patch-design.md)
- [Content Hub failed execution](https://github.com/LynxPardelle/zoolanding-content-hub/actions/runs/36632270213)
