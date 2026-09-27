---
goal: Deploy the THN Journal articleLocale route fix in AWS TEST with an exact CloudFront Function change set
version: 1.0
date_created: 2026-09-26
status: 'In progress'
tags: [infrastructure, test, thn, cloudfront]
---

# Introduction

![Status: In progress](https://img.shields.io/badge/status-In%20progress-yellow)

The source route fix in `lib/stacks/frontend-stack.js` is tested offline. This plan adds a manual release that proves only the TEST admin viewer-request FunctionCode changed and blocks execution if CloudFormation lists dependent resources.

## 1. Requirements & Constraints

- **REQ-001**: Target only `ZoolandingTest-Zoolandingpage-test-Frontend`, account `765932874577`, `us-east-1`, at a full reviewed `test` source SHA.
- **REQ-002**: Provide manual `query-fence` `review`, `execute`, and `verify`; default to `review` and never execute in `review`.
- **REQ-003**: Candidate and live templates must differ only at `FrontendViewerHostHeaderFunctionThehairnarrativeAdminTestD75B90C2.Properties.FunctionCode`.
- **REQ-004**: The code delta must equal the approved `articleLocale` rule/handler transformation; preserve host, IP, routes, methods, headers, origins and deny behavior.
- **REQ-005**: Detailed and summary change sets must contain one non-replacing FunctionCode Modify on that logical ID and no dependent resource entries.
- **REQ-006**: Postcheck must observe LIVE Function code, association, distribution, DNS, certificate, origin, APP release, and negative route behavior twice.
- **SEC-001**: Use existing TEST OIDC and CloudFormation execution roles; no direct CloudFront mutation or production change.
- **CON-001**: Keep `origin-only`, `static-rotation`, and general frontend release policies unchanged.
- **CON-002**: The source-only `dev` to `test` promotion remains credential-free and cannot deploy this patch.
- **PAT-001**: Reuse immutable CDK assembly identity and AWS read/review patterns from `tools/thn-admin-release.js`, `tools/infra-test-aws.js`, and `tools/review-test-infra-change-set.js` without broadening their existing proof modes.

## 2. Implementation Steps

### Implementation Phase 1

- GOAL-001: Prove exact source and change-set boundaries offline.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | In `test/thn-admin-query-fence-patch.test.js`, add failing tests for `verifyExactQueryFenceDiff(desired, live)` that accept only the four Journal page flags and `queryAllowed` transformation, then reject changed distribution, methods, route inventory, host check, IP check, static assets or headers. | | |
| TASK-002 | In the same file, add failing tests for `reviewQueryFenceChangeSet(detailed, summary, context)` that accept one FunctionCode Modify with `Replacement: False` and reject dynamic distribution, DNS, SSM, certificate, pagination, replacement, duplicates and inconsistent summaries. | | |
| TASK-003 | Implement pure proof functions in `tools/thn-admin-query-fence-patch.js`; keep existing `tools/thn-admin-release.js` and general reviewer behavior unchanged except a read-only helper reuse if tests require it. | | |

### Implementation Phase 2

- GOAL-002: Provide an independently gated manual TEST release.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-004 | Add failing tests for SHA, artifact, CDK assembly, TEST account/stack/role, live Original and Processed template, Function ETag/code, distribution association, APP release, certificate, DNS, origin, and complete inventory preflight. | | |
| TASK-005 | Implement `review` and `execute` in `tools/thn-admin-query-fence-patch.js`: verify the immutable assembly, prepare an UPDATE change set with current parameters and execution role, read both descriptions and candidate templates, run strict proof, remove unexecuted review change sets, and repeat all checks before execution. | | |
| TASK-006 | Add a dedicated `.github/workflows/deploy-thn-admin-query-fence-test.yml` with `review|execute|verify`, full `test` source SHA input, credential-free validation and artifact transport, then TEST OIDC deployment. Add workflow contract tests to `test/thn-admin-query-fence-patch.test.js` and verify `.github/workflows/deploy-test.yml` remains source-only for THN promotion. | | |

### Implementation Phase 3

- GOAL-003: Verify the live result and complete the TEST acceptance path.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-007 | Add failing postcheck tests for two stable LIVE Function/code/association/inventory reads and valid/invalid HTTP probes. Implement bounded propagation retries and read-only `verify` in `tools/thn-admin-query-fence-patch.js`. | | |
| TASK-008 | Run `npm test -- --test-reporter=dot`, CDK synth of `ZoolandingTest/Zoolandingpage-test-Frontend`, and exact template-delta checks; document dispatch and fail-closed policy in `docs/thn-admin-test-release.md`. | | |
| TASK-009 | Open a draft PR to `dev`, inspect CI/diff, merge after review, promote the exact `dev` tree to `test` without AWS, run `query-fence=review`, inspect the real change set, and execute only if it contains the one allowed FunctionCode effect. | | |
| TASK-010 | Run `verify`, then load a QA editor direct link using `lang=es&articleLocale=en` and confirm unsupported query/route probes still deny. Record TEST-only evidence before article cover and publish/withdraw acceptance. | | |

## 3. Alternatives

- **ALT-001**: General `Deploy Test`; rejected because its change-set boundary permits wider frontend changes.
- **ALT-002**: Direct CloudFront Function API; rejected because it bypasses CloudFormation ownership.

## 4. Dependencies

- **DEP-001**: Approved `docs/superpowers/specs/2026-09-26-thn-admin-test-query-fence-patch-design.md`.
- **DEP-002**: Existing TEST OIDC role, CloudFormation execution role, protected frontend stack, admin distribution and selected APP release.
- **DEP-003**: Tested source change in `lib/stacks/frontend-stack.js` and `test/frontend.test.js`.

## 5. Files

- **FILE-001**: `tools/thn-admin-query-fence-patch.js` — exact proof, release and postcheck logic.
- **FILE-002**: `.github/workflows/deploy-thn-admin-query-fence-test.yml` — manual TEST operation.
- **FILE-003**: `test/thn-admin-query-fence-patch.test.js` — proof, change-set and workflow tests.
- **FILE-004**: `docs/thn-admin-test-release.md` — operator instructions.

## 6. Testing

- **TEST-001**: Observe focused tests fail because the proof/release module does not exist, then pass after implementation.
- **TEST-002**: Full `npm test` and CDK synth pass; generated FunctionCode matches only the approved transformation.
- **TEST-003**: THN `dev` to `test` promotion validates without AWS and dedicated manual `review` does not execute.
- **TEST-004**: Actual change set lists exactly one allowed FunctionCode effect before `execute`; any dynamic dependent entry blocks release.
- **TEST-005**: LIVE Function and distribution observations are stable; QA direct editor route works, invalid query and unsupported route probes deny.

## 7. Risks & Assumptions

- **RISK-001**: CloudFormation can list derived distribution, SSM or DNS entries even when the template delta is FunctionCode only. The operation must stop and surface the exact entries for separate review.
- **RISK-002**: CloudFront propagation can delay route probes; bounded retries end in a reported verification failure without widening scope.
- **ASSUMPTION-001**: The current admin viewer-request association and APP release remain healthy at dispatch time; preflight checks this rather than assuming it.

## 8. Related Specifications / Further Reading

- `docs/superpowers/specs/2026-09-26-thn-admin-test-query-fence-patch-design.md`
- `docs/thn-admin-test-release.md`
- `tools/thn-admin-release.js`
