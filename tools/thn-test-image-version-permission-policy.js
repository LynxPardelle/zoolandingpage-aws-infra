"use strict";
const {canonical, sha} = require("./thn-test-prerequisites");
const supplemental = require("./thn-test-permission-policy");
const TARGET = Object.freeze({role: supplemental.TARGETS.ThnTestImageExecutorSupplementalPolicy,
  logical: "ThnTestImageExecutorSupplementalPolicy", service: "zoolanding-image-upload-test",
  owner: "operator-role", policyName: supplemental.POLICY_NAME});
const REVIEWED_COMMIT = "01f1a851b5d33a69b11e6aa98e28a44e08c4eaba";
const fail = () => {throw new Error("thn_recovery_permission_guard_failed");};
const same = (a, b) => canonical(a) === canonical(b);
function policyResource() {return supplemental.supplementalResources()[TARGET.logical];}
function composeTemplate(original) {
  if (!original?.Resources || original.Transform) fail();
  const roles = Object.entries(original.Resources).filter(([, r]) => r.Type === "AWS::IAM::Role" && r.Properties?.RoleName === TARGET.role);
  if (roles.length !== 1) fail();
  const next = {...policyResource(), DependsOn: [roles[0][0]]}, previous = structuredClone(next);
  previous.Properties.PolicyDocument.Statement = previous.Properties.PolicyDocument.Statement
    .filter(s => !s.Action.includes("lambda:ListVersionsByFunction"));
  if (!same(original.Resources[TARGET.logical], previous)
    || Object.entries(original.Resources).some(([key, r]) => key !== TARGET.logical
      && r.Properties?.PolicyName === TARGET.policyName && r.Properties?.RoleName === TARGET.role)) fail();
  const result = structuredClone(original); result.Resources[TARGET.logical] = next;
  return result;
}
function validateBindings(binding, config) {
  if (!binding || !same(Object.keys(binding).sort(), ["schemaVersion", "service", "environment", "account", "stackId", "releaseCommit"].sort())
    || binding.schemaVersion !== 1 || binding.service !== "image-version" || binding.environment !== "test"
    || typeof binding.account !== "string" || !/^[0-9]{12}$/.test(binding.account) || binding.account !== config.account
    || sha(binding.account) !== config.anchors.account || sha(canonical(binding)) !== config.expectedBindingSha256
    || typeof binding.stackId !== "string" || sha(binding.stackId) !== config.expectedStackSha256
    || !new RegExp(`^arn:aws:cloudformation:us-east-1:${binding.account}:stack/${TARGET.service}/[A-Za-z0-9-]+$`).test(binding.stackId)
    || binding.releaseCommit !== REVIEWED_COMMIT) fail();
  return {};
}
function resolve(document, account) {
  if (!/^[0-9]{12}$/.test(account)) fail();
  if (Array.isArray(document)) return document.map(v => resolve(v, account));
  if (document && typeof document === "object") {
    if (Object.hasOwn(document, "Fn::Sub")) {
      if (!same(Object.keys(document), ["Fn::Sub"]) || typeof document["Fn::Sub"] !== "string") fail();
      const value = document["Fn::Sub"].replaceAll("${AWS::Partition}", "aws")
        .replaceAll("${AWS::Region}", "us-east-1").replaceAll("${AWS::AccountId}", account);
      if (value.includes("${")) fail();
      return value;
    }
    return Object.fromEntries(Object.entries(document).map(([k, v]) => [k, resolve(v, account)]));
  }
  return document;
}
function validateServiceState(stack, binding) {
  if (stack?.StackId !== binding.stackId || stack.StackName !== TARGET.service || stack.StackStatus !== "CREATE_FAILED"
    || stack.RoleARN !== `arn:aws:iam::${binding.account}:role/${TARGET.role}` || stack.EnableTerminationProtection !== true
    || !Array.isArray(stack.Parameters) || new Set(stack.Parameters.map(p => p.ParameterKey)).size !== stack.Parameters.length) fail();
  const values = Object.fromEntries(stack.Parameters.map(p => [p.ParameterKey, p.ParameterValue]));
  if (values.EnableThnPrivateUploadV2 !== "false" || values.ProvisionThnPrivateUploadV2State !== "true"
    || values.ThnPrivateUploadV2TerminationProtectionGate !== "CONFIRMED_ENABLED") fail();
}
module.exports = {TARGET, REVIEWED_COMMIT, policyResource, composeTemplate, validateBindings, resolve, validateServiceState};
