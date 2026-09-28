"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { canonical, sha } = require("../tools/thn-test-prerequisites");
const policy = require("../tools/thn-test-recovery-permission-policy");
const { original, runtimeFixture: fixture, account } = require("./fixtures/thn-recovery-bindings");
const hash = value => sha(canonical(value));
function document() {
  assert.ok(fs.existsSync(path.join(__dirname, "../tools/thn-test-api-runtime-permission-policy.js")), "runtime permission revision is missing");
  const {binding, config} = fixture();
  return {binding, value: policy.resolve(policy.policyResource("api-runtime").Properties.PolicyDocument, policy.validateBindings(binding, config))};
}
test("runtime is a separate one-policy addition preserving the prior recovery policy", () => {
  document();
  const before = original("api");
  before.Resources.PriorRecovery = {Type: "AWS::IAM::RolePolicy", Properties: {PolicyName: policy.POLICY_NAME, PolicyDocument: {Statement: []}}};
  const composed = policy.composeTemplate(before, "api-runtime");
  assert.equal(Object.keys(composed.Resources).length, Object.keys(before.Resources).length + 1);
  for (const [name, value] of Object.entries(before.Resources)) assert.deepEqual(composed.Resources[name], value);
  assert.equal(composed.Resources.ThnApiRuntimeProvisioningPolicy.Properties.PolicyName, "ThnTestRuntimeProvisioningV1");
  assert.throws(() => policy.composeTemplate(composed, "api-runtime"));
});
test("runtime policy has exact versioned package and plan reads, one future route-record key", () => {
  const {binding, value} = document();
  const reads = value.Statement.filter(s => s.Action.includes("s3:GetObjectVersion"));
  assert.equal(reads.length, 3);
  for (const [index, key] of ["package", "record"].entries()) {
    assert.deepEqual(reads[index].Resource, [`arn:aws:s3:::${binding[key].bucket}/${binding[key].key}`]);
    assert.deepEqual(reads[index].Condition, {StringEquals: {"s3:VersionId": binding[key].versionId}});
  }
  assert.deepEqual(reads[2].Resource, [`arn:aws:s3:::${binding.runtime.routesRecord.bucket}/${binding.runtime.routesRecord.key}`]);
  assert.ok(!reads[2].Resource[0].includes("*"));
  assert.equal(reads[2].Condition, undefined); // Capture occurs after creation; the controller still pins version and digest.
});
test("provider writes are CF-mediated and never delete or update shared functions", () => {
  const {value} = document();
  for (const statement of value.Statement) for (const action of statement.Action) {
    assert.doesNotMatch(action, /Delete|UpdateFunction|UpdateStack|PutObject|dynamodb:|cognito-idp:|ec2:|kms:|elasticfilesystem:/);
    if (/^(iam:|lambda:|apigateway:)/.test(action) && !/:(Get|List|GET)/.test(action)) {
      assert.equal(statement.Condition.StringEquals["aws:CalledViaFirst"], "cloudformation.amazonaws.com");
    }
  }
  const create = value.Statement.find(s => s.Action.includes("lambda:CreateFunction"));
  assert.deepEqual(create.Resource, [`arn:aws:lambda:us-east-1:${account}:function:zoolanding-api-proxy-test-ThnAuthRuntimeV2*`]);
  const read = value.Statement.find(s => s.Action.includes("lambda:GetFunction"));
  assert.ok(read.Action.includes("lambda:ListTags"), "GetFunction on the tagged runtime also requires ListTags");
  assert.deepEqual(read.Resource, create.Resource);
  const role = value.Statement.find(s => s.Action.includes("iam:CreateRole"));
  assert.deepEqual(role.Resource, [`arn:aws:iam::${account}:role/zoolanding-api-proxy-test-ThnAuthRuntimeV2*`]);
  const attach = value.Statement.find(s => s.Action.includes("iam:AttachRolePolicy"));
  assert.equal(attach.Condition.ArnEquals["iam:PolicyARN"], "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole");
  const pass = value.Statement.find(s => s.Action.includes("iam:PassRole"));
  assert.equal(pass.Condition.StringEquals["iam:PassedToService"], "lambda.amazonaws.com");
});
test("REST API write scope is the existing API body, deployments collection and Prod stage only", () => {
  const {binding, value} = document(), apiArn = `arn:aws:apigateway:us-east-1::/restapis/${binding.runtime.apiId}`;
  for (const [action, resource] of [["apigateway:PUT", apiArn], ["apigateway:POST", apiArn + "/deployments"], ["apigateway:PATCH", apiArn + "/stages/Prod"]]) {
    assert.deepEqual(value.Statement.find(s => s.Action.includes(action)).Resource, [resource]);
  }
  const cfn = value.Statement.find(s => s.Action.includes("cloudformation:CreateChangeSet"));
  assert.deepEqual(cfn.Resource, [binding.stackId]);
  assert.deepEqual(cfn.Condition, {Null: {"cloudformation:RoleArn": "true"}, StringLike: {"cloudformation:ChangeSetName": ["thn-first-*", "thn-routes-*"]}});
});
test("bindings reject foreign stacks, keys, versions, added grants and malformed IDs", () => {
  document();
  for (const mutate of [b => b.runtime.apiId = "x/*", b => b.runtime.authStackId = b.stackId,
    b => b.runtime.routesRecord.key = "another/snapshot.json", b => b.runtime.routesRecord.bucket = "foreign",
    b => b.package.key = "zoolanding-api-proxy-test/shared.zip", b => b.record.key = "zoolanding-api-proxy-test/snapshot.json",
    b => b.package.versionId = "null", b => b.record.versionId = "null", b => b.runtime.actions = ["iam:*"]]) {
    const {binding, config} = fixture(); mutate(binding); config.expectedBindingSha256 = hash(binding);
    assert.throws(() => policy.validateBindings(binding, config));
  }
});
test("private runtime selectors use NoEcho and the combined live-size budget fits", () => {
  const {value} = document();
  for (const p of Object.values(policy.parameterDefinitions("api-runtime"))) { assert.equal(p.NoEcho, true); assert.equal(p.Default, undefined); }
  assert.ok(JSON.stringify(value).length + 1940 + 2000 < 10240, "runtime plus existing and recovery policies must fit the role quota");
});
