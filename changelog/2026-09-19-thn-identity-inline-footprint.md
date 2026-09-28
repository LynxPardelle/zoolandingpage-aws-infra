# 2026-09-19 — Live THN IAM inline-policy footprint

The first guarded THN IAM update reached CloudFormation but rolled back. Its
redacted stack-event inspection identified a limit failure on the proposed
GitHub-role policy. Local synthesis measured the proposed policy at 1,572
non-whitespace characters, which is not enough to establish the live role's
remaining quota.

The read-only `inspect` operation now reports the count and aggregate size of
the exact TEST API GitHub role's existing inline policies. It never prints
policy names or bodies, and it does not change permissions or retry the update.
