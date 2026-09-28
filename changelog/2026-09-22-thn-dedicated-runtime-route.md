# THN TEST private runtime route preparation

The private `admin-test.thehairnarrative.com` runtime-config behavior is prepared
to use the dedicated THN TEST API origin instead of the shared API Proxy. The
public API Proxy route and its origin remain unchanged. The new origin is bound
to the exact reviewed API Gateway hostname, `/Prod` path, and owner seal; no
production origin is added.

Before this source change is deployed, the private front door returns 403 for
`POST /auth-v2/runtime-config` from the old origin. The dedicated API returns
200 for the application's exact POST JSON contract with the private Origin and
forwarded host. A GET without the required parameters returns 400; a query
string on the private front door is intentionally rejected by its viewer fence.
Neither response is a substitute for the POST integration check.

The source change has not been promoted or deployed by this record. Local
verification covers the private distribution behavior, the unchanged public
behavior, and the frontend test suite. The deployment still requires the
reviewed TEST promotion, explicit front-door approvals, change-set review,
and post-deploy browser and access-control checks.
