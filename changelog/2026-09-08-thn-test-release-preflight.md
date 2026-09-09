# THN TEST release preflight — 2026-09-08 (Central Time)

- Bound the credential-free TEST validation job to its Environment variables.
- Accepted the real AWS `DescribeChangeSet` response shape, which omits
  `ChangeSetType`, while preserving the pinned UPDATE request and explicit
  conflicting-type rejection.
- Added independently hashed APP manifest selection, exact THN asset origin
  projection, and immutable transport to deploy/rollback.
- Added pre-mutation checks of the final assembly quotas, issued exact-host ACM
  certificate, and private S3 completion/delivery/source metadata.
- Repaired direct AWS CLI operations to use the existing, sealed CDK bootstrap
  lookup/deploy chain with isolated ephemeral credentials and repeated artifact
  and change-set verification. No IAM grants or role trust changed.
- Kept approval defaults off, public release drift guards, shared SSR topology,
  IAM policies, and non-THN/public routing unchanged.
- Added a bounded offline inventory comparator with externally recorded hashes,
  exact stack/owner coverage, zero QA infrastructure delta, explicit rollback
  version provenance and fail-closed final transient/unknown/missing checks. It
  has no cloud collector, resource creation, cleanup or protection mutation.
- Added the separately reviewed local TEST prerequisite workflow: exact live
  template composition plus one retained certificate or permissionless human role,
  NoEcho transport, existing encrypted CDK bucket/role chain, enable-only protection,
  native DNS validation and exact before/after DNS review. No live invocation.
- Preserved both prerequisite logical resources in future TEST synthesis. Normal
  deploy/rollback now attests existing certificate ownership and rejects every
  certificate resource change. The prerequisite reviewer uses native response
  fields and rejects existing-parameter drift; the human mask is not treated as
  proof of its hidden value.

This records local implementation and offline verification only. No certificate,
DNS record, variable, IAM role, frontend release, or CloudFormation deployment
was changed. See [the contract](../docs/thn-admin-test-release.md) for remaining
live authority, artifact, certificate, and activation gates.
