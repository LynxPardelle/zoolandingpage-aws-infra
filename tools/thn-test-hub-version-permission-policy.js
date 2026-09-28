"use strict";
const {canonical, sha} = require("./thn-test-prerequisites");
const supplemental = require("./thn-test-permission-policy");
const TARGET = Object.freeze({role: supplemental.TARGETS.ThnTestHubSupplementalPolicy,
  logical: "ThnTestHubSupplementalPolicy", service: "zoolanding-content-hub-test",
  owner: "operator-role", policyName: supplemental.POLICY_NAME});
const REVIEWED_COMMIT = "1e4ea57e562d555afda6a79a6f7ae33fab10ccae";
const fail = () => {throw new Error("thn_recovery_permission_guard_failed");};
const same = (a, b) => canonical(a) === canonical(b);
function policyResource() {return supplemental.supplementalResources()[TARGET.logical];}
function composeTemplate(original) {
  if (!original?.Resources || original.Transform) fail();
  // This existing external role must never be adopted into the owning stack.
  if (Object.values(original.Resources).some(r => r.Type === "AWS::IAM::Role" && r.Properties?.RoleName === TARGET.role)) fail();
  const next = policyResource(), previous = structuredClone(next);
  previous.Properties.PolicyDocument.Statement[0].Action = previous.Properties.PolicyDocument.Statement[0].Action
    .filter(a => a !== "lambda:ListVersionsByFunction");
  if (!same(original.Resources[TARGET.logical], previous)
    || Object.entries(original.Resources).some(([key, r]) => key !== TARGET.logical
      && r.Properties?.PolicyName === TARGET.policyName && r.Properties?.RoleName === TARGET.role)) fail();
  const result = structuredClone(original); result.Resources[TARGET.logical] = next;
  return result;
}
function validateBindings(binding, config) {
  if (!binding || !same(Object.keys(binding).sort(), ["schemaVersion", "service", "environment", "account", "stackId", "releaseCommit"].sort())
    || binding.schemaVersion !== 1 || binding.service !== "hub-version" || binding.environment !== "test"
    || typeof binding.account !== "string" || !/^[0-9]{12}$/.test(binding.account) || binding.account !== config.account
    || sha(binding.account) !== config.anchors.account || sha(canonical(binding)) !== config.expectedBindingSha256
    || typeof binding.stackId !== "string" || sha(binding.stackId) !== config.expectedStackSha256
    || !new RegExp(`^arn:aws:cloudformation:us-east-1:${binding.account}:stack/${TARGET.service}/[A-Za-z0-9-]+$`).test(binding.stackId)
    || binding.releaseCommit !== REVIEWED_COMMIT) fail();
  return {};
}
function validateServiceState(stack, binding) {
  if (stack?.StackId !== binding.stackId || stack.StackName !== TARGET.service || stack.StackStatus !== "UPDATE_COMPLETE"
    || stack.RoleARN !== undefined || stack.EnableTerminationProtection !== true
    || !Array.isArray(stack.Parameters) || new Set(stack.Parameters.map(p => p.ParameterKey)).size !== stack.Parameters.length) fail();
  const values = Object.fromEntries(stack.Parameters.map(p => [p.ParameterKey, p.ParameterValue]));
  if (values.EnvironmentName !== "test" || ["EnableThnContentHubV2", "ProvisionThnContentHubV2State"]
    .some(k => values[k] !== undefined && values[k] !== "false")) fail();
}
function validateUnprovisionedTemplate(template) {
  if (!template?.Resources || !Object.keys(template.Resources).length
    || Object.keys(template.Resources).some(k => k.startsWith("ThnContentHubV2"))
    || Object.keys(template.Parameters || {}).some(k => /^(Enable|Provision)ThnContentHubV2/.test(k))) fail();
}
module.exports = {TARGET, REVIEWED_COMMIT, policyResource, composeTemplate, validateBindings, validateServiceState, validateUnprovisionedTemplate};
