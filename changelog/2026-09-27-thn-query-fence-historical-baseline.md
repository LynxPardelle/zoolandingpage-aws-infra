# THN query fence historical baseline correction

The TEST manual [review run #36339125033](https://github.com/LynxPardelle/zoolandingpage-aws-infra/actions/runs/36339125033) stopped during read-only preflight with `query_fence_diff_invalid` and `diff_reason=old_query_shape`. It did not create or execute a change set.

The proof and its fixture had modeled a single-line `if (queryKey !== "lang" ...)` baseline. The actual pre-patch source in commit `9683a3a` instead collects query keys, accepts no query or exactly one `lang`, and checks its single value. The current candidate replaces that whole `queryAllowed` body and adds `allowArticleLocaleQuery` only to four Journal page rules.

The corrected proof now matches both complete function bodies and reconstructs the historical code and rule set byte for byte before comparing every other live template property. The test fixture uses the historical body and rejects changes to its one-key rule. The CloudFormation change-set allowlist and review-only behavior remain unchanged. Live AWS preflight and change-set review still have to pass before execution.
