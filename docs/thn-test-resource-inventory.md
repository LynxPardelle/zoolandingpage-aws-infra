# THN TEST bounded resource inventory check

`tools/thn-resource-inventory.js` is an offline, read-only comparator. It does not
collect AWS data, assume roles, create resources, schedule cleanup, delete data,
change retention, or disable protection. QA itself must add zero infrastructure.

## Usage and trust boundary

Supply three canonical UTF-8 JSON files and their independently recorded SHA-256
digests: reviewed baseline, approved expected inventory, and observed inventory.
The baseline for `qa` is captured **after** the approved deployment and before QA.

```bash
node tools/thn-resource-inventory.js qa \
  baseline.json "$APPROVED_BASELINE_SHA256" \
  expected.json "$APPROVED_EXPECTED_SHA256" \
  observed.json "$RECORDED_OBSERVED_SHA256"
```

Replace `qa` with `final` for release closeout. Do not compute the approval digest
from the proposed input within this command: that would authenticate nothing
beyond the same file. Record source/capture provenance and approvals separately.
The observed digest authenticates transport, not human approval or capture truth.

Each file is at most 2 MiB, uses `JSON.stringify(value, null, 2) + "\n"`, and has
exactly these fields. Unknown fields, duplicate JSON keys, wildcard identifiers,
unhashed physical identifiers, incomplete snapshots, or missing files fail.

| Object | Closed fields and values |
| --- | --- |
| Root | `schemaVersion: 1`, `environment: "test"`, `domain: "thehairnarrative.com"`, `stacks` |
| Stack | `stackIdSha256`, canonical repository `owner`, `complete: true`, boolean `terminationProtection`, `resources` |
| Resource | `logicalId`, `physicalIdSha256`, `resourceType`, `configurationSha256`, `classification`, `purpose`, `retention`, `releaseArtifactSha256`, `tracking` |

Hashes are 64 lowercase hexadecimal characters. Stack arrays contain 1–16 unique
entries sorted by stack hash. Each stack's resource array is sorted ordinally by
unique logical ID, with at most 10,000 entries and no duplicate type/physical-ID
pair. Baseline and expected stacks may not have empty resource lists: absence or
failed capture cannot certify a clean stack. The exact stack set and ownership
must match in all three files. Supported owners are the seven repositories in
the THN release boundary, explicitly listed in the comparator.

Compute physical/stack identity hashes from the exact values **in memory** during
the separately authorized capture. Never retain or print their raw values. The
configuration hash must cover the normalized effective resource configuration
and its protection settings, using the same reviewed capture procedure for all
three files; do not hash only a name, resource count, or volatile timestamp.
Capture provenance must establish all-page completeness and identity. This CLI
does not fabricate missing capture evidence or prove that a reused file is fresh.

## Classification and comparison

| Classification | Purpose | Retention | Meaning |
| --- | --- | --- | --- |
| `persistent-blog` | `blog-runtime` | `managed` or `retain` | Required serving/auth/content infrastructure |
| `deployment-dependency` | `deployment-control` | `managed` or `retain` | Required release/identity/TLS controls |
| `deployment-dependency` | `release-active` | `retain` | An exact currently active `AWS::Lambda::Version` tied to its approved release artifact |
| `deployment-dependency` | `release-rollback` | `retain` | An exact `AWS::Lambda::Version` tied to an approved immutable rollback artifact |
| `protected-retained-data` | `protected-data` | `retain` | Protected application/audit data and its retained storage |
| `transient` | `transient-operation` or `qa-only` | `transient` | Temporary resources; final presence is forbidden |

Active and rollback versions carry a mandatory exact `releaseArtifactSha256`;
other resources carry null. Do not mislabel the active version as rollback.
A retained code version with explicit release provenance is not a duplicate
runtime service. Unknown versions or wildcard version ranges are never accepted.
This rule does not authorize indefinite retention of unreviewed versions or
relabeling a duplicate function as a required dependency. Only `final` permits an
explicitly reviewed `release-active`/`release-rollback` transition for the same
Lambda version, retaining its exact physical identity, type, tracking, artifact
hash, class and retention. Other purpose/provenance reclassification is rejected.
Capture the QA baseline after planned activation/deployment/rollback has settled
these roles; zero delta covers the QA account trial, not those release operations.

`tracking` is exactly `cloudformation`, `retained-detached` (Lambda versions only),
or `certificate-dns` (retained certificate-validation `AWS::Route53::RecordSet`
dependencies only). The latter two are explicitly attributed supplemental rows,
not claims that CloudFormation still tracks them. Include every exact reviewed
detached version and persistent validation CNAME in expected and observed input;
their absence or relabeling fails. An approved synthetic logical identifier may
identify a supplemental row; ownership must come from release/certificate evidence,
never a naming prefix.

Baseline non-transient resources cannot disappear from the expected inventory.
Ownership, classification, retention, type and release provenance cannot be
rewritten; purpose has only the exact final-version transition above, and retained
physical identities must remain. Termination
protection cannot be disabled. Configuration changes or permanent additions need
exact prior approval and exact observed agreement.

- `qa`: baseline, expected and observed infrastructure must be exactly equal,
  including configuration hashes and protections. Even a larger supplied expected
  inventory cannot authorize a QA-created service. QA-only services are rejected.
- `final`: observed must equal the approved expected inventory, with no unknown,
  missing, QA-only or transient resources. An explicitly classified baseline
  transient may be absent from the approved final inventory, but the comparison
  neither removes it nor grants permission to remove it.

Successful output contains only verdict, phase, counts, classification totals,
input hashes and `coverage: "declared-stack-inventories-only"`. Failures exit 1
with a fixed sanitized reason, never input paths/content. Success is **not** an
account-wide no-orphan claim. `ListStackResources` alone is insufficient: capture
exact versions from each already approved function (including retained versions
detached from the stack), reconcile their release records, and read each exact
ACM-reported validation CNAME from its verified existing zone. Include those rows
with their declared stack's reviewed ownership. `complete: true` asserts this
supplemental reconciliation as well as all-page CFN completeness. Use only the
separately approved read-only capture, no account scan or new collector. Resources
outside this declared scope and unresolved ownership remain explicit blockers;
nothing is silently included or swept.

## Cost and operational closeout

No new AWS service is needed to run this comparator or QA. Required blog runtime,
deployment controls and protected retained data remain in service after tests.
Their ongoing storage, requests, backups, logging, transfer and retention can
still incur charges. This check neither estimates a bill nor establishes zero
cost. Keep only exact reviewed rollback versions; review any transient left over
with its owner before a separate authorized removal. Never clean up protected
data, roles or services based on a prefix/name, and never add a cleanup scheduler.

The existing [release contract](thn-admin-test-release.md) remains authoritative
for immutable deployment, ACM validation and shared SSR/public-route guards.
The separate [retained prerequisite workflow](thn-test-prerequisites.md) is local
preparation, not live execution. This comparator does not activate it or certify
capture completeness merely because an input claims `complete: true`.
