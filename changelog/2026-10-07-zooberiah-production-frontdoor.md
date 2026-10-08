# Zooberiah production front door preparation

On 2026-10-07 CT, the production frontend model gained a staged
`zooberiahsystems.com` front door. Its default state creates only a generated
CloudFront distribution and leaves the pending ACM certificate, public aliases,
and Route53 traffic untouched.

A dedicated manual workflow now compiles only the Zooberiah projection, seals
an immutable CloudFormation change set, and separates review, execution,
cleanup, and rollback. The projection permits six Zooberiah-owned resources
plus the minimum shared SSR allowed-host modification; unrelated production
resources are retained from the live template and rejected by the reviewer if
they appear in the native inventory.

The requested release is bound to the live shared SSR release and immutable
server object before review. Alias promotion carries a separately hashed
generated-phase template, rejects drift in any of the six existing resources,
and admits exactly two modifications: the CloudFront distribution and its
viewer function.

The same protected source supports a later alias-only phase. That phase is
blocked until ACM is issued and the inactive Route53 zone still has its
HostGator apex A and `www` CNAME shape. Route53 cutover is intentionally a
separate atomic operation because `www` cannot retain a CNAME while CloudFront
A/AAAA aliases are created.

Validation covers the generated projection, alias projection, DNS exclusion,
certificate and record preflight, source binding, retained review drift, exact
execution boundary, and rollback projection.

## Retained certificate baseline correction

The first generated-phase review stopped before change-set creation because
the shared baseline reader applied the certificate creation workflow's
certificate-absent precondition after that retained certificate had already
been created. The Zooberiah operation now opts out of only that stale
precondition. It continues to snapshot the certificate and every other live
resource, seal the complete baseline, validate deployment roles and asset
storage, and reject an existing `admin.thehairnarrative.com` DNS record.
