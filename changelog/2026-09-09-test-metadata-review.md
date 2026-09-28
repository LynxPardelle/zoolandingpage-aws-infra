# TEST native CDK metadata review correction

September 9, 2026, Central Time.

The TEST reviewer previously treated CloudFormation's conditional CDK Analytics
classification as an application replacement and expected property-only
contexts instead of the native Properties/Metadata envelope. The resulting
review stopped before change-set execution.

The corrected reviewer validates full native before/after contexts and static
change details. Only the exact Analytics field on CDKMetadata and a Lambda
asset-path metadata field with unchanged runtime properties qualify as CDK
bookkeeping. Conditional replacement remains forbidden for other resources.
An ordinary metadata-only set is a non-executing no-op; real application changes
are still reviewed and admin changes still require both explicit approvals.

Regression tests cover native envelopes, no-op decisions, mixed real changes,
context/detail mismatches, hidden property changes, production, deletion,
replacement, and missing admin evidence. Fixtures contain synthetic values, not
private AWS captures. No deployment/IAM policy, artifact seal, production
workflow, dependency, or draft content is modified by this correction.
