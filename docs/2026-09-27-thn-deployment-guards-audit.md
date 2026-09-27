# THN TEST deployment guard audit

Date: 2026-09-27. Scope: local review and fixes, GitHub read-only inspection, and AWS CLI read-only inspection. No new Actions runs, pushes, commits, change-set executions, or AWS permissions changes occurred during this audit.

## Confirmed deployment blockers

### Query Fence rejects the pinned CDK request shape

[Run 36356539983](https://github.com/LynxPardelle/zoolandingpage-aws-infra/actions/runs/36356539983) failed with `query_fence_change_set_invalid`.

The pinned CDK CLI sets `IncludeNestedStacks=true` during `prepare-change-set`, including for a flat stack. AWS CLI evidence from an equivalent native preview showed the flag, no parent/root change-set ARN, one detailed FunctionCode change, four expected summary entries, and no nested resources. The old reviewer rejected the flag alone. The corrected local reviewer accepts that flat preview and still rejects actual nested resources, child references, conflicting metadata, unexpected changes, replacements, and parameter drift.

The local workflow also uses `--previous-parameters` for this code-only release. It no longer resends the concealed origin secret. The recorded full review path passed with 50 recorded AWS reads and no execution. The earlier diagnostic previews were deleted under the user's separate approval before this expanded audit began.

These corrections remain local in `tools/thn-admin-query-fence-patch.js`, its tests, and the Query Fence workflow. They are not active in GitHub TEST yet.

### APP automatic push selects an incompatible artifact

[Run 36349108535](https://github.com/LynxPardelle/zoolandingpage/actions/runs/36349108535) built an artifact successfully, then failed in the downloaded artifact verification step. AWS credential acquisition was skipped.

The TEST environment variable `THN_ADMIN_ARTIFACT_ENABLED` is `true`. The automatic push expression sets the artifact selection to `false`; the downloaded artifact 10941173462 confirms `thnAdmin.enabled=false`. Replaying the exact inline verification against that downloaded artifact passes with allowed=false and fails with allowed=true at the equality between selected and allowed.

This is a producer/policy mismatch. The guard correctly prevents publishing a default-off artifact into a TEST environment configured for the private editor. Do not disable that protection. The current Query Fence release can use the already active private artifact 10939780047; it does not require another APP build. A future APP release must select `thn_admin_artifact=true` explicitly. Automatic push still wastes a build before reaching this known policy rejection; no APP workflow change was made in this audit.

## Shared reviewer gaps repaired locally

`tools/review_test_change_set.py` in Content Hub, Auth Admin, Image Upload, API Proxy, and Config Authoring accepted synthetic descriptions with:

- `NextToken`, leaving another page unreviewed;
- a supplied stack ARN with a conflicting account, region, or stack name;
- parent/root change-set metadata or child resource change-set references.

Each service reproduced nine failing assertion cases before the fix. The local fixes reject those cases and actual `AWS::CloudFormation::Stack` resources. They preserve acceptance of `IncludeNestedStacks=true` when no child changes exist, and preserve action/replacement restrictions. Stack ARN verification is applied when the field is supplied, preserving the existing synthetic-fixture contract; real AWS descriptions include that field.

These gaps are not established causes of the recent deployment failures. Several specialized release wrappers already reject pagination, and ordinary CLI runners retrieve all pages. The shared checks now provide the same protection when called independently. The files matched `origin/test` before editing. No existing unrelated local changes were altered.

## Other service evidence

| Service | Evidence and conclusion |
| --- | --- |
| Content Hub | The previous authoring failure was followed by successful run 36280999514. Current `_same_before` excludes Lambda/alias `ResponseMetadata` while retaining configuration comparisons. Full local handler and release suites pass. |
| Image Upload | Failure 36338440274 exposed the alias/version reference shape; the current code is followed by three successful THN runs, including 36339578213. Current alias/code patch creators explicitly use `IncludeNestedStacks=false`. Local handler and release suites pass. |
| Auth Admin | Last THN run 36273089863 rejected an out-of-scope resource with `authorizer_patch_change_forbidden`. No retained preview remains to reconstruct its complete inventory. Do not broaden that allowlist based only on the error code. Current local unit tests pass; no new Auth Admin deployment is required by Query Fence. |
| Runtime Read | Current TEST deploy 36271362233 succeeded. Its release workflow verifies the immutable live alias code hash. No Runtime Read guard code was changed. |
| Config Authoring | Current TEST deploy 34736156414 succeeded. Full local unit tests pass with the shared reviewer fix. |
| API Proxy | Dedicated runtime run 35779119637 succeeded after the earlier provider failure. Full local unit tests pass with the shared reviewer fix. |
| Draft | Reviewed current TEST workflows, source-promotion verifier, and runtime condition guard. No draft deployment or payload change is needed for Query Fence. |

## Actual AWS TEST inventory

AWS CLI `describe-stacks` and `list-stack-resources`, with complete responses, returned:

| Stack | Status | Resources | Nested stacks |
| --- | --- | ---: | ---: |
| Frontend TEST | UPDATE_COMPLETE | 63 | 0 |
| Content Hub TEST | UPDATE_COMPLETE | 64 | 0 |
| Auth Admin TEST | UPDATE_COMPLETE | 66 | 0 |
| Image Upload TEST | UPDATE_COMPLETE | 8 | 0 |
| API Proxy TEST | UPDATE_COMPLETE | 33 | 0 |
| Runtime Read TEST | UPDATE_COMPLETE | 8 | 0 |
| Config Authoring TEST | UPDATE_COMPLETE | 9 | 0 |

No pagination token remained. Auth Admin, Content Hub, and Image Upload had no retained change sets. These status checks establish stack state, not end-to-end blog acceptance.

## Local verification

- Parsed current TEST workflow YAML for the eight associated repositories and checked 294 shell blocks using Git Bash `bash -n`: no syntax failures. The active Query Fence workflow's 13 shell blocks had also passed separately.
- Current remote guard-focused suites: 112 tests passed before the new shared hardening. These were inspected from archived exact `origin/test` source without changing checkouts.
- After the local shared fixes, complete unit suites: Content Hub 469 (5 skipped), Auth Admin 384, Image Upload 92 (2 skipped), API Proxy 287 (2 skipped), Config Authoring 274. All completed successfully.
- Additional release suites: Content Hub 134 and Image Upload 87, both successful.
- Query Fence and private rotation: 52 tests passed. The full infra suite passed during the preceding exact-template audit.
- `git diff --check` passed for all modified repositories. An existing Image Upload plan has a line-ending warning; this audit did not modify it.

Initial full local runs exposed missing time-zone data, Pillow, JWT/SAM translator dependencies, and Git ownership restrictions. After using the image service's existing environment, adding the required local dependencies, and supplying a per-process exact `safe.directory`, the suites passed. No repository dependency file or global Git trust setting was changed. Some API Proxy negative tests emit SAM translator metrics warnings while passing.

At the original audit, `actionlint` and the SAM CLI were unavailable. During isolated integration, official actionlint 1.7.12 was installed with its release checksum verified and passed for the changed Query Fence workflow. The SAM CLI remains unavailable; SAM-translator-backed tests do not replace it. Tests cannot guarantee absence of every future failure or prove the editor's browser behavior after an unexecuted patch.

## Release readiness and remaining work

1. Preserve the existing private APP artifact and repaired content-addressed template; do not generate another APP artifact for Query Fence.
2. Integrate the local Query Fence fix through the protected code-only promotion path. Shared reviewer hardening belongs in separate service PRs and needs no application deployment to unblock Query Fence.
3. Before dispatch, recheck the exact TEST SHA, APP coordinates and expiry, current stack/template identities, preserved parameters, permission simulations, and projection digest. This audit made no GitHub settings changes.
4. Run the protected Query Fence review after integration. Present its actual inventory and digest for the separately required execution authorization.
5. After the narrowly scoped execution, verify Journal URLs with both locales, private image preview, and draft persistence with the QA session. Do not publish articles during acceptance testing.

The deployable Query Fence guard is still the older remote code. The local fixes are verified but uncommitted and unpushed. The blog's locale fence is not yet deployed, so the blog is not declared complete.

## Isolated integration verification

Before the first push, current dev checkouts passed the complete suites: infrastructure 397 (396 passed, 1 skipped); Content Hub 469 (5 skipped) plus 134 release tests; Auth Admin 382; Image Upload 93 (2 skipped) plus 101 release tests; API Proxy 287 (2 skipped); Config Authoring 274. Differences from the original audit counts reflect the current dev baselines. The recorded native-CDK review again completed 50 reads with decision reviewed-no-execution. Official actionlint passed for Query Fence. SAM CLI and pip-audit commands are unavailable locally.

API Proxy already runs its complete offline unit suite for every PR. A redundant CI trigger change identified during final PR inspection was withdrawn before merge. The five service patches are intended only for dev integration.
