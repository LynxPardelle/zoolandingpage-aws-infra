# THN TEST permission execution polling

Date: 2026-09-09 (Central Time)

The supplemental-policy runner now waits within its existing bound when the
first post-execution read still says `AVAILABLE`. It never re-executes a change
set and never accepts that state as successful. Every response must retain the
exact stack/change-set identity; final templates, parameters, original roles
and three added policies are still verified independently.

Regression tests cover stale and permanently pending availability, failed and
unknown execution states, mismatched identity, and preserved final-state checks.
No permission, resource, dependency or workflow approval changes are included.

The preceding TEST update applied exactly three policies; independent readback
verified 28 resources with all 25 originals preserved. Its GitHub run remains
failed at the first post-execution check. CloudTrail confirms that query had no
API error but does not retain its response state, so a stale state is an
inference, not a captured native response. The completed update must not be
redispatched to turn that historical run green.

See [the execution-state contract](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_DescribeChangeSet.html)
and [the bounded permissions workflow](../docs/thn-test-permissions.md).
