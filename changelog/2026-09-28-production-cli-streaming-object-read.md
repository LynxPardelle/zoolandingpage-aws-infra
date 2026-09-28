# Production CLI streaming object read

Protected review 36480134379 uploaded the exact deployment-identities template
but stopped during its sealed S3 readback. The actual CLI returns exit status 252:
GetObject is a custom streaming command and does not accept `--cli-input-json`.
Replaying the unmodified adapter with the real file-publishing role reproduced
the failure. Moving the outfile did not fix it; supplying bucket/key while
retaining CLI JSON explicitly returned `Unknown options: --cli-input-json`.

The shared production adapter now sends GetObject's bucket, key, immutable
version and expected owner through ordinary CLI flags, preserves the absolute
outfile and rejects unknown fields. All other API operations keep their JSON
request transport. The actual scoped role then read back the existing exact
version successfully; its SHA-256 matched the uploaded candidate. No permission
change was needed, and the failed review did not create or execute CloudFormation.

Production operators also preserve safe error names containing digits such as
`s3api`, CLI exit status and structured AWS error codes. They do not log raw CLI
stderr, credentials or response bodies. The closed inventory/digest guards and
separate approval requirement for infrastructure execution remain intact.

Transport contract tests cover immutable version/owner handling, leading-dash
version IDs, rejected unknown inputs and the ordinary JSON API path. Full local
validation and an actual CLI rehearsal precede another protected review.
