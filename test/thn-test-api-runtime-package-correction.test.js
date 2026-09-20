"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { canonical, sha } = require("../tools/thn-test-prerequisites");
const policy = require("../tools/thn-test-recovery-permission-policy");
const { original, account } = require("./fixtures/thn-recovery-bindings");

function fixture() {
  const source = "45c6a2586a481333221fdafbbbd4e503a8560b8b";
  const digest = "a".repeat(64), root = "zoolanding-api-proxy-test";
  const binding = { schemaVersion: 1, service: "api-runtime-corrected", environment: "test", account,
    stackId: `arn:aws:cloudformation:us-east-1:${account}:stack/${root}/synthetic`, sourceSha: source,
    packageSha256: digest,
    package: { bucket: "synthetic-channel", key: `${root}/thn-runtime/${source}/git-lf/${digest}/runtime-v2.zip`, versionId: "new-package-v1" },
    record: { bucket: "synthetic-channel", key: `${root}/first-provisioning/${source}/git-lf/${digest}/plan.json`, versionId: "new-plan-v1" } };
  const config = { service: binding.service, account, channelBucket: "synthetic-channel", anchors: { account: sha(account) },
    expectedBindingSha256: sha(canonical(binding)), expectedStackSha256: sha(binding.stackId) };
  return { binding, config };
}

test("corrected package policy adds only two exact versioned reads and preserves existing policy", () => {
  const { binding, config } = fixture();
  const values = policy.validateBindings(binding, config);
  const document = policy.resolve(policy.policyResource(config.service).Properties.PolicyDocument, values);
  assert.equal(document.Statement.length, 2);
  for (const [index, item] of [binding.package, binding.record].entries()) {
    assert.deepEqual(document.Statement[index].Action, ["s3:GetObjectVersion"]);
    assert.deepEqual(document.Statement[index].Resource, [`arn:aws:s3:::${item.bucket}/${item.key}`]);
    assert.deepEqual(document.Statement[index].Condition, { StringEquals: { "s3:VersionId": item.versionId } });
  }
  const before = original("api");
  Object.assign(before.Parameters, policy.parameterDefinitions("api-runtime"));
  before.Resources.ThnApiRuntimeProvisioningPolicy = { Type: "AWS::IAM::RolePolicy", Properties: {
    RoleName: policy.TARGETS[config.service].role, PolicyName: "ThnTestRuntimeProvisioningV1",
    PolicyDocument: { Version: "2012-10-17", Statement: [] } } };
  const after = policy.composeTemplate(before, config.service);
  for (const [name, value] of Object.entries(before.Resources)) assert.deepEqual(after.Resources[name], value);
  assert.equal(Object.keys(after.Resources).length, Object.keys(before.Resources).length + 1);
  assert.throws(() => policy.composeTemplate(after, config.service));
  const missing = structuredClone(before);
  delete missing.Resources.ThnApiRuntimeProvisioningPolicy;
  assert.throws(() => policy.composeTemplate(missing, config.service));
  const noParameters = structuredClone(before);
  delete noParameters.Parameters.ThnApiRuntimePackageObjectArn;
  assert.throws(() => policy.composeTemplate(noParameters, config.service));
  for (const definition of Object.values(policy.parameterDefinitions(config.service))) {
    assert.equal(definition.NoEcho, true);
    assert.equal(definition.Default, undefined);
  }
});

test("corrected package binding rejects any other stack, bucket, path, digest, or version", () => {
  const edits = [b => b.stackId = b.stackId.replace("api-proxy", "config-authoring"),
    b => b.package.bucket = "foreign-bucket", b => b.record.bucket = "foreign-bucket",
    b => b.package.key = b.package.key.replace("git-lf", "windows-crlf"),
    b => b.record.key = b.record.key.replace("plan.json", "other.json"),
    b => b.package.key = b.package.key.replace(b.packageSha256, "b".repeat(64)),
    b => b.record.key = b.record.key.replace(b.packageSha256, "b".repeat(64)),
    b => b.package.versionId = "null", b => b.record.versionId = "null",
    b => b.extra = true];
  for (const edit of edits) {
    const { binding, config } = fixture(); edit(binding);
    config.expectedBindingSha256 = sha(canonical(binding));
    assert.throws(() => policy.validateBindings(binding, config));
  }
});
