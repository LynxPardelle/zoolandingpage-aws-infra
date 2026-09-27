# THN TEST admin release selection

This contract is TEST-only. It does not issue certificates, select a new public
frontend release, create accounts, or enable either approval flag. The private
admin distribution uses a dedicated SSR Lambda and IAM-protected Function URL
from the selected admin release. Its role, log group, and CloudFront access
control are created only with the paired admin approvals. The public SSR Lambda
and its selected release remain independent.

## Inputs and immutable transport

The credential-free validation job binds the protected `test` Environment and
requires these additional variables only when the admin origin is enabled:

- `FRONTEND_TEST_THN_ADMIN_MANIFEST_BASE64`: canonical base64 of the exact
  UTF-8 `thn-admin-release.json` bytes from a verified APP delivery artifact.
  The raw JSON uses two-space indentation and a trailing newline; the encoded
  input is limited to 32,768 characters.
- `FRONTEND_TEST_THN_ADMIN_RELEASE_METADATA_JSON`: compact JSON with exactly
  `schemaVersion`, `environment`, `releaseId`, `sourceCommit`, `runId`,
  `runAttempt`, `deliverySha256`, and `manifestSha256`. Version is 1 and
  environment is `test`. The digests must come from independently verified
  artifact evidence, not from hashing an unverified proposed selection.

The operator verifies APP run, artifact ID, source commit, delivery digest, and
complete inventory before installing these public-safe inputs. Record the exact
artifact ID in the approved release evidence; S3 metadata does not attest that ID.
No cross-repository token or newly public metadata endpoint is required.

The manifest remains the closed APP schema: `version`, `environment`, `releaseId`,
and `staticAssetPaths`. Paths must be 1–64 exact public asset paths under
`/browser/`, with either an 8–64-character hex token or an eight-character
URL-safe mixed-case Angular/esbuild token. Unknown fields, path traversal, private path
segments, non-asset extensions, duplicates and case-fold collisions fail closed.

Validation stores the selection and verifier in the same independently hashed
artifact as the CDK assembly. Deploy compares Environment selection to that
artifact before acquiring credentials. Rollback uses the recorded selection,
not current Environment variables; an older admin-enabled artifact without the
selection/verifier cannot be used by this rollback workflow.

## Credential-bearing read-only preflight

Before CDK preparation (which can publish assets), and again before executing
CloudFormation, the transported verifier:

1. Locates only the exact TEST Frontend stack in the transported CDK assembly.
   It checks the final admin viewer function's UTF-8 byte length is at most
   10,240 and total behaviors, including the default, are at most 75. The
   allowlist is never truncated to fit either quota.
2. Reads the live Original template and exact `ThnAdminTestCertificate` resource.
   The same retained logical certificate must exist in both live and desired
   templates with identical exact-host/zone properties; normal deployment cannot
   create it. This preservation check also runs when the admin flag is off and
   during rollback. Then it extracts the exact admin distribution certificate, binds
   its ARN to the release metadata hash, and requires `DescribeCertificate`
   to return the same account/region/ARN, `ISSUED`, and exactly the admin host
   as both domain name and sole SAN. Wildcards and additional hosts fail.
   The retained certificate and two existing Config TEST policies keep their
   live metadata shape; enabling CDK path metadata must not introduce unrelated
   change-set entries for these resources.
3. Uses the owned TEST stack output to locate the private APP artifact bucket.
   It downloads only the selected release's `manifest.json`, `delivery.json`,
   `thn-admin-release.json`, and `thn-route-manifest.json` into memory.
4. Verifies independent hashes, exact selected bytes, source/run identity,
   completion marker, server bundle checksum, required static inventory, and
   the exact approved admin page/backend route signatures.

