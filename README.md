# Zoolandingpage AWS Infra

Serverless frontend infrastructure for `LynxPardelle/zoolandingpage`.

This repo follows the Lynx Portfolio split: the Angular app publishes immutable SSR artifacts, and this CDK repo consumes a release id to deploy CloudFront plus Lambda SSR.

## What This Manages

- Private per-environment SSR artifact buckets.
- GitHub OIDC publisher roles for `LynxPardelle/zoolandingpage`.
- Lambda SSR on Node.js 22, ARM64, behind Lambda Function URL with IAM auth.
- CloudFront distributions for the verified certificate groups.
- Optional Route53 alias upserts, disabled by default.

## What This Does Not Touch

- EC2.
- Dokploy.
- Existing API/runtime/content/auth/combo Lambdas.
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
