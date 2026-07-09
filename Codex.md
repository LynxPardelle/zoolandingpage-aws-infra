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

