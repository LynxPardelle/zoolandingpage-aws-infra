"use strict";
// Synthetic data only. Importing fixtures must never register another test suite.
const { canonical, sha } = require("../../tools/thn-test-prerequisites");
const hash = value => sha(canonical(value));
const account = "123456789012";

function fixture(service = "config") {
  const name = `zoolanding-${service === "config" ? "config-authoring" : "api-proxy"}-test`;
  const binding = { schemaVersion: 1, service, environment: "test", account,
    stackId: `arn:aws:cloudformation:us-east-1:${account}:stack/${name}/synthetic`,
    package: { bucket: "synthetic-original-private", key: "original/code.zip", versionId: "original-version" },
    record: { bucket: "synthetic-channel", key: service === "config"
      ? `system/deploy-artifacts/${"1".repeat(40)}/123/1/aws-live-snapshot.json` : `${name}/snapshot.json`, versionId: "record-version" },
    functions: service === "api" ? Object.fromEntries(["ApiProxyFunction", "AuthProvisioningExecutorFunction", "AuthJwtAuthorizerFunction"]
      .map(n => [n, `arn:aws:lambda:us-east-1:${account}:function:${name}-${n}-synthetic`])) : {} };
  const anchors = { account: sha(account), [service]: {
    selector: hash({ Bucket: binding.package.bucket, Key: binding.package.key }), version: sha(binding.package.versionId) } };
  return { binding, config: { account, anchors, service, channelBucket: binding.record.bucket,
    expectedBindingSha256: hash(binding), expectedStackSha256: sha(binding.stackId) } };
}

function original(service) {
  return { Parameters: { ExistingSecret: { Type: "String", NoEcho: true } }, Outputs: { Keep: { Value: "unchanged" } },
    Resources: { ExistingRole: { Type: "AWS::IAM::Role", Properties: {
      RoleName: service === "config" ? "zoolanding-config-authoring-test-deploy" : "zoolanding-deployer-api-proxy-test-github-deploy",
      AssumeRolePolicyDocument: { Version: "2012-10-17", Statement: [] } } },
      OriginalPolicy: { Type: "AWS::IAM::Policy", Properties: { PolicyName: "preserve", PolicyDocument: { Statement: [] } } } } };
}

module.exports = { fixture, original, account };
