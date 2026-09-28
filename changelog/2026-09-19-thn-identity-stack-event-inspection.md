# 2026-09-19 — Bounded THN identity failure inspection

The dedicated THN TEST IAM workflow gains a manual, read-only `inspect`
operation for a failed `apply`. It binds the inspection to one prior run's
CloudFormation client request token and reports only the stack status and
allowlisted failure classifications. Raw event messages and AWS resource
details are not logged. The operation returns before asset publication or
change-set execution and does not expand IAM permissions.

The operation was added after the first guarded IAM update passed change-set
review but failed at `stack_wait`. No repeat update is authorized by this
diagnostic change.
