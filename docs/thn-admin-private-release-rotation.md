# Private TEST editor rotation

The manual `THN Admin TEST Private Release Rotation` workflow stages and reviews
one private editor artifact on the protected infrastructure `test` branch.
Publication in the APP repository does not activate it.

## Current selection

The reviewed selection is APP artifact `10946585127`, source
`9850f5f3d5b435d90387cf6a2f73323a249452d1`, run `36362456029`, attempt `1`.
The exact coordinates and digests are pinned in
[`tools/thn-admin-private-release-rotation.js`](../tools/thn-admin-private-release-rotation.js).
The public-safe selection fixture is in
[`test/fixtures/thn-private-reviewed-app.json`](../test/fixtures/thn-private-reviewed-app.json).
A different artifact or source run requires a reviewed pin update.

## Scope and guards

- Only the existing private SSR code and release ID, static viewer rules and
  static distribution selection may change.
- Query Fence may be historical or already deployed. The projection preserves
  the live nonstatic rules and handler. If the query-only template is not fully
  unchanged, the existing strict historical query proof must pass.
- The postcheck accepts an exact unchanged query/template policy or the same
  proven historical delta; any other difference fails. The standalone Query
  Fence operation still requires its original exact diff.
- DNS, certificate, resource identities, public release, backend behavior and
  unrelated resources retain their existing proofs.

## Procedure

1. Validate the complete APP artifact, successful source run and published S3
   hashes. Compare fresh AWS CLI responses with the candidate locally.
2. Match the workflow runtime when synthesizing. The verified baseline used
   Node `22.23.2`; Windows synthesis emits a backslash in asset-path metadata
   whereas Linux uses a slash. Normalize that separator only in a local parity
   replay after verifying the same asset hash; do not widen production proofs.
3. Promote reviewed infrastructure code with the exact source-only selector,
   and verify automatic deployment is skipped.
4. Run `execution=review` with the exact protected source and pinned APP
   coordinates. Inspect the inventory and digest; review deletes its preview
   without execution.
5. Obtain separate approval for that inventory digest before `execute`.
6. Verify preserved identities and configurations, valid/invalid Journal
   queries, immediate image display, reload persistence and text persistence.
   Do not publish QA articles.

The earlier artifact remains available for a separately reviewed recovery. This
pin update does not select a public release, change credentials or activate AWS.
