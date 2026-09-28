# Production front door test isolation

The source-only MAIN workflow runs its guard with the production environment's
custom-domain toggle enabled. The Eros Barajas test previously assumed that the
toggle was disabled and therefore expected an audit host hint even after custom
aliases were active. Run 36477819674 failed at that assertion without acquiring
AWS credentials or executing infrastructure changes.

The fixture now imports deployment configuration in a fresh Node process for
each explicit toggle value. Both cases retain checks for the public hostname,
certificate, alias record group and Route53 cutover, and verify the corresponding
custom-domain and audit-hint behavior. The production configuration, workflows,
release guards and activation manifests are unchanged.

Validation uses Node 22.23.2: reproduce the original assertion failure with
`FRONTEND_PRODUCTION_CUSTOM_DOMAIN_NAMES_ENABLED=true`, then run `npm test` both
with default flags and with all four variables from the failed production job.
`npm run validate` also runs with those production flags. The identities release
source fingerprint excludes test and changelog files; its candidate is unchanged.
