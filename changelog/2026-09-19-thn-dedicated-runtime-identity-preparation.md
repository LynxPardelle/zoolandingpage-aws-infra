# 2026-09-19 — THN dedicated runtime identity preparation

Prepared a retained TEST-only CloudFormation execution role and two separate
policies for the proposed standalone THN auth-runtime stack. The existing API
GitHub caller gains only new-stack CloudFormation operations, PassRole for the
new execution role, and read-back of a versioned package under the THN prefix.
The new execution role is scoped to the THN Lambda, IAM role, log group,
artifact prefix, and API Gateway REST resource family. Because a new REST API
ID is unknown before stack creation, the API Gateway family cannot be pinned
to a physical ID at this stage; the exact reviewed native change-set inventory
is the additional release boundary.

The focused identity tests and complete local Node test suite passed. The
existing TEST synthesized baseline hash still matches after removing only
the three proposed resources, and the production synthesis remains identical.
No AWS resource, GitHub setting, or CloudFront route was changed.
