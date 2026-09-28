# THN TEST pending IAM change-set review

The first read-only postmortem confirmed that the failed dedicated identity
`apply` uploaded its immutable candidate and created a CloudFormation change
set in `CREATE_COMPLETE`. It did not establish which release-guard comparison
rejected that change set, and no second `apply` was started.

The same diagnostic now reads the pending Original and Processed templates and
reports only fixed comparison flags for the expected three Adds, stack context,
parameters and templates. It does not print those templates or parameter
values and does not modify the pending change set or IAM resources.
