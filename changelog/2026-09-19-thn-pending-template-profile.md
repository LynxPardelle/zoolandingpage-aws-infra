# THN TEST pending template profile

The read-only postmortem confirmed that the failed IAM change set has exactly
the three reviewed, nonreplacing Adds and matching parameters. Its pending
Original and Processed templates both differ from the submitted candidate,
so the strict guard correctly did not execute it.

The diagnostic now reports only a bounded count and redacted structural paths
for those two differences. Resource, parameter, and output identifiers are
masked; template values are never logged. This is still read-only and does not
relax the release guard or execute the pending change set.
