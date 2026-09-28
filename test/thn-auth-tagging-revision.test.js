"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const policy = require("../tools/thn-test-recovery-permission-policy");
const {fixture, original} = require("./fixtures/thn-recovery-bindings");
const service = "auth-provision", logical = policy.TARGETS[service].logical;
const tagParameter = "ThnAuthProvisionPoolCreateTagArn";
function legacy() {
  const value = original(service);
  value.Parameters = {...value.Parameters, ...policy.parameterDefinitions(service)};
  delete value.Parameters[tagParameter];
  value.Resources[logical] = policy.policyResource(service);
  value.Resources[logical].Properties.PolicyDocument.Statement.find(s => s.Action === "cognito-idp:TagResource").Resource = {Ref: "ThnAuthProvisionPoolArnScope"};
  return value;
}
test("TagResource alone matches the provider creation wildcard and retains exact mediation and tags", () => {
  const {binding, config} = fixture(service), values = policy.validateBindings(binding, config);
  const doc = policy.resolve(policy.policyResource(service).Properties.PolicyDocument, values);
  const old = policy.resolve(legacy().Resources[logical].Properties.PolicyDocument, values);
  const tag = doc.Statement.find(s => s.Action === "cognito-idp:TagResource");
  assert.equal(tag.Resource, `arn:aws:cognito-idp:us-east-1:${binding.account}:userpool/*`);
  assert.deepEqual(tag.Condition, old.Statement.find(s => s.Action === "cognito-idp:TagResource").Condition);
  tag.Resource = `arn:aws:cognito-idp:us-east-1:${binding.account}:userpool/us-east-1_*`;
  assert.deepEqual(doc, old);
});
test("only the exact legacy supplemental policy can be revised, preserving all other resources and parameters", () => {
  const before = legacy(), after = policy.composeTemplate(before, service);
  assert.equal(Object.keys(after.Resources).length, Object.keys(before.Resources).length);
  assert.deepEqual(after.Parameters[tagParameter], {Type: "String", NoEcho: true, MinLength: 1, MaxLength: 2048});
  const restored = structuredClone(after); delete restored.Parameters[tagParameter];
  restored.Resources[logical] = before.Resources[logical];
  assert.deepEqual(restored, before);
  assert.equal(policy.revisionAction(before, service), "Modify");
  assert.equal(policy.revisionAction(original(service), service), "Add");
  assert.throws(() => policy.composeTemplate(after, service), /recovery_permission/);
});
test("revision rejects widened legacy grants, unmasked parameters, role adoption and duplicate policy owners", () => {
  for (const mutate of [
    v => delete v.Resources[logical].Properties.PolicyDocument.Statement[1].Condition,
    v => v.Resources[logical].Properties.RoleName += "-foreign",
    v => v.Parameters.ThnAuthProvisionPoolArnScope.NoEcho = false,
    v => delete v.Parameters.ThnAuthProvisionStackArn,
    v => v.Resources.Copy = structuredClone(v.Resources[logical]),
    v => v.Resources.Adopted = {Type: "AWS::IAM::Role", Properties: {RoleName: policy.TARGETS[service].role}},
  ]) { const value = legacy(); mutate(value); assert.throws(() => policy.composeTemplate(value, service), /recovery_permission/); }
});
test("role snapshot validates the existing correction and counts only the replacement against the quota", () => {
  const {binding, config} = fixture(service), values = policy.validateBindings(binding, config);
  const old = policy.resolve(legacy().Resources[logical].Properties.PolicyDocument, values);
  const next = policy.resolve(policy.policyResource(service).Properties.PolicyDocument, values);
  const role = {Role: {RoleName: policy.TARGETS[service].role, Arn: `arn:aws:iam::${binding.account}:role/${policy.TARGETS[service].role}`,
    Path: "/", RoleId: "AROA" + "Q".repeat(16), AssumeRolePolicyDocument: {Statement: []}},
    inline: {Original: {Statement: []}, [policy.policyName(service)]: old}, attached: []};
  assert.deepEqual(policy.roleSnapshot(role, service, binding.account, next, old), role);
  const changed = structuredClone(role); changed.inline[policy.policyName(service)].Statement[1].Resource = "*";
  assert.throws(() => policy.roleSnapshot(changed, service, binding.account, next, old), /recovery_permission/);
});