These reads require existing deployment-role authority for `acm:DescribeCertificate`,
`cloudformation:DescribeStacks`, `cloudformation:GetTemplate`,
`cloudformation:DescribeStackResource`, and `s3:GetObject` on the exact owned objects.
The existing OIDC principal delegates to CDK bootstrap roles: the helper obtains
the exact `lookupRole.arn` and `assumeRoleArn` from the verified TEST assembly,
checks their account/region/kind and reviewed ARN hash seals, then uses isolated
ephemeral child-process credentials. Lookup handles read-only preflights and
smoke checks; deploy handles only the existing reviewed change-set execution and
wait. CDK itself retains the original parent OIDC identity. There is no freely
selectable role ARN, credential file, new trust, or IAM policy change in this
general release path. The manual private rotation has the single OIDC Lambda
read described below.

The helper independently authenticates the full artifact inventory, external
manifest digest, source SHA, run and TEST target before each role assumption and
again immediately before execution. It re-describes and re-reviews the exact
change-set ARN before executing it. Public-release drift checks and post-deploy
smoke use this same chain instead of unauthorized direct OIDC-role AWS calls.
An older rollback artifact without this verifier cannot pass the current guard.
A failed read or role assumption stops before mutation. An IAM simulation or
operator-profile read is not proof of effective live access through all policies;
the approved deployment must supply that evidence.

## Publish and select are separate gates

Publish the immutable admin-enabled APP artifact and verify its completion marker
before creating the frontdoor routes. The THN-only static origin prefix ends at
`frontend/angular-ssr/test/releases/<admin-release-id>`, because viewer paths
already contain `/browser/`. The public static origin retains its existing
selected release and prefix. No wildcard `/browser/*` behavior is created.

The public `FRONTEND_RELEASE_ID` must still equal the live public release during
the separate admin infrastructure approval. The admin SSR bundle and exact
static asset allowlist are selected from the same verified APP release. The
private session routes use the isolated THN Auth Admin TEST API; the public v1
Auth Admin origin is unchanged. A later admin release rotation requires its own
review of the private SSR Lambda change.
An issued exact certificate and approved DNS ownership remain prerequisites.
The separate [retained prerequisite workflow](thn-test-prerequisites.md) owns its
single-resource bootstrap. The normal reviewer rejects every certificate change;
it does not weaken the existing admin/SSR review to perform issuance.

Local tests cover AWS-shaped change-set responses, exact asset projection,
negative provenance/certificate/size cases, and the no-credential/no-mutation
boundary. They do not demonstrate a deployed origin or a successful AWS run.

## Manual Journal locale query patch in TEST

The `THN Admin TEST Query Fence` workflow is the only release path for the
`articleLocale` viewer-request correction. Promote the reviewed source to
`test` through the normal code-only PR first. Then dispatch the workflow from
that exact full source SHA with `execution=review` (the default). Validation
and CDK synthesis run without AWS credentials. The deploy job checks the
transported artifact and existing admin release before assuming the TEST
roles, and prepares a CloudFormation change set without executing it.

The review accepts only a single non-replacing `FunctionCode` modification on
the admin TEST viewer function. It rejects any dependent distribution, origin,
certificate, DNS, asset, or other resource change, and deletes an unexecuted
change set. Review can still be blocked if CloudFormation classifies a dynamic
dependent resource or omits required property evidence. Inspect that exact
change set and update the design before any wider release; do not use the
general frontend workflow as a fallback.

The preflight compares the complete historical `queryAllowed` body, which
collects query keys and accepts zero or one `lang` key, against the current
`articleLocale` implementation. It also removes only the four Journal rule
flags from the candidate and requires the rest of the live template to match.
The 2026-09-27 review identified an obsolete single-line baseline in the
original proof; the corrected proof keeps the same one-resource release scope.

After a clean review, `execution=execute` creates a new change set and repeats
the live checks immediately before execution. It confirms the Function code,
stack inventory, selected public release, distribution association and HTTP
routes after the stack update. `execution=verify` performs read-only checks on
the deployed result. Record the run ID, source SHA, manifest digest and
change-set ARN from the workflow output. The patch touches only AWS TEST; the
QA article remains unpublished until the separate editorial acceptance flow.

