# Serverless Frontend Cutover

Source facts verified on 2026-07-09 CT, updated for test cutover on 2026-07-10 CT:

- `zoolandingpage.com.mx` and production draft aliases still point to EC2 IP `32.195.120.158`; `test.zoolandingpage.com.mx` now points to the test CloudFront serverless frontend.
- `assets.zoolandingpage.com.mx` is CloudFront distribution `E2DVKBRSVK4JQG` with origin `zoolandingpage-public-files.s3.us-east-1.amazonaws.com`.
- `api.zoolandingpage.com.mx` is already CloudFront and remains the app/runtime front door.
- ACM certificate `0412c449-7cbd-4d99-a565-25f26a1b6c17` covers `zoolandingpage.com.mx` and `*.zoolandingpage.com.mx`.
- ACM certificate `17f757f0-19bf-4e6d-b294-16f16092d8e6` covers `zoositioweb.com.mx`, `zoositioweb.com`, `sulandingpage.com.mx`, `sulandingpage.com`, and `zoolandingpage.com`.
- ACM certificate `4b008cec-97a6-447e-bf2f-9165e435b363` covers `lynxpardelle.com` and `*.lynxpardelle.com`.

Astra Legal DNS cutover preparation verified on 2026-07-21 CT:

- Public Route53 hosted zone `Z05844193OR5CAJJCR2ZJ` exists for `grupoastralegal.com`, but the registrar still delegates to HostGator nameservers. Creating the zone did not change public DNS.
- The inactive Route53 zone contains the HostGator mail, DKIM, SPF, autodiscovery, CardDAV, CalDAV, webmail, and cPanel records with migration TTL `300`. Apex and `www` retain the HostGator address until this cutover deploy replaces them with CloudFront aliases.
- ACM certificate `882ab0a9-c900-482d-ac9b-2f3baca96f40` covers the apex and `www` and is `ISSUED`. Both validation CNAMEs resolve publicly from the authoritative HostGator zone and also exist in Route53 for renewal after delegation.
- `_acme-challenge`, `_cpanel-dcv-test-record`, and `localhost` were intentionally not copied. They are not required to preserve HostGator mail and must not be treated as production mail dependencies.
- The public resolver returned no MX answer during the pre-cutover audit even though the HostGator export supplied `0 mail.grupoastralegal.com`. The Route53 copy includes that explicit MX record; confirm send and receive behavior before changing nameservers.

## Phases

1. Foundation deploy: create private artifact bucket and GitHub publisher role only.
2. Artifact publish: app repo uploads browser files to `zoolandingpage-public-files` and SSR zip/manifest to the private artifact bucket.
3. Hosting deploy: set `FRONTEND_RELEASE_ID`, then create Lambda SSR and generated CloudFront distributions.
4. Live audit: test generated CloudFront distribution domains with `auditHostHint` while custom aliases remain detached.
5. Custom alias attach: set `FRONTEND_PRODUCTION_CUSTOM_DOMAIN_NAMES_ENABLED=true` only after alias conflicts are resolved and cutover is approved.
6. DNS cutover: set `route53RecordsEnabled: true` only after live audit passes.
7. EC2 retirement: shut down EC2 only after all required production and draft aliases pass serverless browser QA.

## DNS Safety

Production `route53RecordsEnabled` stays disabled globally. Production custom aliases are attached to CloudFront, but traffic DNS still points the production domains to EC2 until the final Route53 cutover.

The first `test.zoolandingpage.com.mx` alias deploy attempt on 2026-07-09 CT failed because CloudFront returned: `One or more of the CNAMEs you provided are already associated with a different resource.` The conflict was the old EC2-backed CloudFront distribution tenant `dt_3Bhy5qjEUxpR8ghObjxAxxgPRJz` on distribution `E10Y59XAIPQY6A`. On 2026-07-10 CT it was disabled/deleted after confirming Route53 still pointed directly to EC2, then `test.zoolandingpage.com.mx` was cut over to `dwjxhi1zggvug.cloudfront.net` (`E27T2MENBSWMWJ`) with Route53 A/AAAA alias records.

