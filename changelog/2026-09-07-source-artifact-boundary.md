# 2026-09-07 CT - Source artifact boundary

- Excluded named `cdk.out-*` proof assemblies from Git, in addition to the standard `cdk.out/` directory. This prevents generated TEST/production templates from accidentally entering a source commit.
- Added a real Git ignore regression for the default output and the named origin-proof output. No assembly was deleted and no infrastructure configuration or cloud resource changed.
- Kept local verification logs ignored as required by the workspace policy.
- This is local build hygiene only, not deployment or activation of the Journal.
