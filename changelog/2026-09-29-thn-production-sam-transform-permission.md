# Production SAM transform permission

The Auth state review stopped at native change-set creation. AWS reported that
`zoolanding-deployer-auth-admin-production-cfn-exec` lacked
`cloudformation:CreateChangeSet` on the AWS-owned
`arn:aws:cloudformation:us-east-1:aws:transform/Serverless-2016-10-31` transform.
The GitHub caller and native resource handler simulations had passed; they did
not cover this separate CloudFormation execution-role authorization.

The production deployment identity manifest now declares one retained inline
policy attached to the five existing SAM execution roles. It grants only that
action on that exact transform, restricted to `us-east-1`. Five corresponding
execution-role requests are included in the proof matrix. The existing
bootstrap reviewer can review this as one addition while preserving all current
resources; it still rejects modifying or removing existing identities.

Regression tests require the bounded grant and simulation coverage for each
execution role, and exercise the existing native inventory guard. The tests
failed against the previous manifest and passed after the correction.

This source change does not apply IAM, activate service routes, enroll users or
publish content. Existing production permission-plan secrets must also include
the transform simulation before another service review. Exact native review
inventory and digest remain required before executing the IAM addition.

AWS reference: [CloudFormation IAM access controls](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/control-access-with-iam.html).
