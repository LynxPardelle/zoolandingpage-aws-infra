#!/usr/bin/env bash
set -euo pipefail

: "${STACK_NAME:?STACK_NAME is required}"
: "${ADMIN_INFRASTRUCTURE_APPROVED:?ADMIN_INFRASTRUCTURE_APPROVED is required}"
: "${THN_ADMIN_ORIGIN_ENABLED:?THN_ADMIN_ORIGIN_ENABLED is required}"

test "$STACK_NAME" = "ZoolandingTest-Zoolandingpage-test-Frontend"
[[ "$ADMIN_INFRASTRUCTURE_APPROVED" =~ ^(true|false)$ ]]
[[ "$THN_ADMIN_ORIGIN_ENABLED" =~ ^(true|false)$ ]]

stack_status="$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query 'Stacks[0].StackStatus' \
  --output text)"
case "$stack_status" in
  CREATE_COMPLETE|UPDATE_COMPLETE)
    ;;
  *)
    echo "test_stack_not_ready" >&2
    exit 1
    ;;
esac

if [ "$ADMIN_INFRASTRUCTURE_APPROVED" = "true" ]; then
  test "$THN_ADMIN_ORIGIN_ENABLED" = "true"
  distribution_id="$(aws cloudformation list-stack-resources \
    --stack-name "$STACK_NAME" \
    --query "StackResourceSummaries[?ResourceType=='AWS::CloudFront::Distribution' && contains(LogicalResourceId, 'ThehairnarrativeAdminTest')].PhysicalResourceId | [0]" \
    --output text)"
  test -n "$distribution_id"
  test "$distribution_id" != "None"
  aws cloudfront wait distribution-deployed --id "$distribution_id"
  aliases="$(aws cloudfront get-distribution-config \
    --id "$distribution_id" \
    --query 'DistributionConfig.Aliases.Items' \
    --output text)"
  test "$aliases" = "admin-test.thehairnarrative.com"
fi
