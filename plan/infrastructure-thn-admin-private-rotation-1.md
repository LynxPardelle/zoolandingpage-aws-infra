---
goal: Activate an immutable THN private admin release in AWS TEST through an isolated reviewed change set
version: 1.0
date_created: 2026-09-27
last_updated: 2026-09-27
owner: THN infrastructure
status: 'In progress'
tags: [infrastructure, test, release, thn]
---

# Introduction

![Status: In progress](https://img.shields.io/badge/status-In%20progress-yellow)

Implement the approved [THN private admin TEST release design](../docs/superpowers/specs/2026-09-27-thn-admin-test-private-release-rotation-design.md) without activating the published frontend artifact until a live review proves its exact CloudFormation inventory.

## 1. Requirements & Constraints

- **REQ-001**: Accept only a complete, immutable THN admin-enabled APP artifact selected by exact release ID, source SHA, run ID/attempt, delivery digest, admin manifest digest, and artifact ID.
- **REQ-002**: Preserve the deployed query-fence behavior while changing only the private SSR Lambda code/release ID, admin static viewer rules, and admin distribution static origin/behaviors.
- **REQ-003**: Provide manual `review`, `execute`, and `verify` modes on the protected infrastructure `test` branch; default to `review`.
- **SEC-001**: Use the existing TEST OIDC and CloudFormation execution roles, exact account `765932874577`, region `us-east-1`, Frontend stack, and admin host.
- **SEC-002**: Abort on unexpected resources, replacement, route widening, stale state, artifact mismatch, or changed source/selection; never print secrets or raw variable values.
- **CON-001**: A review must not execute a change set; execution needs a newly prepared and reviewed change set and separate release approval.
- **CON-002**: Public frontend, DNS, certificate, other hosts, content services, and QA article publication must remain unchanged.
- **PAT-001**: Reuse artifact transport and role validation patterns from `.github/workflows/deploy-thn-admin-query-fence-test.yml` and `tools/thn-admin-query-fence-patch.js`.

## 2. Implementation Steps

### Implementation Phase 1

- GOAL-001: Prove exact candidate and APP release selection offline.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Add `tools/thn-admin-private-release-rotation.js` helpers to load canonical selection, bind the APP artifact coordinates, and reject altered or incomplete bytes using `tools/thn-admin-release.js`. | Yes | 2026-09-27 |
| TASK-002 | Add a pure projection function that restores only the live historical query handler and four Journal flags in the synthesized viewer Function; reject any other nonstatic rule or handler difference. | Yes | 2026-09-27 |
| TASK-003 | Add a pure full-template proof that normalizes only private SSR Lambda `Code` and `ZLP_RELEASE_ID`, admin viewer static rule inventory, and admin distribution static behaviors/origin path before requiring exact equality with the live Original template. | Yes | 2026-09-27 |
| TASK-004 | Add negative and positive offline tests in `test/thn-admin-private-release-rotation.test.js` for TASK-001 through TASK-003, including an unrelated-resource change and a pending query-fence change. | Yes | 2026-09-27 |

### Implementation Phase 2

- GOAL-002: Review the complete CloudFormation change set without execution.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-005 | Add a pure reviewer for detailed and summary change sets: exact private SSR Lambda, viewer Function, distribution, and narrowly proven admin SSM/alias dependencies; reject missing, duplicate, paginated, replacing, or unexplained conditional entries. | Yes | 2026-09-27 |
| TASK-006 | Add live read-only preflight for stack/template/resource identity, published APP S3 objects and completion marker, CloudFront, Lambda, DNS, certificate, and current public release using existing role-client helpers. | Yes | 2026-09-27 |
| TASK-007 | Implement `review` to create and describe an exact change set, emit only sanitized inventory/digests, and delete the unexecuted change set; add tests proving no execute call. | Yes | 2026-09-27 |

### Implementation Phase 3

- GOAL-003: Add guarded execution and read-only verification.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-008 | Implement `execute` with fresh preflight, candidate and change-set re-review, source/selection drift checks, CloudFormation execution and wait, and two postchecks; abort on any changed evidence. | Yes | 2026-09-27 |
| TASK-009 | Implement `verify` as read-only comparison of active Lambda, viewer Function, distribution, DNS/certificate, public release, and selected S3 artifact; add postcheck and race tests. | Yes | 2026-09-27 |
| TASK-010 | Add `.github/workflows/deploy-thn-admin-private-release-test.yml` with exact protected SHA input, default review mode, credential-free validation, sealed artifact transport, existing OIDC role, and separate execution gate. | Yes | 2026-09-27 |

### Implementation Phase 4

- GOAL-004: Validate and release code before any AWS execution.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-011 | Update `docs/thn-admin-test-release.md` and `changelog/` with the manual rotation contract, review/execute separation, rollback, and known query-fence preservation. | Yes | 2026-09-27 |
| TASK-012 | Run focused tests, `npm test`, and TEST synthesis; repeat source/diff/safety audits three times and resolve findings. | Yes | 2026-09-27 |
| TASK-013 | Open a PR to `dev`, wait for CI, promote exact code to `test` through a separate PR, and run only `review` against the published APP artifact; inspect full inventory before requesting execute approval. | | |

## 3. Alternatives

- **ALT-001**: General `Deploy Test` is rejected because it combines the pending query-fence change and cannot prove a private SSR Lambda update.
- **ALT-002**: Direct Lambda/CloudFront updates are rejected because they bypass CloudFormation ownership and create drift.
- **ALT-003**: Reverting the query-fence source is rejected because it disturbs previously promoted work and does not close the Lambda reviewer gap.

## 4. Dependencies

- **DEP-001**: APP run `36342080059`, artifact ID `10939780047`, release/source SHA `4f45ffc615d3864a167fdccd87535e244ef01971` is published and verified.
- **DEP-002**: The existing TEST Frontend stack, private admin host, OIDC deployment role, and certificate remain healthy.
- **DEP-003**: The exact user-approved design is committed as `806e671` in the current infrastructure branch.

## 5. Files

- **FILE-001**: `tools/thn-admin-private-release-rotation.js` — release verifier and operations.
- **FILE-002**: `test/thn-admin-private-release-rotation.test.js` — offline safety tests.
- **FILE-003**: `.github/workflows/deploy-thn-admin-private-release-test.yml` — manual review and execute workflow.
- **FILE-004**: `docs/thn-admin-test-release.md` — operator contract.
- **FILE-005**: `changelog/2026-09-27-thn-admin-private-release-rotation.md` — change record.

## 6. Testing

- **TEST-001**: Positive candidate proof accepts the exact prior live template and selected APP manifest; negative cases reject changed query policy, unrelated resources, and mismatched Lambda/static release IDs.
- **TEST-002**: Reviewer accepts only the exact expected non-replacing inventory and rejects extra resources, conditional replacements without proof, changed parameters, pagination, and summary/detail disagreement.
- **TEST-003**: Mock operations prove `review` never executes, cleanup occurs on rejection, `execute` rechecks drift, and `verify` makes no mutation.
- **TEST-004**: `npm test` and `npm run synth:test` pass with Node 22; credential-free GitHub validation passes on `dev` and `test`.
- **TEST-005**: Live TEST review records the complete change-set inventory without execution; QA browser verification occurs only after separately approved execution.

## 7. Risks & Assumptions

- **RISK-001**: CloudFormation may report a conditional alias replacement; if no exact non-replacement proof exists, the review aborts and requires a revised design.
- **RISK-002**: A private SSR Lambda update or CloudFront propagation may briefly interrupt the TEST editor; only reviewed execution may incur this risk.
- **ASSUMPTION-001**: The live stack still uses the historical query handler and the published APP artifact remains immutable.

## 8. Related Specifications / Further Reading

- [Approved design](../docs/superpowers/specs/2026-09-27-thn-admin-test-private-release-rotation-design.md)
- [Existing query-fence release design](../docs/superpowers/specs/2026-09-26-thn-admin-test-query-fence-patch-design.md)
- [CloudFormation change-set documentation](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-updating-stacks-changesets.html)
