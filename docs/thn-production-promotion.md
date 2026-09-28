# THN production promotion: source integration boundary

Source promotion and production activation are separate operations. The private
production profile remains closed until its actual backend owners, artifact and
reviewed native inventory are available.

## Exact source-only selector

`INFRA_PRODUCTION_PROMOTION_SELECTION_JSON` is a closed flat JSON object:

```json
{"schemaVersion":1,"mode":"thn-source-only","sourceSha":"<40 lowercase hex>","sourceTree":"<40 lowercase hex>","targetBaseSha":"<40 lowercase hex>","mergeTree":"<40 lowercase hex>"}
```

The main push must be an unforced two-parent merge, first parent exactly its
push `before` and selected main base, second parent exactly current TEST, source
and source tree selected explicitly. `git merge-tree --write-tree` must produce
the selected native merged tree, including main-only changes, and HEAD must have
that tree. Missing, malformed, duplicate, extra or stale selectors fail closed.

`Deploy Production` now validates and synthesizes without OIDC credentials. It
cannot run the previous broad `ZoolandingProduction/*` deployment. Manual
activation requires the separately implemented protected inventory/review/digest
workflow; the current manual dispatch rejects execution. Other deliberate
production operator workflows keep their existing separate scopes.

The selector must be configured for the exact promotion before integrating into
main. Never remove a stale selector to bypass review.

## Closed production profile

Server-owned profiles are `test` and `production`, never an arbitrary browser
input or the SAM spelling `prod`. Production is account `765932874577`, region
`us-east-1`, branch `main`, host `admin.thehairnarrative.com`, public host
`thehairnarrative.com` and binding `thn-journal-production-v2`. TEST remains on its
existing host, namespace and strict release tools.

The private APP manifest selector supports separate production metadata and
`frontend/angular-ssr/production/releases/<releaseId>` coordinates. TEST tools
still default to TEST and reject production selections. Production cannot select
the active TEST artifact merely by relabeling metadata.

The native CDK distribution classifier recognizes both private hosts: an
unprotected production admin host cannot silently get ordinary public behavior.
The production front door remains closed until the dedicated service owners'
actual native API identities are provisioned, captured and reviewed. No TEST API
or shared legacy API is an assumed production THN identity.

## Preserved main-only public front door

The main-only public-production change `63fd2a4` is semantically already present
on the reviewed dev source. Resolving the four native textual merge conflicts
preserves its flags, exact apex host, certificate input, create-only A/AAAA
management, workflow forwarding and public-front-door regression tests, together
with all later TEST admin guards. Native merge ancestry still must be committed
and promoted deliberately after the cross-repository audits.

## Native review and execution operations

Four manual production workflows have separate approval records:

- `THN Production Deployment Identities Native Review` owns a separate stack with
  retained deployment roles/policies and a private versioned deployment package
  bucket. Native changes are add-only; existing role IDs, trusts, boundaries and
  unrelated policy hashes are preserved. New role permissions stay explicitly
  unproved until effective checks after the approved bootstrap.
- `THN Production Certificate Native Review` creates and retains an UPDATE change
  set containing exactly one retained certificate for the approved admin host.
- `THN Production Protection Native Review` reviews enabling termination
  protection on the exact frontend stack. It cannot disable protection.
- `THN Production Frontend Native Release` reviews a scoped private front door
  or the complete public frontend visual package. The latter updates the shared
  SSR package and static release prefixes while preserving distribution identities
  and aliases. It deliberately does not redeploy unrelated stacks.

Each credential job requires current main, exact source/package hashes and the
production Environment. It reads current main again immediately before a native
preview or execution. Execution uses the **same retained change-set ARN** and
approved digest; it never repackages or recreates that preview. Review records
expire after 24 hours. Cleanup validates ownership and full native inventory before
removing only the retained preview. A record from an older main source cannot be
executed with a newer source.

The digest seals the complete native inventory hash, Original/Processed template
hashes, parameters, deployed identities, permissions snapshot and versioned S3
coordinates. Artifact records contain a sanitized inventory projection; native
Lambda environments and origin credentials are never logged or uploaded publicly.
The origin credential is supplied only from the protected production Environment
and must hash to the active production authorizer's server-owned value.

Both versioned artifact packages and actual public browser bytes are read back.
The existing public-files bucket is unversioned: no VersionId is fabricated and
publication must use a new immutable release prefix. Recovery records retain the
previous private template plus exact versioned deployed Lambda packages, each
verified against the native CodeSha256 before sealing. Recovery requires its own
reviewed native operation and approval; no automatic broad rollback is attempted.

## Closed deployment identity proposal

The source manifest contains the exact new role names, native provider schema
hashes and action/resource/context matrix. Auth/Hub and the three Config principals
receive only source-required additional policies, preserving their existing policy
sets. CF service-role trust uses the same service principal as the live Runtime and
CDK roles; it does not invent undocumented SourceArn context. Callers restrict
PassRole to the exact execution role and CloudFormation service, and native scopes
remain closed to each owned stack.

The production owner-pool metadata policy starts `BLOCKED`. Once Auth provisions
its retained pool, a second native review derives the exact pool ARN from the
owned logical resource and adds only the conditioned metadata policies. No userpool
wildcard, TEST identity, human operator or writer access is granted by bootstrap.
Registry metadata reads are limited to the exact production service-binding key;
GitHub roles cannot read application records, invoke private handlers or retrieve
Secrets Manager data.

## Remaining activation prerequisites

- Integrate closed deployment identities in a separate bootstrap stack and verify
  its native IAM inventory/digest before any grants. Existing role trust and
  unrelated policies must be preserved; operator roles belong to their service.
- Prove actual effective permissions of the new identities after bootstrap,
  including production Environment main restrictions. Proposed policies and absent
  future roles are not a passing AWS readiness check.
- Provision retained backend state with routes/writer closed, then capture actual
  dedicated API identities and sealed production bindings.
- Publish a new production APP package from the protected manual main workflow.
  The active TEST package is not a production artifact.
- Obtain exact review/digest approval for certificate, protection and each frontend
  operation, preserve all current identities, then complete owner MFA and full
  visual/Journal acceptance. No TEST account/data or articles are published.

The eight healthy production stacks and absent THN v2/admin prerequisites are live
baseline evidence. Source integration may proceed after its three independent
local audits; activation remains blocked until these real prerequisites pass.
