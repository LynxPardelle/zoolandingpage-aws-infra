# THN production API identity review: exact IAM operation scope

The protected production identity review run `36929898850` stopped at `production_operation_out_of_scope` before S3 publishing or CloudFormation change-set creation. The API role patch simulated three IAM resource/action groups through `apiRuntimeRolePermissionProof`, but the shared production operation fence had not admitted those exact simulations.

The fence now admits only the 18 actions across the dedicated runtime role, `ThnProductionApiNative0` policy, and dedicated GitHub deploy role when requested by the exact CloudFormation execution principal. Other resources, roles, or actions remain rejected. The API role review test now passes its entire simulated review path through the shared fence and checks negative resource, principal, and action cases.

The new test reproduced the same `production_operation_out_of_scope` failure before the fix. Afterwards, the targeted test and the full Infra suite passed (474 passed, 1 skipped). AWS CLI separately confirmed the 18 existing permissions, unchanged identity template policy hashes, stable stack, absent API role/function, and no pending change set. No AWS deployment occurred.
