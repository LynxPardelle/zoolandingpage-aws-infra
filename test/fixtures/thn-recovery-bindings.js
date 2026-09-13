"use strict";
// Synthetic data only. Importing fixtures must never register another test suite.
const { canonical, sha } = require("../../tools/thn-test-prerequisites");
const hash = value => sha(canonical(value));
const account = "123456789012";

function fixture(service = "config") {
  if (service === "config-runtime") {
    const value = fixture("config");
    value.binding.service = service;
    value.binding.functions = {ConfigAuthoringFunction: `arn:aws:lambda:us-east-1:${account}:function:zoolanding-config-authoring-test-synthetic`};
    value.config.service = service;
    value.config.anchors.config.functions = {ConfigAuthoringFunction: sha(value.binding.functions.ConfigAuthoringFunction)};
    value.config.expectedBindingSha256 = hash(value.binding);
    return value;
  }
  const name = `zoolanding-${service === "config" ? "config-authoring" : "api-proxy"}-test`;
  const binding = { schemaVersion: 1, service, environment: "test", account,
    stackId: `arn:aws:cloudformation:us-east-1:${account}:stack/${name}/synthetic`,
    package: { bucket: "synthetic-original-private", key: "original/code.zip", versionId: "original-version" },
    record: { bucket: "synthetic-channel", key: service === "config"
      ? `system/deploy-artifacts/${"1".repeat(40)}/123/1/aws-live-snapshot.json` : `${name}/snapshot.json`, versionId: "record-version" },
    functions: service === "api" ? Object.fromEntries(["ApiProxyFunction", "AuthProvisioningExecutorFunction", "AuthJwtAuthorizerFunction"]
      .map(n => [n, `arn:aws:lambda:us-east-1:${account}:function:${name}-${n.slice(0, 20)}-synthetic`])) : {} };
  const anchors = { account: sha(account), [service]: {
    selector: hash({ Bucket: binding.package.bucket, Key: binding.package.key }), version: sha(binding.package.versionId) } };
  if (service === "api") anchors.api.functions = Object.fromEntries(Object.entries(binding.functions).map(([n, arn]) => [n, sha(arn)]));
  return { binding, config: { account, anchors, service, channelBucket: binding.record.bucket,
    expectedBindingSha256: hash(binding), expectedStackSha256: sha(binding.stackId) } };
}

function original(service) {
  return { Parameters: { ExistingSecret: { Type: "String", NoEcho: true } }, Outputs: { Keep: { Value: "unchanged" } },
    Resources: { ExistingRole: { Type: "AWS::IAM::Role", Properties: {
      RoleName: service.startsWith("config") ? "zoolanding-config-authoring-test-deploy" : "zoolanding-deployer-api-proxy-test-github-deploy",
      AssumeRolePolicyDocument: { Version: "2012-10-17", Statement: [] } } },
      OriginalPolicy: { Type: "AWS::IAM::Policy", Properties: { PolicyName: "preserve", PolicyDocument: { Statement: [] } } } } };
}

function runtimeFixture() {
  const binding = { schemaVersion: 1, service: "api-runtime", environment: "test", account,
    stackId: `arn:aws:cloudformation:us-east-1:${account}:stack/zoolanding-api-proxy-test/synthetic`,
    package: { bucket: "synthetic-channel", key: "zoolanding-api-proxy-test/thn-runtime/reviewed.zip", versionId: "package-version" },
    record: { bucket: "synthetic-channel", key: "zoolanding-api-proxy-test/first-provisioning/plan.json", versionId: "plan-version" },
    runtime: { apiId: "abc123test", authStackId: `arn:aws:cloudformation:us-east-1:${account}:stack/zoolanding-auth-admin-test/synthetic`,
      routesRecord: { bucket: "synthetic-channel", key: "zoolanding-api-proxy-test/retained-routes/reviewed.json" } } };
  return { binding, config: { service: "api-runtime", account, channelBucket: "synthetic-channel", anchors: { account: sha(account) },
    expectedBindingSha256: hash(binding), expectedStackSha256: sha(binding.stackId) } };
}

module.exports = { fixture, original, account, runtimeFixture };
