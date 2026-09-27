# THN admin TEST query fence on the active private release

Date: 2026-09-27. Scope: the viewer-request CloudFront Function for `admin-test.thehairnarrative.com` in `ZoolandingTest-Zoolandingpage-test-Frontend`, AWS account `765932874577`, `us-east-1`.

## Observed failure

After private release rotation [run 36351195344](https://github.com/LynxPardelle/zoolandingpage-aws-infra/actions/runs/36351195344), the QA article list loads, but its edit link with `articleLocale=en` returns HTTP 404 with `X-Cache: FunctionGeneratedResponse from cloudfront`. The same edit path without that parameter returns HTTP 200. The editor generates the parameter itself. The rotation intentionally kept the historical query policy, so it did not activate the already reviewed source correction.

The existing `THN Admin TEST Query Fence` workflow uses repository variables for the former admin release `thn-admin-20260925-deb36d88-r1`. The active private release is `4f45ffc615d3864a167fdccd87535e244ef01971`, from APP artifact `10939780047`. Its last review [run 36339735484](https://github.com/LynxPardelle/zoolandingpage-aws-infra/actions/runs/36339735484) also rejected CloudFormation's dynamic dependent entries. Reusing that workflow unchanged would fail before a safe execution.

## Decision and boundaries

Extend the dedicated manual query-fence workflow, keeping its `review`, `execute`, and `verify` modes. Select the exact already deployed private APP artifact through manifest, canonical metadata, and immutable coordinates supplied at dispatch. Validate the published marker and the live selected release before preparing a candidate. Do not change the shared admin release variables or use the general frontend deployment.

The candidate changes only the viewer Function's `FunctionCode` in the CloudFormation template. The code diff must remain the existing narrow transformation: permit a single `articleLocale=en|es` only on `/admin/journal`, `/admin/journal/new`, `/admin/journal/:articleId/edit`, and `/admin/journal/:articleId/preview`. Reject malformed, duplicate, and unrelated query parameters. Preserve current static asset rules, Lambda code, distribution configuration, DNS, certificates, origins, authorization and other resources. Normalize the candidate Function code to the live code and require the whole remaining template to match the live Original template.

## Review and execution proof

First collect both native `DescribeChangeSet` views, with and without `IncludePropertyValues`, from a review-only change set. Record only sanitized resource IDs, types, actions, replacement classifications, property paths, causes, and value-equality booleans. Do not log property values. Use those observed fields to implement an exact allowlist. Require one detailed direct `FunctionCode` update without replacement. Allow summary-only dynamic dependencies only for the precisely observed unchanged reference chain; reject any extra resource, direct dependent change, unexpected value difference, `Replacement=True`, missing detail, or pagination. Review must delete its change set without execution and emit a digest of the full accepted inventory.

`execute` requires the protected TEST source SHA and that exact review digest. It creates a new change set, repeats live preflight and inventory review immediately before execution, and proceeds only if the digest matches. Do not execute on drift or an unreviewed conditional dependency. Wait for CloudFormation and CloudFront to finish. Verify twice that only the Function code and ETag changed; the distribution configuration, viewer association, Lambda, DNS, certificate, public release, private APP release, stack identity, and all other physical resource IDs remain unchanged. A failed postcheck reports the safe failure reason and does not automatically broaden the release or roll back.

## Acceptance

Run focused and full infrastructure tests, including changed native inventory shapes and negative query cases. Promote code `dev → test` with the normal credential-free validation; confirm the automatic AWS job is skipped. Run review only, examine its exact inventory, then request separate action-time approval for execution. After execution, verify HTTP 200 for the four Journal page forms with `lang` and `articleLocale` in either order; preserve 404 for invalid locale, duplicate or unrelated query keys, and unsupported paths. Open the existing unpublished QA article through its normal list link and verify the inline image immediately after upload and after reload. Do not publish an article.

## Alternatives

- Editing frontend links to omit `articleLocale` would require another APP release and would leave legitimate locale URLs blocked.
- Calling CloudFront `UpdateFunction` directly would create drift from CloudFormation and bypass the stack's change-set review.

This design extends the [original query-fence specification](2026-09-26-thn-admin-test-query-fence-patch-design.md); it leaves the private rotation's query-policy preservation unchanged.
