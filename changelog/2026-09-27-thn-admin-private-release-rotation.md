# THN admin private TEST release rotation

The inline image preview correction is published as APP run `36342080059`,
artifact `10939780047`, source `4f45ffc615d3864a167fdccd87535e244ef01971`.
Publishing did not activate the new browser bundle or private SSR Lambda.

Added a manual TEST workflow with separate `review`, `execute`, and `verify`
modes. It pins the APP artifact coordinates, seals the CDK assembly, verifies
the published S3 completion marker, and projects a temporary template that
keeps the deployed historical Journal query policy. The full-template proof
permits only the private SSR Lambda release, admin viewer static rules, and
admin distribution static paths. The change-set reviewer requires exact
non-replacing updates and narrowly proven alias/SSM dependents. Review deletes
its unexecuted change set and emits a digest for a separately approved execute
run. Runtime checks cover Lambda code, CloudFront, DNS, certificate, public
release, and unrelated resource identities.

Offline tests and a local TEST synthesis using the selected APP manifest pass.
The selected assembly has 63 resources, an 8,912-byte viewer Function, and 45
ordered behaviors. A second synthesis with the prior APP release, restored to
the historical query handler, passes the full-template projection into the
new release. These local syntheses use fixture certificate and hosted-zone
values; they are not live AWS evidence. No CloudFormation change has been
executed by this patch.
