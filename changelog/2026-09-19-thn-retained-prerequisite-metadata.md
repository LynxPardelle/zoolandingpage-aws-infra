# 2026-09-19 — Preserve retained THN prerequisite metadata

Local correction pending reviewed promotion. The live TEST Frontend template
contains the retained `ThnAdminTestCertificate` and two Config TEST policies
without generated CDK path metadata. A new synth with path metadata enabled
would otherwise add metadata to those unchanged resources, producing unrelated
change-set entries that the admin activation reviewer must reject.

The TEST constructs now omit only generated `aws:cdk:path` metadata on those
three retained resources. Their logical IDs, properties, policies, removal
rules, and all other resources remain unchanged. A path-metadata-enabled
template test protects this contract. No AWS resource was changed by this
correction; the separate TEST release and change-set review remain required.
