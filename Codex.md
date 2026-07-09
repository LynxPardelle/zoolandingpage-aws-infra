# Zoolandingpage AWS Infra Codex Memory

This repo owns only the serverless frontend infrastructure for `LynxPardelle/zoolandingpage`.

## Durable Rules

- Keep the app source and artifact packaging in `Z:\GitHub\zoolandingpage`.
- Keep CDK infrastructure here.
- Follow `dev -> test -> main` promotion.
- Do not touch EC2 or Dokploy from this repo.
- Keep Route53 cutover disabled until a live CloudFront audit passes for the app and required drafts.
- The app repo publishes browser assets to `zoolandingpage-public-files`; this repo creates private per-environment buckets for the SSR zip and manifest.
- `api.zoolandingpage.com.mx` remains the existing runtime/API front door unless a separate verified backend migration requires changing it.
- 2026-07-09 13:33:59 -06:00: Public infra repo hardening requires pinned GitHub Actions, no skipped promotion guard on manual deploys, branch/environment protection for deployment branches, secret scanning/push protection when available, and Dependabot coverage for npm plus GitHub Actions.
- 2026-07-09 13:41:54 -06:00: Production serverless frontend must deploy in generated-domain audit mode before cutover. Do not attach custom CloudFront aliases until CNAME conflicts are resolved and `FRONTEND_PRODUCTION_CUSTOM_DOMAIN_NAMES_ENABLED=true` is intentionally set for the cutover pass.
- 2026-07-09 13:46:42 -06:00: Do not manage production SSR log groups through CloudFormation while production uses retained resources; a failed alias deploy left `/aws/lambda/zoolandingpage-production-frontend-ssr` in AWS and future deploys should reuse it instead of deleting logs.
- 2026-07-09 14:58 -06:00: Keep `crearpaginaweb.zoolandingpage.com.mx`, `erosbarajas.zoolandingpage.com.mx`, `quierounsitioweb.zoolandingpage.com.mx`, `robertorodriguezrodriguez.zoolandingpage.com.mx`, and `sitiosweb.zoolandingpage.com.mx` out of frontend CloudFront custom aliases until they pass generated-domain browser QA. The production runtime API resolved them to `zoolandingpage.com.mx` / `not-found` during the 2026-07-09 audit.
- 2026-07-09 15:35 -06:00: Serverless frontend CloudFront distributions must route same-origin backend paths directly to API Gateway: `/auth/session*`, `/auth/admin*`, exact `/auth/runtime-config`, `/features/content-hub/*`, `/features/combo-catalog/*`, and `/api-proxy/*`. These were Traefik routes on EC2/Dokploy; without CloudFront behaviors, browser calls fall through to SSR and protected draft admin/runtime features break. Keep `/auth/runtime-config` exact and on the API proxy; do not add broad `/auth/*` because `/auth/callback` remains app-rendered.
- 2026-07-09 16:33 -06:00: `erosbarajas.com` has an issued us-east-1 ACM certificate and is modeled as a generated-domain production frontend for pre-cutover audit. Keep its traffic DNS on EC2 until custom aliases are attached intentionally and browser QA passes.
