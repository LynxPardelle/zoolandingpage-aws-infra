# THN TEST admin release selection

This contract is TEST-only. It does not issue certificates, select a new public
frontend release, create accounts, change IAM, or enable either approval flag.
The existing shared SSR Lambda and exact-host guard remain unchanged.

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
`/browser/`, with either an 8–64-character hex token or an 8-character uppercase
base32 Angular/esbuild token. Unknown fields, path traversal, private path
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
selectable role ARN, credential file, new trust, or IAM policy change.

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
the separate admin infrastructure approval. Selecting the shared Lambda's new
APP artifact happens at the independently approved frontend-release step; it
must not be combined with or hidden inside admin infrastructure activation.
An issued exact certificate and approved DNS ownership remain prerequisites.
The separate [retained prerequisite workflow](thn-test-prerequisites.md) owns its
single-resource bootstrap. The normal reviewer rejects every certificate change;
it does not weaken the existing admin/SSR review to perform issuance.

Local tests cover AWS-shaped change-set responses, exact asset projection,
negative provenance/certificate/size cases, and the no-credential/no-mutation
boundary. They do not demonstrate a deployed origin or a successful AWS run.
