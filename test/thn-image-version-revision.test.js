"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const policy = require("../tools/thn-test-recovery-permission-policy");
const supplemental = require("../tools/thn-test-permission-policy");
const {sha, canonical} = require("../tools/thn-test-prerequisites");
const service = "image-version", logical = "ThnTestImageExecutorSupplementalPolicy";
function legacy() {
  const resources = supplemental.supplementalResources();
  resources[logical].Properties.PolicyDocument.Statement = resources[logical].Properties.PolicyDocument.Statement
    .filter(s => !s.Action.includes("lambda:ListVersionsByFunction"));
  resources[logical].DependsOn = ["ExistingExecutor"];
  resources.ExistingExecutor = {Type: "AWS::IAM::Role", Properties: {
    RoleName: supplemental.TARGETS[logical], AssumeRolePolicyDocument: {Statement: []}}};
  return {Parameters: {Existing: {Type: "String", NoEcho: true}}, Resources: resources, Outputs: {Keep: {Value: "same"}}};
}
test("Image version permission revises exactly one existing policy and preserves other supplements", () => {
  assert.ok(policy.TARGETS[service], "missing Image version revision selection");
  const before = legacy(), after = policy.composeTemplate(before, service);
  const statements = after.Resources[logical].Properties.PolicyDocument.Statement;
  const delta = statements.filter(s => s.Action.includes("lambda:ListVersionsByFunction"));
  assert.deepEqual(delta, [{Effect: "Allow", Action: ["lambda:ListVersionsByFunction"], Resource: [{
    "Fn::Sub": "arn:${AWS::Partition}:lambda:${AWS::Region}:${AWS::AccountId}:function:zoolanding-image-upload-test-ThnImageUploadV2"}]}]);
  const restored = structuredClone(after); restored.Resources[logical] = before.Resources[logical];
  assert.deepEqual(restored, before);
  assert.equal(policy.revisionAction(before, service), "Modify");
  assert.throws(() => policy.composeTemplate(after, service), /recovery_permission/);
});
test("Image revision rejects missing, widened, duplicated or foreign executor baselines", () => {
  assert.ok(policy.TARGETS[service], "missing Image version revision selection");
  for (const mutate of [v => delete v.Resources[logical],
    v => v.Resources[logical].Properties.PolicyDocument.Statement[0].Resource = ["*"],
    v => v.Resources[logical].Properties.RoleName += "other",
    v => v.Resources[logical].DependsOn = ["Foreign"],
    v => v.Resources.Copy = structuredClone(v.Resources[logical]),
    v => delete v.Resources.ExistingExecutor]) {
    const value = legacy(); mutate(value);
    assert.throws(() => policy.composeTemplate(value, service), /recovery_permission/);
  }
});
test("Image permission binding selects only the approved failed TEST source and adds no parameters", () => {
  assert.ok(policy.TARGETS[service], "missing Image version revision selection");
  const account = "123456789012", binding = {schemaVersion: 1, service, environment: "test", account,
    stackId: `arn:aws:cloudformation:us-east-1:${account}:stack/zoolanding-image-upload-test/synthetic`,
    releaseCommit: "01f1a851b5d33a69b11e6aa98e28a44e08c4eaba"};
  const config = {service, account, anchors: {account: sha(account)}, expectedStackSha256: sha(binding.stackId),
    expectedBindingSha256: sha(canonical(binding))};
  assert.deepEqual(policy.parameterDefinitions(service), {});
  assert.deepEqual(policy.validateBindings(binding, config), {});
  for (const key of ["releaseCommit", "stackId", "account", "environment"]) {
    const other = {...binding, [key]: binding[key] + "other"};
    assert.throws(() => policy.validateBindings(other, {...config, expectedBindingSha256: sha(canonical(other))}));
  }
});
