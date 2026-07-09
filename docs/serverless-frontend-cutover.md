# Serverless Frontend Cutover

Source facts verified on 2026-07-09 CT:

- `zoolandingpage.com.mx`, `test.zoolandingpage.com.mx`, and multiple draft aliases still point to EC2 IP `32.195.120.158`.
- `assets.zoolandingpage.com.mx` is CloudFront distribution `E2DVKBRSVK4JQG` with origin `zoolandingpage-public-files.s3.us-east-1.amazonaws.com`.
- `api.zoolandingpage.com.mx` is already CloudFront and remains the app/runtime front door.
- ACM certificate `0412c449-7cbd-4d99-a565-25f26a1b6c17` covers `zoolandingpage.com.mx` and `*.zoolandingpage.com.mx`.
- ACM certificate `17f757f0-19bf-4e6d-b294-16f16092d8e6` covers `zoositioweb.com.mx`, `zoositioweb.com`, `sulandingpage.com.mx`, `sulandingpage.com`, and `zoolandingpage.com`.
- ACM certificate `4b008cec-97a6-447e-bf2f-9165e435b363` covers `lynxpardelle.com` and `*.lynxpardelle.com`.

## Phases

1. Foundation deploy: create private artifact bucket and GitHub publisher role only.
2. Artifact publish: app repo uploads browser files to `zoolandingpage-public-files` and SSR zip/manifest to the private artifact bucket.
3. Hosting deploy: set `FRONTEND_RELEASE_ID`, then create Lambda SSR and generated CloudFront distributions.
4. Live audit: test generated CloudFront distribution domains with `auditHostHint` while custom aliases remain detached.
5. Custom alias attach: set `FRONTEND_PRODUCTION_CUSTOM_DOMAIN_NAMES_ENABLED=true` only after alias conflicts are resolved and cutover is approved.
6. DNS cutover: set `route53RecordsEnabled: true` only after live audit passes.
7. EC2 retirement: shut down EC2 only after all required production and draft aliases pass serverless browser QA.

## DNS Safety

`route53RecordsEnabled` stays disabled globally. Test and pre-cutover production front doors deploy without custom aliases for audit through generated CloudFront distribution domains.

The first `test.zoolandingpage.com.mx` alias deploy attempt on 2026-07-09 CT failed because CloudFront returned: `One or more of the CNAMEs you provided are already associated with a different resource.` Route53 still points `test.zoolandingpage.com.mx` to EC2 IP `32.195.120.158`; keep it there until the CNAME ownership/conflict is resolved and audit passes.

The first production alias attach attempt on 2026-07-09 CT failed on `FrontendDistributionZoolandingpageMx` with the same CloudFront CNAME conflict. Keep production in generated-domain audit mode until the conflicting CloudFront association is identified and moved intentionally.

The rollback from that production attempt left `/aws/lambda/zoolandingpage-production-frontend-ssr` as an existing log group. Production no longer manages that log group through CloudFormation; Lambda can write to the existing group without deleting audit logs.

When production cutover is approved, first enable custom domain names, then enable Route53 only in a separate commit and deploy through `dev -> test -> main`.

The 2026-07-09 generated-domain browser audit passed for the production release `7b349b216577d920eb788453f97cc58c38c98335` on 12 of 17 modeled hostnames in desktop and mobile. The failed hostnames rendered an empty hydrated app shell and must stay off CloudFront custom aliases until their runtime mapping is republished or intentionally retired.

## CloudFront Host Forwarding

Lambda Function URL origins receive their own `*.lambda-url.*.on.aws` host when CloudFront uses `OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER`. Each frontend distribution therefore attaches a viewer-request CloudFront Function that sets `X-Forwarded-Host` before the origin request. The app repo's packaged Lambda adapter rewrites `Host` from that forwarded value only when the incoming host is a Lambda Function URL host.

Do not set `X-Forwarded-Proto` in a CloudFront Function; AWS rejects it as a disallowed edge-function header. The packaged Lambda adapter defaults the forwarded proto to `https` after host normalization.

For generated CloudFront audit domains, set `auditHostHint` on the front door so SSR resolves the intended platform host without moving DNS.

Same-origin app backend routes must be explicit CloudFront behaviors. EC2/Dokploy previously routed `/auth/session/*`, `/auth/admin/*`, `/features/content-hub/*`, `/features/combo-catalog/*`, and `/api-proxy/*` through Traefik; the serverless frontend distributions now route those path patterns directly to the existing API Gateway backends. Keep `/auth/runtime-config` on the SSR/app path because the auth-admin front door intentionally owns only session and admin routes.

## Known Alias Gaps

These aliases were not mapped into CloudFront because the required Route53/certificate evidence was missing or incomplete in this account during inspection:

- `erosbarajas.com`: no issued us-east-1 ACM certificate found.
- `crearpaginaweb.zoolandingpage.com.mx`: generated CloudFront browser QA rendered an empty shell; the production runtime API resolved it to `zoolandingpage.com.mx` / `not-found`.
- `erosbarajas.zoolandingpage.com.mx`: retired alias; EC2 returned HTTP 404 and the production runtime API resolved it to `zoolandingpage.com.mx` / `not-found`.
- `quierounsitioweb.zoolandingpage.com.mx`: generated CloudFront browser QA rendered an empty shell; the production runtime API resolved it to `zoolandingpage.com.mx` / `not-found`.
- `robertorodriguezrodriguez.zoolandingpage.com.mx`: generated CloudFront browser QA rendered an empty shell; the production runtime API resolved it to `zoolandingpage.com.mx` / `not-found`.
- `sitiosweb.zoolandingpage.com.mx`: generated CloudFront browser QA rendered an empty shell; the production runtime API resolved it to `zoolandingpage.com.mx` / `not-found`.
- `test.despacholegalastralex.zoolandingpage.com.mx`: not covered by `*.zoolandingpage.com.mx` and no exact us-east-1 ACM certificate found.
- `alecfest-voliii.com`: draft registry lists it, but Route53/ACM ownership was not verified in this account.
- `grupoastralegal.com`: draft registry lists it, but Route53/ACM ownership was not verified in this account.
- `pamelabetancourt.com`: draft registry lists it, but Route53/ACM ownership was not verified in this account.
- `robertorodriguezrodriguez.com.mx`: draft registry lists it, but Route53/ACM ownership was not verified in this account.
