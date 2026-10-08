# Zooberiah production front door

`zooberiahsystems.com` uses a closed production workflow because the shared
production stack cannot be deployed broadly from `main`. The workflow changes
only the Zooberiah CloudFront resources and the two required values in the
shared SSR allowed-host list. Every operation is a retained CloudFormation
change set with a separate review and execution.

## Source and release boundary

Promote this source through `dev -> test -> main` before running
`Zooberiah Production Front Door`. Each run requires the exact current `main`
SHA and the exact currently deployed production frontend release ID. Review
artifacts expire after 24 hours. `execute` and `cleanup` accept only the exact
review run and digest produced for the same source, phase, and action.
Before any projection, the workflow proves that this release ID matches both
the live shared SSR environment and its immutable server object in the exact
production artifact bucket.

The baseline capture accepts the separately retained
`ThnAdminProductionCertificate` already owned by the shared production stack.
It still snapshots that resource with the rest of the stack, includes it in
the sealed baseline digest, and requires the `admin.thehairnarrative.com` DNS
name itself to remain absent. The certificate creation workflow keeps its
stricter certificate-absent precondition; this exception applies only to the
Zooberiah front-door operation.

The workflow supports two phases and neither one changes Route53:

- `generated`: creates the distribution without aliases or an ACM viewer
  certificate. Its viewer function supplies `zooberiahsystems.com` as the audit
  host. Audit the generated CloudFront hostname before continuing.
- `aliases`: attaches `zooberiahsystems.com` and
  `www.zooberiahsystems.com` with the existing certificate. It fails before a
  change set unless ACM is `ISSUED`, both validations succeeded, and Route53
  still contains the HostGator apex A record plus the `www` CNAME. The same
  protected source compiles and seals both phase templates; alias attachment
  also proves the six live Zooberiah resources still equal the generated phase
  and permits only the distribution and viewer function to change.

For either phase, run `review`, inspect the seven-resource generated change set
(or the two expected modifications for alias attachment), then run `execute`
with the retained run ID and digest. `cleanup` deletes an unexecuted reviewed
change set. `rollback` uses the same review/execute split and removes the exact
front door; it also restores the shared SSR allowed-host list. Alias rollback
still requires the HostGator DNS shape to have been restored, but it does not
depend on a healthy certificate so certificate failure cannot block recovery.

## DNS cutover

Do not enable CDK Route53 records for the generated or alias phase. The copied
HostGator zone currently has `www` as a CNAME to the apex. Route53 cannot keep
that CNAME alongside `www` A/AAAA aliases.

After nameserver delegation, certificate issuance, alias attachment, and
desktop/mobile QA, apply one atomic Route53 change batch:

1. Delete the existing `www` CNAME using its exact TTL and value.
2. Upsert apex A and AAAA aliases to the reviewed CloudFront distribution.
3. Upsert `www` A and AAAA aliases to the same distribution.

The rollback batch is the exact reverse: remove the four CloudFront aliases,
restore the HostGator apex A record, and recreate the `www` CNAME. Apply that
DNS rollback before running an `aliases` front-door rollback. Mail MX, SPF,
DKIM, autodiscovery, CalDAV, CardDAV, cPanel, and direct HostGator service
records are outside this operation and must remain unchanged.

Route53 ownership can be adopted by CDK later through a separate reviewed
source change, after the CNAME has been removed and the live A/AAAA aliases
have been captured exactly.

## Verification

Before DNS cutover, verify the generated distribution, then the attached alias
with a connection override so public DNS continues to reach HostGator. After
cutover verify:

- apex HTTPS and `www` canonical redirect;
- desktop and mobile rendering, 404 behavior, assets, console, and network;
- analytics consent behavior;
- MX, SPF, DKIM, webmail, and send/receive behavior;
- the absence of unexpected Route53 changes.
