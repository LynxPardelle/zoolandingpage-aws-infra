"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const manifest = require("../tools/production/thn-deployment-identities.json");

const STACK = "zoolanding-content-hub-prod";
const ACCOUNT = "765932874577";
const REGION = "us-east-1";
const RULES = [
  "ThnContentHubV2PrivateAssetCollectorFunctionCollectionSchedule",
  "ThnContentHubV2InvalidationWorkerFunctionInvalidationSchedule",
  "ThnContentHubV2PreparedOrphanCollectorFunctionCollectionSchedule",
];

test("Hub EventBridge grants cover CloudFormation's truncated generated rule names", () => {
  const hub = manifest.groups.find((group) => group.group === "hub");
  const policies = Object.values(manifest.template.Resources)
    .filter((resource) => resource.Type === "AWS::IAM::ManagedPolicy" &&
      /^ThnProductionHubNative/.test(resource.Properties.ManagedPolicyName));
  assert.equal(policies.length, 4);

  for (const logicalId of RULES) {
    const prefix = `${STACK.slice(0, 25)}-${logicalId.slice(0, 25)}-`;
    const arn = `arn:aws:events:${REGION}:${ACCOUNT}:rule/${prefix}*`;
    const requirement = hub.resourceRequirements.find((entry) => entry.logicalId === logicalId);
    assert.equal(requirement.nameOrApprovedGeneratedPrefix, `${prefix}*`);
    assert.ok(manifest.proofMatrix.some((entry) =>
      entry.group === "hub" && entry.logicalIds?.includes(logicalId) &&
      entry.actions.includes("events:DescribeRule") && entry.resources.includes(arn)));
    assert.ok(policies.some((policy) => policy.Properties.PolicyDocument.Statement.some((entry) =>
      (Array.isArray(entry.Action) ? entry.Action : [entry.Action]).includes("events:DescribeRule") &&
      (Array.isArray(entry.Resource) ? entry.Resource : [entry.Resource]).includes(arn))));
  }

  const observedProductionRule =
    "zoolanding-content-hub-pr-ThnContentHubV2PreparedOr-3oPnJWQJPmCK";
  const prepared = RULES[2];
  const approvedPrefix = `${STACK.slice(0, 25)}-${prepared.slice(0, 25)}-`;
  assert.ok(observedProductionRule.startsWith(approvedPrefix));
  assert.equal(observedProductionRule.length, 64);
});
