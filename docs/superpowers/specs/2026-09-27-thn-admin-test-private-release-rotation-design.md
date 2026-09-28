# THN TEST private admin release rotation

Date: 2026-09-27. Scope: the existing `admin-test.thehairnarrative.com` frontend stack in AWS TEST only.

## Problem and acceptance condition

The Journal editor saves an uploaded inline image, but the currently active browser bundle renders a transparent placeholder until reload. The frontend correction was reviewed in APP PR #392, promoted through PR #393, and published as an immutable admin-enabled TEST artifact. Its source commit and release ID are `4f45ffc615d3864a167fdccd87535e244ef01971`, APP run `36342080059`, artifact ID `10939780047`. The artifact has 36 selected static assets; local inventory and every recorded file hash match, and the existing infrastructure selection parser accepts its canonical manifest.

Publishing does not activate it. Activation changes the private admin SSR Lambda code and release environment, the admin viewer function's static asset rules, and the admin distribution's static behaviors and origin path. The existing `static-rotation` proof covers only the viewer function and distribution, while the general change-set reviewer rejects an update to the existing private SSR Lambda. The current infrastructure source also contains an undeployed `articleLocale` query-fence patch. A prior review-only query-fence change set reported dependent admin alias, SSM parameter, and distribution entries, so the general deploy must not combine these changes.

Success means the QA editor displays the newly uploaded inline image immediately and after reload, while the same private origin continues to require sign-in and MFA. The public frontend release, other hosts, authentication services, content APIs, Route53 records, certificate, and publication state of QA articles remain unchanged. The separate `articleLocale` query-fence correction stays pending.

## Selected approach

Add a manual `THN Admin TEST Private Release Rotation` workflow on the protected infrastructure `test` branch with `review`, `execute`, and `verify` modes. `review` is the default and cannot execute a change set. A later `execute` dispatch uses a fresh change set and requires separate approval after the exact inventory is reviewed. Source promotion to `test` remains code-only. Use the existing TEST OIDC and CloudFormation execution identities; do not update Lambda, CloudFront, S3 objects, DNS, or GitHub repository variables through an unguarded alternate path.

The workflow consumes the independently published APP artifact by exact release ID, source SHA, run ID and attempt, artifact ID, `delivery.json` digest, and `thn-admin-release.json` digest. Before credentials, it verifies the canonical input shape, full protected source SHA, selected admin origin and public release, and the sealed infrastructure assembly. After credentials, it reads only the expected S3 objects, their completion marker, the live stack, Original and Processed templates, resource inventory, CloudFront function and distribution, private SSR Lambda, certificate, and exact admin DNS records. Any stale, missing, mismatched, or paginated evidence blocks the release.

## Candidate template and scope proof

Synthesize the protected infrastructure source with the new admin selection, then construct a release candidate that **preserves the deployed query-fence behavior**. The projection must recognize the precise historical query handler and the exact four undeployed Journal rule flags; it restores only those parts of the synthesized viewer function to the live form. It does not alter the checked-in query-fence source or its future release. A changed historical handler, route inventory, host check, or any other unrecognized source delta blocks the operation.

Compare the candidate with the live Original template after normalizing only these exact paths:

- Existing private admin SSR Lambda: the artifact S3 code location and the selected release ID environment value.
- Existing admin viewer-request Function: the static asset rule inventory derived from the selected canonical manifest; all nonstatic rules and handler code equal live.
- Existing admin distribution: the selected static cache behaviors and private static origin path; backend behaviors, TLS, aliases, and remaining origins equal live.

The normalized full templates must match, including all unrelated resources, parameters, outputs, and retention policies. Reject a new or removed resource, changes to IAM, public SSR, other distributions, certificates, DNS or service origins, and any change that would broaden allowed routes. The private Lambda code S3 key must name the same verified immutable release; the static origin and rule list must use that release's verified asset inventory. Preserve the live public release selection.

## Change-set review and execution

Create an UPDATE change set for the exact TEST Frontend stack without executing it. Review complete detailed and summary descriptions, including property values, against the pinned stack ID, role, parameters, and template digests. The expected direct changes are one non-replacing modification each to the private SSR Lambda, admin viewer Function, and admin distribution. CloudFormation may list the exact existing admin domain SSM parameter and create-only alias custom resource as dynamic dependents of the distribution. Admit those entries only when their logical IDs, types, actions, property paths, source references, and physical identities match the documented dependency shape; the distribution domain and Route53 A/AAAA targets must remain identical. A `True` replacement, an unexplained `Conditional` replacement, an alias handler capable of updating records, any additional resource, or conflicting detailed and summary evidence aborts before execution. The reviewer must not infer safety solely from a resource name.

`review` records a sanitized inventory and relevant digests and deletes its unexecuted change set. `execute` rechecks the artifact, live state, protected source tip, current GitHub selection, template projection, and a newly created change set immediately before execution. It accepts no changed inventory relative to the approved review. CloudFormation then updates the stack; a failed stack update stops and reports the exact failure without broadening the allowlist. `verify` is read-only.

After `UPDATE_COMPLETE`, verify twice that the live Lambda code location and release ID, viewer Function code, distribution static paths and origin, protected backend routes, exact DNS records, certificate, public release, and unrelated stack resource identities match the approved state. Check the admin access page and QA editor at desktop and mobile sizes; upload an image to a private QA draft, confirm immediate display and display after reload, and do not publish it. Allow bounded CloudFront propagation time and report a timeout as a failed verification. A rollback uses the prior verified immutable admin artifact through the same review and execute gates; never overwrite or delete an immutable release.

## Validation and release gates

- Offline tests prove manifest/hash/source binding, exact template normalization, query-fence preservation, Lambda and static asset coupling, unknown-resource rejection, detailed/summary drift rejection, replacement handling, review-only cleanup, execute race checks, and post-update verification.
- Run the full infrastructure test suite and credential-free TEST validation before promotion. Review the `dev -> test` diff and CI before the code-only merge.
- Run `review` against live AWS and inspect its complete change-set inventory before requesting `execute` approval. A blocked review is evidence to revise this design, not permission to use the general deploy.
- Keep AWS account, region, stack, host, and release coordinates exact; log only sanitized identifiers and hashes, never credentials, raw environment values, signed URLs, or article content.

## Alternatives considered

- General `Deploy Test` would include the pending query-fence delta and its reviewer does not permit an existing private SSR Lambda update.
- Temporarily reverting the query-fence source would disturb already promoted work and still leave the Lambda review gap.
- Direct service API updates would bypass CloudFormation ownership and create drift.

## References

- `docs/thn-admin-test-release.md`
- `docs/superpowers/specs/2026-09-26-thn-admin-test-query-fence-patch-design.md`
- `tools/thn-admin-release.js`, `tools/review-test-infra-change-set.js`, and `lib/stacks/frontend-stack.js`
- [AWS CloudFormation change-set review](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-updating-stacks-changesets.html)
- [AWS CloudFormation conditional replacement behavior](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/using-cfn-updating-stacks-changesets-samples.html)