## Manual private admin release rotation in TEST

The 2026-09-27 review stopped before a change set because the CDK lookup role's
`DontReadSecrets` policy explicitly denies `kms:Decrypt`. Its Lambda response
contains `Environment.Error=AccessDeniedException` and omits variables, although
the live Lambda variables match the active Original template when read with an
authorized account session. Do not loosen that bootstrap policy or skip the
variable comparison. The manual rotation instead reads only
`zoolandingpage-test-frontend-thn-admin-ssr` with its already authenticated TEST
GitHub OIDC session. It verifies the exact OIDC role and account first, rejects
missing variables or `Environment.Error`, and keeps all other reads on the CDK
lookup role. Neither variables nor the AWS error message are logged.

Before using this path, verify that the OIDC role trust is still restricted to
`repo:LynxPardelle/zoolandingpage-aws-infra:environment:test` and that inline
policy `ThnAdminPrivateReleaseLambdaRead` does not already exist. Apply only
the reviewed JSON in `tools/thn-admin-private-lambda-read-policy.json` to role
`zoolandingpage-infra-test-github-oidc-deploy`. It allows only
`lambda:GetFunctionConfiguration` for the exact TEST private SSR function ARN.
It grants no KMS action and changes no CDK bootstrap policy. Verify the policy
with IAM readback and a real `execution=review` run. If the read still returns
an environment error, stop before a change set and revise the design. Rollback
of this permission deletes only that named inline policy after confirming its
contents still match the reviewed JSON.

The `THN Admin TEST Private Release Rotation` workflow activates the already
published APP release `4f45ffc615d3864a167fdccd87535e244ef01971` (APP run
`36342080059`, artifact `10939780047`). Its exact source, run, delivery digest,
and admin manifest digest are pinned in the release tool. The manifest and
canonical metadata are supplied as dispatch inputs from the independently
verified APP artifact; the workflow does not change the repository's current
admin release variables or the public frontend release.

Dispatch from the protected infrastructure `test` branch with its full SHA,
the exact APP manifest base64, metadata JSON, and coordinate JSON. The
coordinate JSON has exactly `artifactId`, `sourceSha`, `runId`, `runAttempt`,
`deliverySha256`, and `manifestSha256`. `execution=review` is the default.
Validation runs before OIDC credentials, checks the pinned APP coordinates,
and seals the synthesized assembly and release tools. The deploy job checks
the independently published S3 completion marker and the live stack, function,
Lambda, DNS, certificate, public release, and static asset inventory.

The operation copies the sealed CDK assembly into runner temporary storage
and projects only the private release. It restores the live historical Journal
query policy inside that temporary copy, leaving the separately promoted
`articleLocale` query patch pending. Full-template proof rejects any unrelated
resource or route change. CDK prepares a change set; this may publish an
unchanged CDK asset but does not update the stack. The reviewer requires exact
non-replacing private SSR Lambda, admin viewer Function, and admin distribution
changes, plus only the proved create-only admin alias/SSM dependencies.
`review` prints a digest of the complete detailed and summary inventory and
deletes its unexecuted change set. A blocked review prints only sanitized
resource coordinates and a safe reason code.

`execution=execute` requires the reviewed digest as `expected_review_digest`,
creates a fresh change set, repeats the preflight and full review, then executes
only if the digest and live state still match. This mode needs separate approval
after examining the `review` run. It waits for stack and CloudFront completion
and checks the live release twice, including the Lambda zip checksum, private
DNS and certificate, unchanged public release, and unchanged nonstatic
distribution settings. `execution=verify` is read-only. After execution,
complete the QA browser check with an unpublished draft: upload an inline
image, confirm it renders immediately and after reload, and check the login
and MFA boundary at desktop and mobile sizes.

Rollback requires a reviewed code change pinning the prior verified APP
artifact, followed by the same review and execute gates. Never overwrite an
immutable APP release or use the general TEST deploy to bypass this review.