The first production alias attach attempt on 2026-07-09 CT failed on `FrontendDistributionZoolandingpageMx` with the same CloudFront CNAME conflict. The conflict was resolved on 2026-07-10 CT by deleting the old CloudFront distribution tenant for `zoolandingpage.com.mx` after confirming Route53 still points the domain directly to EC2.

On 2026-07-10 CT, `alecfest-voliii.zoolandingpage.com.mx`, `despacholegalastralex.zoolandingpage.com.mx`, `pamelabetancourt.zoolandingpage.com.mx`, and `pokeapi-demo.zoolandingpage.com.mx` were retired by request, removed from the production CloudFront alias model, and deleted from Route53. Do not add them back without a new draft/runtime ownership decision and browser QA.

The rollback from the failed production attempt left `/aws/lambda/zoolandingpage-production-frontend-ssr` as an existing log group. Production no longer manages that log group through CloudFormation; Lambda can write to the existing group without deleting audit logs.

When production cutover is approved, enable Route53 only in a separate commit and deploy through `dev -> test -> main`.

The 2026-07-09 generated-domain browser audit passed for the production release `7b349b216577d920eb788453f97cc58c38c98335` on 12 of 17 checked hostnames in desktop and mobile. Failed hostnames must stay off CloudFront custom aliases until their runtime mapping is republished or they are intentionally retired.

## CloudFront Host Forwarding

Lambda Function URL origins receive their own `*.lambda-url.*.on.aws` host when CloudFront uses `OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER`. Each frontend distribution therefore attaches a viewer-request CloudFront Function that sets `X-Forwarded-Host` before the origin request. The app repo's packaged Lambda adapter rewrites `Host` from that forwarded value only when the incoming host is a Lambda Function URL host.

Do not set `X-Forwarded-Proto` in a CloudFront Function; AWS rejects it as a disallowed edge-function header. The packaged Lambda adapter defaults the forwarded proto to `https` after host normalization.

For generated CloudFront audit domains, set `auditHostHint` on the front door so SSR resolves the intended platform host without moving DNS.

Same-origin app backend routes must be explicit CloudFront behaviors. EC2/Dokploy previously routed `/auth/session/*`, `/auth/admin/*`, `/auth/runtime-config`, `/features/content-hub/*`, `/features/combo-catalog/*`, and `/api-proxy/*` through Traefik; the serverless frontend distributions now route those path patterns directly to the existing API Gateway backends. Keep `/auth/runtime-config` as an exact API proxy behavior, not an auth-admin behavior and not a broad `/auth/*` route, because `/auth/callback` remains app-rendered.

## Known Alias Gaps

These aliases were not mapped into CloudFront because the required Route53/certificate evidence was missing, incomplete, or intentionally retired:

- `erosbarajas.com`: an issued us-east-1 ACM certificate now exists and the domain is modeled as a generated-domain pre-cutover front door, but its traffic DNS record still points to EC2 until audit/cutover approval.
- Retired `*.zoolandingpage.com.mx` aliases: `crearpaginaweb`, `erosbarajas`, `quierounsitioweb`, `robertorodriguezrodriguez`, `sitiosweb`, `alecfest-voliii`, `despacholegalastralex`, `pamelabetancourt`, and `pokeapi-demo`.
- `test.despacholegalastralex.zoolandingpage.com.mx`: not covered by `*.zoolandingpage.com.mx` and no exact us-east-1 ACM certificate found.
- `alecfest-voliii.com`: draft registry lists it, but Route53/ACM ownership was not verified in this account.
- `pamelabetancourt.com`: draft registry lists it, but Route53/ACM ownership was not verified in this account.
- `robertorodriguezrodriguez.com.mx`: draft registry lists it, but Route53/ACM ownership was not verified in this account.
