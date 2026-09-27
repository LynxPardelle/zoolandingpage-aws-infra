# THN admin TEST query-fence patch

Date: 2026-09-26. Scope: the `admin-test.thehairnarrative.com` viewer-request CloudFront Function owned by `ZoolandingTest-Zoolandingpage-test-Frontend` in AWS account `765932874577`, `us-east-1`.

## Problem and success condition

The editor emits `articleLocale=en|es` on Journal page URLs. The deployed viewer-request function rejects that query key, so direct navigation to an article editor or preview returns 404 before the application runs. The source change permits that key only on `/admin/journal`, `/admin/journal/new`, `/admin/journal/:articleId/edit`, and `/admin/journal/:articleId/preview`. The value must be exactly `en` or `es`; malformed, duplicate, and unrelated query parameters remain denied. Offline frontend tests pass. Success means those four page forms load in TEST with valid locale and the existing negative route cases still return 404, while the distribution, origins, certificate, DNS, static assets, backend routing and production remain unchanged.

## Selected approach and boundary

Add a dedicated manual TEST `query-fence` release with `review`, `execute`, and `verify` choices, defaulting to `review`. It consumes an immutable TEST source SHA and a separately validated CDK assembly. The normal `test` source promotion remains credential-free and cannot itself deploy this patch. Use the existing TEST OIDC deployment identity and CloudFormation ownership; do not call CloudFront `UpdateFunction` directly.

Normalize the candidate by replacing `FrontendViewerHostHeaderFunctionThehairnarrativeAdminTestD75B90C2.Properties.FunctionCode` with the live code; the normalized candidate must then equal the entire live stack template. The function code delta is additionally proved against the exact reviewed source transformation: the four Journal page rules gain `allowArticleLocaleQuery`, and `queryAllowed` accepts `articleLocale` only when that rule flag is true, still requiring a single `en` or `es` value. The proof rejects any other change to the handler, host check, viewer IP handling, route inventory, methods, static asset paths, origin selection, headers or denial behavior. No changed distribution association or other resource property is allowed.

## Inputs and preflight

Pin the full TEST source SHA, CDK assembly digest, release selection, and artifact identity. Read the live Original template, full stack parameters and inventory, Function metadata/code and current LIVE stage, distribution association, selected APP release, certificate, DNS and origin state twice. Require one healthy target stack in the exact account and region, its existing deployment role and current termination-protection setting, the exact admin host and viewer-request association, and an unchanged published APP release. Read-only inspection on 2026-09-26 found termination protection disabled on this TEST stack and the Function PhysicalResourceId to be its ARN; the patch preserves both settings and does not attempt to enable protection. Pin the current Function ETag/code digest and stack identity. Any drift, missing field, unexpected extra association, or changed selection blocks release.

Prepare an UPDATE change set with the existing CloudFormation execution role. Compare both candidate Original and Processed templates to the pinned live template, and read the complete detailed and summary change set. Accept only one non-replacing `AWS::CloudFront::Function` `Modify` for `FunctionCode` on the exact logical ID. CloudFormation may report dynamic dependent changes even when the template delta is only FunctionCode; if any distribution, DNS, SSM, certificate, origin, asset or other resource is listed, stop without executing and investigate that concrete change set. Do not silently widen the allowlist. Unknown or paginated entries, replacement, template/parameter changes, or conflicting detailed and summary descriptions also block release.

`review` reports the proven code digest, exact change-set inventory and any blocked dependent entries without executing. Remove its unexecuted change set after review. `execute` builds a fresh change set and repeats the full preflight and proof immediately before execution; a previous review does not authorize changed AWS state. It executes only if the same one-resource allowlist passes. No general frontend deployment or change to `origin-only`/`static-rotation` proof behavior is part of this patch.

After stack `UPDATE_COMPLETE`, verify twice that LIVE Function code/ETag and stack template match the reviewed candidate; the viewer-request association, distribution configuration, DNS, certificate, origin, APP release and all other resources retain their pinned identity. Use exact HTTP probes, without credentials in URLs, to confirm the four valid page forms work and invalid values, extra query keys and unsupported paths remain denied. Account for CloudFront propagation with bounded retries; a timeout is a failed verification, not permission to expand scope. `verify` is read-only. A failed postcheck reports the precise safe failure and leaves any rollback for a separately reviewed change set.

## Implementation and validation

Keep this proof and manual workflow separate from existing general, `origin-only`, and `static-rotation` releases. Add offline tests for exact source transformation, the one-resource detailed and summary allowlist, dependent-change rejection, artifact/source identity, race and drift, review-only behavior, postcheck, and negative route behavior. Run the full infrastructure test suite and credential-free TEST validation before release. After deployment, verify a QA editor direct link with `lang=es&articleLocale=en` and repeat the negative HTTP probes. The Image Upload code patch is a separate release and can be verified independently before the QA article cover and publish/withdraw acceptance flow.

## Alternatives considered

- General `Deploy Test`: its existing change-set reviewer can admit wider frontend changes and historical change sets have listed dependent resources.
- Direct CloudFront Function update: bypasses the CloudFormation template and creates drift.

## References

- `docs/thn-admin-test-release.md`
- `lib/stacks/frontend-stack.js` and `test/frontend.test.js`
- `tools/thn-admin-release.js` and `tools/review-test-infra-change-set.js`
