#!/usr/bin/env bash
set -euo pipefail

: "${STACK_PATH:?STACK_PATH is required}"
: "${STACK_NAME:?STACK_NAME is required}"
: "${CHANGE_SET_NAME:?CHANGE_SET_NAME is required}"
: "${ADMIN_INFRASTRUCTURE_APPROVED:?ADMIN_INFRASTRUCTURE_APPROVED is required}"
: "${ADMIN_ROUTE_ASSOCIATION_APPROVED:?ADMIN_ROUTE_ASSOCIATION_APPROVED is required}"
: "${THN_ADMIN_ORIGIN_ENABLED:?THN_ADMIN_ORIGIN_ENABLED is required}"
: "${RELEASE_ROOT:?RELEASE_ROOT is required}"

EXPECTED_STACK="ZoolandingTest-Zoolandingpage-test-Frontend"
EXPECTED_STACK_PATH="ZoolandingTest/Zoolandingpage-test-Frontend"
EXPECTED_HOST="admin-test.thehairnarrative.com"
EXPECTED_AWS_ACCOUNT_ID="765932874577"
EXPECTED_AWS_REGION="us-east-1"

test "$STACK_NAME" = "$EXPECTED_STACK"
test "$STACK_PATH" = "$EXPECTED_STACK_PATH"
[[ "$CHANGE_SET_NAME" =~ ^(release|rollback)-[1-9][0-9]*-[1-9][0-9]*$ ]]
[[ "$ADMIN_INFRASTRUCTURE_APPROVED" =~ ^(true|false)$ ]]
[[ "$ADMIN_ROUTE_ASSOCIATION_APPROVED" =~ ^(true|false)$ ]]
[[ "$THN_ADMIN_ORIGIN_ENABLED" =~ ^(true|false)$ ]]
test "$ADMIN_INFRASTRUCTURE_APPROVED" = "$ADMIN_ROUTE_ASSOCIATION_APPROVED" || {
  echo "admin_approval_pair_invalid" >&2
  exit 1
}
test -d "$RELEASE_ROOT/cdk.out"
test -f "$RELEASE_ROOT/release-tools/review-test-infra-change-set.js"

cdk_parameters=()
if [ "$THN_ADMIN_ORIGIN_ENABLED" = "true" ]; then
  [[ "${THN_AUTH_ADMIN_ORIGIN_VERIFY_SECRET:-}" =~ ^[A-Za-z0-9_-]{43}$ ]] || {
    echo "thn_origin_proof_invalid" >&2
    exit 1
  }
  cdk_parameters+=(
    --parameters
    "ThnAdminAuthAdminOriginVerifySecret=$THN_AUTH_ADMIN_ORIGIN_VERIFY_SECRET"
  )
fi

set +e
npx --no-install cdk deploy "$STACK_PATH" \
  --app "$RELEASE_ROOT/cdk.out" \
  --method prepare-change-set \
  --change-set-name "$CHANGE_SET_NAME" \
  --require-approval never \
  --exclusively \
  "${cdk_parameters[@]}"
prepare_exit=$?
set -e

description="$RUNNER_TEMP/$CHANGE_SET_NAME.json"
if ! aws cloudformation describe-change-set \
  --stack-name "$STACK_NAME" \
  --change-set-name "$CHANGE_SET_NAME" \
  --include-property-values \
  --output json > "$description"; then
  if [ "$prepare_exit" -eq 0 ]; then
    exit 1
  fi
  exit "$prepare_exit"
fi

change_set_arn="$(node -e '
  const fs = require("node:fs");
  const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8")).ChangeSetId;
  if (typeof value !== "string" || value.length === 0) process.exit(1);
  process.stdout.write(value);
' "$description")"

decision="$(node "$RELEASE_ROOT/release-tools/review-test-infra-change-set.js" \
  "$description" \
  --expected-stack-name "$STACK_NAME" \
  --expected-change-set-name "$CHANGE_SET_NAME" \
  --expected-change-set-arn "$change_set_arn" \
  --expected-change-set-type UPDATE \
  --expected-account-id "$EXPECTED_AWS_ACCOUNT_ID" \
  --expected-region "$EXPECTED_AWS_REGION" \
  --expected-host "$EXPECTED_HOST" \
  --admin-infrastructure-approved "$ADMIN_INFRASTRUCTURE_APPROVED" \
  --admin-route-association-approved "$ADMIN_ROUTE_ASSOCIATION_APPROVED")"

if [ "$decision" = "noop" ]; then
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    printf 'executed=false\n' >> "$GITHUB_OUTPUT"
  fi
  exit 0
fi
test "$decision" = "execute"
test "$prepare_exit" -eq 0 || {
  echo "change_set_prepare_failed" >&2
  exit "$prepare_exit"
}

aws cloudformation execute-change-set \
  --stack-name "$STACK_NAME" \
  --change-set-name "$change_set_arn"
aws cloudformation wait stack-update-complete --stack-name "$STACK_NAME"
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  printf 'executed=true\n' >> "$GITHUB_OUTPUT"
fi
