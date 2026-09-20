# 2026-09-19 — Proposed THN IAM managed-policy import repair

The first guarded IAM update rolled back because the existing TEST API GitHub
role had 9,239 inline-policy characters; the proposed 1,572-character policy
would exceed the 10,240-character role quota. The rollback retained the exact
new execution role, while the GitHub role still had no managed attachments.

The candidate now uses a dedicated managed policy with the same statements,
attached only to the TEST API GitHub role. The release guard requires the
retained role to match its intended trust and description and to have no
policies. It also requires the original failed-run creation event. The only
accepted change set imports that role and adds the managed policy and its
execution inline policy; any different delta is rejected before execution.

No AWS repair was executed by this code change. Existing drafts and production
are outside the resource names and release guard.
