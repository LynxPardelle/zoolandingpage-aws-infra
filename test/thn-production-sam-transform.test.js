"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const api = require("../tools/thn-production-identities");
const manifest = require("../tools/production/thn-deployment-identities.json");

const transform = "arn:aws:cloudformation:us-east-1:aws:transform/Serverless-2016-10-31";
const executionRoles = ["auth-admin", "thn-auth-runtime", "content-hub", "image-upload", "api-proxy"]
  .map(service => `zoolanding-deployer-${service}-production-cfn-exec`);

test("SAM expansion is granted and simulated for each CloudFormation execution role", () => {
  const policy = manifest.template.Resources.ThnProductionSamTransformPolicy;
  assert.ok(policy, "CloudFormation, rather than only the GitHub caller, must authorize SAM expansion");
  assert.equal(policy.Type, "AWS::IAM::Policy");
  assert.equal(policy.DeletionPolicy, "Retain");
  assert.equal(policy.UpdateReplacePolicy, "Retain");
  const targets = policy.Properties.Roles.map(value =>
    manifest.template.Resources[value.Ref]?.Properties?.RoleName).sort();
  assert.deepEqual(targets, [...executionRoles].sort());
  assert.deepEqual(policy.Properties.PolicyDocument.Statement, [{
    Effect: "Allow", Action: ["cloudformation:CreateChangeSet"], Resource: [transform],
    Condition: {StringEquals: {"aws:RequestedRegion": "us-east-1"}}
  }]);
  for (const name of executionRoles) {
    const rows = manifest.proofMatrix.filter(row => row.principalArn === `arn:aws:iam::765932874577:role/${name}` && row.actions.includes("cloudformation:CreateChangeSet"));
    assert.equal(rows.length, 1, `Missing SAM execution-role preflight for ${name}`);
    assert.deepEqual(rows[0].actions, ["cloudformation:CreateChangeSet"]);
    assert.deepEqual(rows[0].resources, [transform]);
    assert.deepEqual(rows[0].condition, {StringEquals: {"aws:RequestedRegion": "us-east-1"}});
  }
});

test("the existing bootstrap reviewer accepts only adding the SAM policy while retaining all existing identities", () => {
  assert.ok(manifest.template.Resources.ThnProductionSamTransformPolicy);
  const previous = api.compose(null, manifest);
  delete previous.Resources.ThnProductionSamTransformPolicy;
  const candidate = api.compose(previous, manifest);
  for (const [id, resource] of Object.entries(previous.Resources)) assert.deepEqual(candidate.Resources[id], resource);
  const changes = [{Type: "Resource", ResourceChange: {
    Action: "Add", LogicalResourceId: "ThnProductionSamTransformPolicy", ResourceType: "AWS::IAM::Policy", Replacement: "False"
  }}];
  const native = {Status: "CREATE_COMPLETE", ExecutionStatus: "AVAILABLE", Parameters: [{ParameterKey: "ThnProductionOwnerPoolArn", ParameterValue: "BLOCKED"}], Changes: changes};
  assert.equal(api.reviewInventory(previous, candidate, native), changes);
  for (const action of ["Modify", "Remove"]) {
    assert.throws(() => api.reviewInventory(previous, candidate, {...native, Changes: [{...changes[0], ResourceChange: {...changes[0].ResourceChange, Action: action}}]}), /inventory_invalid/);
  }
});
