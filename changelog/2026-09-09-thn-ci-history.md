# THN candidate validation history

2026-09-09, Central Time.

The CDK and offline identity PR checks now fetch complete Git history before
running the test suite. Exact committed Gitleaks fingerprints must resolve to
their reviewed source blobs; a shallow checkout cannot satisfy that check.

A regression covers the checkout of both PR checks and the four existing TEST
validation/preparation workflows. The two affected workflows failed this
regression before the correction. A separate unchanged depth-one clone also
reproduced the historical-blob failure and passed after its history was fetched.

No fingerprint exception, test skip, offline isolation, action pin, IAM policy,
runtime payload or deployment guard was changed. This source correction is not
an AWS deployment. Future production promotion must independently reconcile
its deployment job's shallow checkout; that workflow is not modified here.
