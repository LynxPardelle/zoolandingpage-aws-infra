"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const policy = require("../tools/thn-test-recovery-permission-policy");
const {fixture, original} = require("./fixtures/thn-recovery-bindings");
const {canonical} = require("../tools/thn-test-prerequisites");

test("auth-enable adds only one managed policy to the existing TEST deploy role", () => {
  assert.ok(policy.TARGETS["auth-enable"], "missing independently scoped auth-enable target");
  const before = original("auth-enable"), after = policy.composeTemplate(before, "auth-enable");
  const target = policy.TARGETS["auth-enable"], r = after.Resources[target.logical];
  assert.equal(r.Type, "AWS::IAM::ManagedPolicy");
  assert.deepEqual(r.Properties.Roles, ["zoolanding-auth-admin-test-deploy"]);
  assert.equal(r.Properties.ManagedPolicyName, "ThnTestAuthEnableV1");
  delete after.Resources[target.logical];
  assert.deepEqual(after.Resources, before.Resources);
  assert.throws(() => policy.composeTemplate(policy.composeTemplate(before, "auth-enable"), "auth-enable"));
});

test("auth-enable seals exact source and derives scopes, rejecting caller-controlled grants", () => {
  assert.ok(policy.TARGETS["auth-enable"], "missing auth-enable binding validation");
  const {binding, config} = fixture("auth-enable");
  const values = policy.validateBindings(binding, config);
  const d = policy.resolve(policy.policyResource("auth-enable").Properties.PolicyDocument, values);
  assert.ok(canonical(d).length < 6144);
  assert.ok(canonical(d).includes("role/zoolanding-thn-registry-test-operator"));
  assert.ok(!canonical(d).includes("role/zoolanding-thn-content-hub-test-operator"));
  for (const s of d.Statement) {
    assert.ok(![].concat(s.Action).some(a => a.includes("*") || a === "iam:PassRole"));
    assert.notEqual(s.Resource, "*");
    if ([].concat(s.Action).some(a => /:(Create|Update|Delete|Put|Add|Remove|Tag|Untag)/.test(a)))
      assert.equal(s.Condition.StringEquals["aws:CalledViaFirst"], "cloudformation.amazonaws.com");
  }
  for (const change of [{environment: "production"}, {releaseCommit: "0".repeat(40)}, {operator: "foreign"}])
    assert.throws(() => policy.validateBindings({...binding, ...change}, config));
});

test("auth-enable fills every missing origin authorizer lifecycle action on the exact ARN", () => {
  const {binding, config} = fixture("auth-enable");
  const values = policy.validateBindings(binding, config);
  const document = policy.resolve(policy.policyResource("auth-enable").Properties.PolicyDocument, values);
  for (const action of ["lambda:GetFunctionConfiguration", "lambda:UntagResource", "lambda:UpdateFunctionCode",
    "lambda:UpdateFunctionConfiguration"]) {
    const grants = document.Statement.filter(s => [].concat(s.Action).includes(action));
    assert.equal(grants.length, 1, action);
    assert.equal(grants[0].Resource, values.ThnAuthEnableAuthorizerArn);
    if (action !== "lambda:GetFunctionConfiguration")
      assert.deepEqual(grants[0].Condition, {StringEquals: {"aws:CalledViaFirst": "cloudformation.amazonaws.com"}});
  }
});

test("auth-enable repairs only the exact existing managed policy", () => {
  const before = original("auth-enable"), target = policy.TARGETS["auth-enable"];
  const module = require("../tools/thn-test-auth-enable-permission-policy");
  const legacy = policy.composeTemplate(before, "auth-enable");
  legacy.Resources[target.logical] = module.previousPolicyResource();
  assert.equal(policy.revisionAction(legacy, "auth-enable"), "Modify");
  const corrected = policy.composeTemplate(legacy, "auth-enable");
  assert.deepEqual(Object.keys(corrected.Resources).sort(), Object.keys(legacy.Resources).sort());
  assert.deepEqual(corrected.Resources[target.logical].Properties.Roles, [target.role]);
  const foreign = structuredClone(legacy);
  foreign.Resources[target.logical].Properties.PolicyDocument.Statement[0].Effect = "Deny";
  assert.throws(() => policy.revisionAction(foreign, "auth-enable"));
});

test("managed correction fits without relaxing inline quota or accepting existing attachments", () => {
  assert.ok(policy.TARGETS["auth-enable"], "missing managed-policy quota handling");
  const {binding, config} = fixture("auth-enable"), target = policy.TARGETS["auth-enable"];
  const role = {Role: {RoleName: target.role, Arn: `arn:aws:iam::${config.account}:role/${target.role}`,
    Path: "/", RoleId: "AROA" + "Q".repeat(16), AssumeRolePolicyDocument: {Statement: []}},
    inline: {Existing: {Statement: [], Padding: "x".repeat(10100)}}, attached: []};
  const d = policy.resolve(policy.policyResource("auth-enable").Properties.PolicyDocument, policy.validateBindings(binding, config));
  assert.deepEqual(policy.roleSnapshot(role, "auth-enable", config.account, d), role);
  assert.throws(() => policy.roleSnapshot({...role, attached: [{PolicyArn: "foreign"}]}, "auth-enable", config.account, d));
  assert.throws(() => policy.roleSnapshot(role, "auth-enable", config.account, {...d, Padding: "x".repeat(6144)}));
  const tooBig = structuredClone(role); tooBig.inline.Existing.Padding = "x".repeat(10240);
  assert.throws(() => policy.roleSnapshot(tooBig, "auth-enable", config.account, d));
});

test("Auth enable refuses role adoption, duplicate policy identities and ambiguous service state", () => {
  for (const resource of [
    {Type: "AWS::IAM::Role", Properties: {RoleName: policy.TARGETS["auth-enable"].role}},
    {Type: "AWS::IAM::ManagedPolicy", Properties: {ManagedPolicyName: "ThnTestAuthEnableV1"}},
  ]) {
    const before = original("auth-enable"); before.Resources.Foreign = resource;
    assert.throws(() => policy.composeTemplate(before, "auth-enable"));
  }
  const {binding} = fixture("auth-enable"), module = require("../tools/thn-test-auth-enable-permission-policy");
  const state = {StackName: module.TARGET.service, StackId: binding.stackId, StackStatus: "UPDATE_COMPLETE", EnableTerminationProtection: true,
    Parameters: [{ParameterKey: "ProvisionThnAuthAdminV2State", ParameterValue: "true"}, {ParameterKey: "EnableThnAuthAdminV2", ParameterValue: "false"}]};
  assert.doesNotThrow(() => module.validateServiceState(state,binding));
  const failedRollback = structuredClone(state); failedRollback.StackStatus = "UPDATE_ROLLBACK_FAILED";
  assert.throws(() => module.validateServiceState(failedRollback, binding));
  assert.doesNotThrow(() => module.validateServiceState(failedRollback, binding, {allowRollbackFailed: true}));
  for (const mutate of [s=>s.Parameters.push(s.Parameters[0]), s=>s.Parameters.pop(), s=>s.Parameters[1].ParameterValue="true",
    s=>s.RoleARN="foreign", s=>s.StackStatus="UPDATE_IN_PROGRESS", s=>s.StackId+="foreign"]){
    const changed=structuredClone(state); mutate(changed); assert.throws(()=>module.validateServiceState(changed,binding));
  }
});
