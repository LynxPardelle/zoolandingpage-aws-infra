---
goal: Release the THN admin articleLocale query fence against the active private TEST artifact
version: 2.0
date_created: 2026-09-27
status: 'In progress'
tags: [infrastructure, test, thn, cloudfront]
---

# Introduction

![Status: In progress](https://img.shields.io/badge/status-In%20progress-yellow)

The current TEST editor links include `articleLocale`, which the live CloudFront Function rejects with HTTP 404. This plan updates only the dedicated query-fence release path to target the already active private APP artifact and to review CloudFormation's native dependent entries before execution.

## 1. Requirements & Constraints

- **REQ-001**: Bind every run to a full protected `test` source SHA, account `765932874577`, region `us-east-1`, and stack `ZoolandingTest-Zoolandingpage-test-Frontend`.
- **REQ-002**: Select and verify active APP artifact `10939780047`, source `4f45ffc615d3864a167fdccd87535e244ef01971`, and its canonical manifest and metadata without changing shared GitHub release variables.
- **REQ-003**: Candidate and live Original templates may differ only at `FrontendViewerHostHeaderFunctionThehairnarrativeAdminTestD75B90C2.Properties.FunctionCode`, with the four approved `articleLocale` route flags and query handler transformation.
- **REQ-004**: Review both native change-set views. Require one detailed, non-replacing direct FunctionCode modification. Admit summary dependencies only after observing their exact native fields and proving they are dynamic references from otherwise identical templates. Reject all unknown resources and `Replacement=True`.
- **REQ-005**: Emit a canonical review digest and require that digest on `execute`; repeat preflight and change-set comparison immediately before execution.
- **REQ-006**: After execution, verify twice that only Function code and ETag changed, all other resource identities and distribution settings remain stable, and valid and invalid Journal HTTP probes behave as specified.
- **SEC-001**: Use existing TEST OIDC and CloudFormation execution roles; do not use direct CloudFront updates or production credentials.
- **CON-001**: Keep general frontend, private rotation, `origin-only`, and `static-rotation` guards unchanged.
- **CON-002**: Do not execute AWS or publish articles during code promotion or review-only runs.

## 2. Implementation Steps

### Implementation Phase 1

- GOAL-001: Reproduce the active-release and native-inventory failures in tests.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Add tests in `test/thn-admin-query-fence-patch.test.js` showing that the current workflow selection uses the former APP release and that the live private selection must be accepted only with matching immutable coordinates. Run the focused suite and confirm the new tests fail for the intended reason. | | |
| TASK-002 | Add tests in the same file for one detailed FunctionCode change plus the exact observed dynamic summary dependency fields; reject extras, changed causes, changed values where exposed, replacement, pagination, and changing inventory between reads. Confirm failure before changing the reviewer. | | |
| TASK-003 | Add tests for reviewed-digest binding, rechecked protected SHA, pre-execute drift, and post-update physical identity preservation. Confirm failure before implementation. | | |

### Implementation Phase 2

- GOAL-002: Implement the minimum isolated release changes.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-004 | Extend `.github/workflows/deploy-thn-admin-query-fence-test.yml` with exact private APP manifest, metadata, coordinates, and `expected_review_digest` dispatch inputs; validate them before AWS credentials using the pinned selection logic from `tools/thn-admin-release.js`. Do not modify shared repository variables. | | |
| TASK-005 | Update `tools/thn-admin-query-fence-patch.js` to validate the active release and compare full candidate/live templates. Add sanitized diagnostic output for the native change-set shape. Run `execution=review` only to capture exact fields if existing evidence lacks them; delete its change set. | | |
| TASK-006 | Implement an exact detailed and summary inventory allowlist, canonical review digest, digest-bound execution, and strict repeated preflight and postcheck in `tools/thn-admin-query-fence-patch.js`. Keep the existing route transformation proof intact. | | |
| TASK-007 | Update `docs/thn-admin-test-release.md` to describe active-artifact dispatch, review digest, conditional dependency treatment, and the rollback boundary. Run focused tests until green. | | |

### Implementation Phase 3

- GOAL-003: Validate, promote, and perform a separately authorized TEST release.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-008 | Run the full `npm test`, CDK synth, workflow contract tests, and a clean diff review. Open a draft PR to `dev`, merge after green checks and review, then promote exact `dev` tree to `test` as code only; confirm the automatic AWS job was skipped. | | |
| TASK-009 | Dispatch `THN Admin TEST Query Fence` with `execution=review`, inspect both change-set views and the emitted digest, and confirm no CloudFormation update. Stop on any unrecognized entry. | | |
| TASK-010 | Request separate approval for `execution=execute` with the exact TEST SHA, digest, active artifact and observed conditional dependencies. After approval, execute once and inspect stack, CloudFront and route postchecks. | | |
| TASK-011 | Open the normal QA article link with `lang` and `articleLocale`, confirm a new inline image appears immediately and after reload, and leave the QA article unpublished. | | |

## 3. Alternatives

- **ALT-001**: Omit `articleLocale` in APP links; rejected because valid locale URLs would remain blocked and another APP release would be required.
- **ALT-002**: Update the CloudFront Function directly; rejected because it bypasses CloudFormation ownership and creates drift.

## 4. Dependencies

- **DEP-001**: Approved `docs/superpowers/specs/2026-09-27-thn-admin-query-fence-current-release-design.md`.
- **DEP-002**: Active private release from run `36351195344` and immutable APP artifact `10939780047`.
- **DEP-003**: Existing TEST OIDC role, CloudFormation execution role and healthy deployed admin stack.

## 5. Files

- **FILE-001**: `.github/workflows/deploy-thn-admin-query-fence-test.yml` — manual dispatch and artifact selection.
- **FILE-002**: `tools/thn-admin-query-fence-patch.js` — preflight, inventory proof, digest and postcheck.
- **FILE-003**: `test/thn-admin-query-fence-patch.test.js` — failing and passing behavior checks.
- **FILE-004**: `docs/thn-admin-test-release.md` — operator instructions.

## 6. Testing

- **TEST-001**: Observe each new focused test fail before implementation and pass after the minimum code change.
- **TEST-002**: Full infrastructure tests and CDK synth pass from the release branch.
- **TEST-003**: Review-only workflow deletes its change set and prints an exact inventory digest without updating AWS.
- **TEST-004**: Execution rechecks digest and live identity and performs two postchecks; valid Journal URLs load, invalid URLs remain denied.

## 7. Risks & Assumptions

- **RISK-001**: CloudFormation may classify unchanged derived references as conditional replacements. The reviewer accepts only observed exact dynamic entries, and execution needs separate approval after review.
- **RISK-002**: A changed shared TEST source or live APP release invalidates selection; fail before executing.
- **ASSUMPTION-001**: The public and private TEST releases and physical resource IDs are stable at the review preflight; verify this rather than assuming it.

## 8. Related Specifications / Further Reading

- `docs/superpowers/specs/2026-09-27-thn-admin-query-fence-current-release-design.md`
- `docs/superpowers/specs/2026-09-26-thn-admin-test-query-fence-patch-design.md`
- `docs/thn-admin-test-release.md`
