# THN TEST dedicated identity postmortem

The reviewed three-resource identity source was promoted to TEST without a
general frontend deploy. The manual read-only `verify` passed. The first
guarded `apply` failed after AWS credentials were obtained, but the runner's
generic error message did not identify the failing AWS boundary. The failed
run was not retried.

Added a read-only `diagnose` operation scoped to one prior failed run and safe
stage/error-code reporting for a later `apply`. The diagnostic checks the exact
candidate object and change set without modifying either. It must be promoted
through the same exact TEST source gate before use. No IAM resource is claimed
deployed by this change.
