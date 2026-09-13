"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const {fixture, original} = require("./fixtures/thn-recovery-bindings");
const {canonical, sha} = require("../tools/thn-test-prerequisites");
const policy = require("../tools/thn-test-recovery-permission-policy");

test("Hub version revision modifies only one existing policy by adding one action", () => {
  const {binding, config} = fixture("hub-version"), before = original("hub-version");
  assert.ok(policy.TARGETS[config.service], "Hub version revision must be independently selectable");
  assert.deepEqual(policy.validateBindings(binding, config), {});
  assert.equal(policy.revisionAction(before, config.service), "Modify");
  const after = policy.composeTemplate(before, config.service), expected = structuredClone(before);
  expected.Resources.ThnTestHubSupplementalPolicy.Properties.PolicyDocument.Statement[0].Action.push("lambda:ListVersionsByFunction");
  assert.deepEqual(after, expected);
  assert.deepEqual(before, original("hub-version"));
  assert.deepEqual(policy.parameterDefinitions(config.service), {});
  assert.throws(() => policy.composeTemplate(after, config.service));
  for (const change of [b => b.Resources.ThnTestHubSupplementalPolicy.Properties.PolicyDocument.Statement[0].Action.push("lambda:InvokeFunction"),
    b => b.Resources.Adopted = {Type: "AWS::IAM::Role", Properties: {RoleName: policy.TARGETS[config.service].role}},
    b => delete b.Resources.ThnTestHubSupplementalPolicy]) {
    const changed = structuredClone(before); change(changed);
    assert.throws(() => policy.composeTemplate(changed, config.service));
  }
});

test("Hub binding rejects wrong scope, source, account and extra selectors even if resealed", () => {
  for (const mutate of [b => b.environment = "production", b => b.releaseCommit = "f".repeat(40),
    b => b.account = "999999999999", b => b.extra = "unreviewed", b => b.service = "image-version"]) {
    const {binding, config} = fixture("hub-version"); mutate(binding);
    config.expectedBindingSha256 = sha(canonical(binding));
    assert.throws(() => policy.validateBindings(binding, config));
  }
});
