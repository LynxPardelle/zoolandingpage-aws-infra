#!/usr/bin/env bash
set -euo pipefail

: "${STACK_NAME:?STACK_NAME is required}"
: "${ADMIN_INFRASTRUCTURE_APPROVED:?ADMIN_INFRASTRUCTURE_APPROVED is required}"
: "${THN_ADMIN_ORIGIN_ENABLED:?THN_ADMIN_ORIGIN_ENABLED is required}"
: "${RELEASE_ROOT:?RELEASE_ROOT is required}"

test "$STACK_NAME" = "ZoolandingTest-Zoolandingpage-test-Frontend"
[[ "$ADMIN_INFRASTRUCTURE_APPROVED" =~ ^(true|false)$ ]]
[[ "$THN_ADMIN_ORIGIN_ENABLED" =~ ^(true|false)$ ]]

node "$RELEASE_ROOT/release-tools/infra-test-aws.js" smoke "$RELEASE_ROOT"
