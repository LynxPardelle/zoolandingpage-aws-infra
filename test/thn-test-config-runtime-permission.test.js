"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const {canonical, sha} = require("../tools/thn-test-prerequisites");
const policy = require("../tools/thn-test-recovery-permission-policy");
const {fixture, original, account} = require("./fixtures/thn-recovery-bindings");
const hash = value => sha(canonical(value));
const selection = "config-runtime";

test("Config runtime inspection grants only the approved read on the unqualified existing function", () => {
  assert.ok(policy.TARGETS[selection], "missing exact Config runtime inspection selection");
  const {binding, config} = fixture(selection);
  const values = policy.validateBindings(binding, config);
  assert.deepEqual(Object.keys(values), ["ThnConfigRuntimeFunctionArn"]);
  assert.deepEqual(policy.resolve(policy.policyResource(selection).Properties.PolicyDocument, values), {
    Version: "2012-10-17", Statement: [{Effect: "Allow", Action: ["lambda:GetRuntimeManagementConfig"],
      Resource: [binding.functions.ConfigAuthoringFunction]}],
  });
  assert.deepEqual(policy.parameterDefinitions(selection), {
    ThnConfigRuntimeFunctionArn: {Type: "String", NoEcho: true, MinLength: 1, MaxLength: 2048},
  });
});

test("Config runtime policy preserves existing recovery policy, resources and parameters", () => {
  const before = policy.composeTemplate(original("config"), "config");
  const snapshot = structuredClone(before);
  const after = policy.composeTemplate(before, selection);
  assert.deepEqual(before, snapshot);
  for (const [key, value] of Object.entries(before.Resources)) assert.deepEqual(after.Resources[key], value);
  for (const [key, value] of Object.entries(before.Parameters)) assert.deepEqual(after.Parameters[key], value);
  assert.equal(Object.keys(after.Resources).length, Object.keys(before.Resources).length + 1);
  assert.equal(after.Resources.ThnConfigRuntimeInspectionPolicy.Properties.PolicyName, "ThnTestRuntimeInspectionV1");
  assert.equal(after.Resources.ThnConfigRuntimeInspectionPolicy.Properties.RoleName, policy.TARGETS.config.role);
  assert.throws(() => policy.composeTemplate(after, selection));
});

test("Config runtime rejects rebound, qualified, foreign or additional functions and changed original records", () => {
  for (const mutate of [
    b => b.functions.ConfigAuthoringFunction += "other",
    b => b.functions.ConfigAuthoringFunction += ":1",
    b => b.functions.ConfigAuthoringFunction += ":*",
    b => b.functions.ConfigAuthoringFunction = `arn:aws:lambda:us-west-2:${account}:function:other`,
    b => b.functions.Other = b.functions.ConfigAuthoringFunction,
    b => delete b.functions.ConfigAuthoringFunction,
    b => b.account = "999999999999",
    b => b.environment = "production",
    b => b.record.key = "other/snapshot.json",
    b => b.package.versionId = "changed",
  ]) {
    const {binding, config} = fixture(selection); mutate(binding); config.expectedBindingSha256 = hash(binding);
    assert.throws(() => policy.validateBindings(binding, config));
  }
});

test("Config runtime canonical source is identical to the separate native TEST-only addition", () => {
  const cdk = require("aws-cdk-lib"), {Template} = require("aws-cdk-lib/assertions");
  const app = new cdk.App(), scope = new cdk.Stack(app, "ConfigRuntimeTest");
  const role = new cdk.CfnResource(scope, "ExistingRole", {type: "AWS::IAM::Role", properties: original("config").Resources.ExistingRole.Properties});
  role.overrideLogicalId("ExistingRole");
  policy.addCanonicalPolicy(scope, {name: "test"}, selection, role);
  const prod = new cdk.Stack(app, "ConfigRuntimeProd");
  const control = new cdk.Stack(app, "ConfigRuntimeControl");
  policy.addCanonicalPolicy(prod, {name: "production"}, selection, role);
  assert.deepEqual(Template.fromStack(scope).toJSON().Resources.ThnConfigRuntimeInspectionPolicy,
    policy.composeTemplate(original("config"), selection).Resources.ThnConfigRuntimeInspectionPolicy);
  assert.deepEqual(Template.fromStack(prod).toJSON(), Template.fromStack(control).toJSON());
  const frontend = fs.readFileSync(path.join(__dirname, "../lib/stacks/frontend-stack.js"), "utf8");
  assert.match(frontend, /addCanonicalPolicy\(scope, environment, "config-runtime", role\.node\.defaultChild\)/);
});

test("Config runtime checks ARN shape even when a fixture supplies matching identity anchors", () => {
  for (const suffix of [":1", ":*", ":latest"]) {
    const {binding, config} = fixture(selection);
    binding.functions.ConfigAuthoringFunction += suffix;
    config.anchors.config.functions.ConfigAuthoringFunction = sha(binding.functions.ConfigAuthoringFunction);
    config.expectedBindingSha256 = hash(binding);
    assert.throws(() => policy.validateBindings(binding, config));
  }
});

test("Config runtime dispatch uses an independent binding without changing the original recovery secrets", () => {
  const workflow = fs.readFileSync(path.join(__dirname, "../.github/workflows/thn-test-recovery-permissions.yml"), "utf8");
  assert.match(workflow, /options: \[config, api, api-runtime, config-runtime\]/);
  assert.match(workflow, /inputs.service == 'config-runtime' && secrets.THN_CONFIG_RUNTIME_BINDING_JSON/);
  assert.match(workflow, /inputs.service == 'config-runtime' && secrets.THN_CONFIG_RECOVERY_CHANNEL_BUCKET/);
  assert.match(workflow, /inputs.service == 'config' && secrets.THN_CONFIG_RECOVERY_BINDING_JSON/);
});
