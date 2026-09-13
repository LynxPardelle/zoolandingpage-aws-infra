# Zoolandingpage AWS Infra

Serverless frontend infrastructure for `LynxPardelle/zoolandingpage` plus bounded deployment identities for approved Zoolanding service repositories.

This repo follows the Lynx Portfolio split: the Angular app publishes immutable SSR artifacts, and this CDK repo consumes a release id to deploy CloudFront plus Lambda SSR.

## What This Manages

- Private per-environment SSR artifact buckets.
- GitHub OIDC publisher roles for `LynxPardelle/zoolandingpage`.
- Lambda SSR on Node.js 22, ARM64, behind Lambda Function URL with IAM auth.
- CloudFront distributions for the verified certificate groups.
- Optional Route53 alias upserts, disabled by default.
- Retained, branch-bound GitHub OIDC and CloudFormation execution roles for Data Spaces, Commerce, Integrations, and Notifications.
- Bounded Runtime Read deployment identities; TEST alone adds the AWS-managed `LanguageExtensions` transform and narrowly scoped alias/version permissions required by its immutable release, while production keeps its existing scope.

## What This Does Not Touch

- EC2.
- Dokploy.
- Existing API/runtime/content/auth/combo Lambdas.
- Service application resources directly; each service SAM template remains in its owning repository.
- DNS cutover by default.

## Bootstrap Flow

1. Deploy a foundation stack with no `FRONTEND_RELEASE_ID`.
2. Copy `FrontendPublisherRoleArn`, `FrontendArtifactBucketName`, and `FrontendStaticBucketName` to the matching GitHub Environment variables in `LynxPardelle/zoolandingpage`.
3. Run the app repo artifact publishing workflow.
4. Set `FRONTEND_RELEASE_ID` in this infra repo environment.
5. Deploy this CDK repo again to create Lambda SSR and CloudFront.
6. Audit the CloudFront distribution URLs before enabling Route53 records.

See [docs/serverless-frontend-cutover.md](docs/serverless-frontend-cutover.md).
Cost notes are in [docs/cost-estimate.md](docs/cost-estimate.md).
Service identity scope, outputs, and independent deployment targets are in [docs/service-repository-bootstrap.md](docs/service-repository-bootstrap.md).
The TEST frontend workflow deploys only the Frontend stack and fails closed when its immutable release ID is absent; service repository bootstrap stacks remain independent operator targets.

## TEST Frontend Delivery Guardrails

The TEST frontend deploy and rollback workflows use an immutable CDK assembly
produced by an unprivileged validation job. The credential-bearing job accepts
only that artifact, prepares an `UPDATE` change set for the exact TEST Frontend
stack, reviews it, and executes its immutable ARN only after the review passes.
The workflow, assumed role, stack ARN, and change-set ARN are all pinned to AWS
account `765932874577` in `us-east-1`; the credential-bearing job verifies its
STS caller identity before it can inspect or mutate CloudFormation.

Activating `admin-test.thehairnarrative.com` requires both manual approvals:

- TEST DNS, TLS, and CloudFront distribution.
- TEST route association with the shared SSR Lambda.

Both approvals default to false and must be supplied together through a manual
dispatch. The reviewer rejects production aliases, deletion, replacement,
unapproved THN admin changes, and collateral SSR changes. Two narrowly verified
CDK bookkeeping differences are nonfunctional: native `CDKMetadata` Analytics
and Lambda `Metadata/aws:asset:path` with identical remaining properties and
metadata. Complete static detail/context evidence is required. CloudFormation's
`Conditional` classification is accepted only for that exact native Analytics
update, never for a stateful/application resource. An ordinary change set made
only of this bookkeeping returns `noop` without executing an update; metadata
alone cannot satisfy admin-activation evidence.
Rollback requires the recorded source run, artifact ID, source SHA, and manifest
digest from a successful `Deploy Test` run.

See [changelog/2026-09-04-test-infra-delivery-hardening.md](changelog/2026-09-04-test-infra-delivery-hardening.md).
The native metadata reconciliation is recorded in
[the TEST metadata review correction](changelog/2026-09-09-test-metadata-review.md).
The closed APP manifest transport, exact static-origin projection, certificate
preflight, and publish-versus-select sequence are documented in
[THN TEST admin release selection](docs/thn-admin-test-release.md).

The [bounded THN TEST resource inventory check](docs/thn-test-resource-inventory.md)
compares independently sealed local inventories, requires zero QA infrastructure
delta, and never deletes resources or changes protection.

The separate [THN TEST prerequisite workflow](docs/thn-test-prerequisites.md) is
local preparation for one retained certificate or permissionless human role in
its existing owning TEST stack. It cannot apply other service/IAM changes and
requires independently reviewed source/baseline/private-input seals before use.

The independent [THN TEST supplemental permissions path](docs/thn-test-permissions.md)
adds three policies to existing deployment identities, preserving original
roles/trust/policies. It does not activate or deploy the blog.

The separate [THN TEST recovery permission revision](docs/thn-test-recovery-permissions.md)
adds one exact Config/API recovery policy, an independently reviewed API
runtime provisioning policy, or a Config runtime-inspection read policy to its existing owning role. It
does not replay the initial supplemental workflow, adopt a service role for API,
or enable the blog; fresh reviewed private bindings and public hash ledgers are
required before any AWS application.

An exact `INFRA_TEST_PROMOTION_SELECTION_JSON` repository variable can select
source-only TEST promotion: schema version 1, mode `thn-source-only`, and the
reviewed `devSha`, `devTree`, and `testBaseSha`. The existing two-parent promotion
guard still applies. A stale/malformed selection fails before AWS credentials;
an exact one validates/tests/synthesizes but neither publishes an ordinary
deployable artifact nor enters its AWS deployment job, including manual runs.
Absence preserves the ordinary flow. Do not remove the selector to bypass a
blocked promotion; subsequent ordinary delivery requires its own exact review.
