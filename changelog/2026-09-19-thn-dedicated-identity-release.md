# THN TEST dedicated identity release preparation

Prepared a separate manual workflow for the proposed dedicated THN runtime
identity in the existing TEST ServiceRepositoryBootstrap stack. This change is
source preparation only; it is not evidence that the IAM resources were created
or that the blog is active.

The workflow pins the reviewed TEST promotion source and the SHA-256 of the
three synthesized IAM resources. Its runner reads the live stack and effective
API GitHub role trust, preserves the existing template and parameters, and
rejects any CloudFormation change set other than exactly one retained role and
two nonreplacing policy Adds. It verifies the final stack and IAM policy names.
Production and the ordinary Frontend delivery workflow are unchanged.

Local verification: focused Python and Node tests, real TEST CDK candidate
composition against a reconstructed baseline, and the infrastructure Node
suite (313 passed, one pre-existing skip). No AWS or GitHub Actions deployment
was run during this preparation.
