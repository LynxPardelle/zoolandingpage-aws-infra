# THN TEST runtime role policy correction

The dedicated runtime create run on 2026-09-22 rolled back because its CloudFormation execution role could not attach `AWSXrayWriteOnlyAccess` to the generated Lambda role. The processed SAM template attaches that policy and `AWSLambdaBasicExecutionRole`; the previous execution policy allowed only the latter. CloudFormation completed rollback, leaving no application resources in that stack.

The TEST-only execution policy now permits attaching and detaching exactly those two AWS managed policies on the dedicated runtime role prefix. The GitHub deployment role, shared API stack, Auth Admin, other drafts, and production policy are unchanged. The dedicated runtime must be created and verified separately before switching the protected admin route or enabling article writing.
