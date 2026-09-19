# Isolated Auth TEST activation permissions

Date: 2026-09-19 (Central Time)

Adds a separate `auth-enable` selector to the existing sealed permission revision
workflow. The new customer-managed policy avoids exhausting the existing Auth
role's inline aggregate, without replacing either inline policy or changing trust.
The exact source, policy, role, owner stack and private bindings remain hash-bound.

The service baseline is protected, provisioned and disabled. Verification covers
the one-resource change set, exact managed-policy readback and sole role attachment.
Other selectors retain their original inline-only behavior and guardrails.
Production synthesis retains its captured baseline. Tests exercise orchestration,
negative scope cases and isolation. This source change does not assert deployment
or client readiness; dedicated verify/execute and service release gates remain.
