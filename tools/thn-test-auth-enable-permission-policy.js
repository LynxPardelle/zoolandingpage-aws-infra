"use strict";
const {canonical, sha} = require("./thn-test-prerequisites");
const TARGET = Object.freeze({role: "zoolanding-auth-admin-test-deploy", logical: "ThnAuthTestEnablePolicy",
  prefix: "ThnAuthEnable", service: "zoolanding-auth-admin-test", owner: "operator-role",
  policyName: "ThnTestAuthEnableV1", externalRole: true});
const REVIEWED_COMMIT = "cbc17c8f560c8586be641faa0abc7c60bd17a698";
const PARAMS = ["OwnerAliasArn", "AuthorizerArn", "OperatorArn", "AlarmScopeArn"];
const fail = () => {throw new Error("thn_recovery_permission_guard_failed");};
const ref = n => ({Ref: TARGET.prefix + n});
function policyArn(account) {return `arn:aws:iam::${account}:policy/${TARGET.policyName}`;}
function parameterDefinitions() {
  return Object.fromEntries(PARAMS.map(n => [TARGET.prefix + n, {Type: "String", NoEcho: true, MinLength: 1, MaxLength: 2048}]));
}
function policyResource() {
  const via = {StringEquals: {"aws:CalledViaFirst": "cloudformation.amazonaws.com"}};
  const grant = (Action, name, write = false) => ({Effect: "Allow", Action, Resource: ref(name), ...(write ? {Condition: via} : {})});
  return {Type: "AWS::IAM::ManagedPolicy", Properties: {ManagedPolicyName: TARGET.policyName, Path: "/", Roles: [TARGET.role],
    PolicyDocument: {Version: "2012-10-17", Statement: [
      grant(["lambda:CreateFunctionUrlConfig", "lambda:UpdateFunctionUrlConfig", "lambda:DeleteFunctionUrlConfig"], "OwnerAliasArn", true),
      grant(["lambda:GetFunctionUrlConfig"], "OwnerAliasArn"),
      grant(["lambda:AddPermission", "lambda:RemovePermission"], "AuthorizerArn", true),
      grant(["lambda:GetPolicy"], "AuthorizerArn"),
      grant(["iam:PutRolePolicy", "iam:DeleteRolePolicy"], "OperatorArn", true),
      grant(["iam:GetRolePolicy"], "OperatorArn"),
      grant(["cloudwatch:PutMetricAlarm", "cloudwatch:DeleteAlarms", "cloudwatch:TagResource", "cloudwatch:UntagResource"], "AlarmScopeArn", true),
      grant(["cloudwatch:DescribeAlarms", "cloudwatch:ListTagsForResource"], "AlarmScopeArn"),
    ]}}};
}
function validateBindings(binding, config) {
  if (!binding || canonical(Object.keys(binding).sort()) !== canonical(["schemaVersion", "service", "environment", "account", "stackId", "releaseCommit"].sort())
    || binding.schemaVersion !== 1 || binding.service !== "auth-enable" || binding.environment !== "test"
    || typeof binding.account !== "string" || !/^[0-9]{12}$/.test(binding.account) || binding.account !== config.account
    || sha(binding.account) !== config.anchors.account || sha(canonical(binding)) !== config.expectedBindingSha256
    || typeof binding.stackId !== "string" || sha(binding.stackId) !== config.expectedStackSha256
    || !new RegExp(`^arn:aws:cloudformation:us-east-1:${binding.account}:stack/${TARGET.service}/[A-Za-z0-9-]+$`).test(binding.stackId)
    || binding.releaseCommit !== REVIEWED_COMMIT) fail();
  const arn = (service, value) => `arn:aws:${service}:${service === "iam" ? "" : "us-east-1"}:${binding.account}:${value}`;
  return {
    ThnAuthEnableOwnerAliasArn: arn("lambda", "function:zoolanding-auth-admin-test-ThnOwnerOperatorV2:test"),
    ThnAuthEnableAuthorizerArn: arn("lambda", "function:zoolanding-auth-test-ThnV2OriginAuthorizer"),
    ThnAuthEnableOperatorArn: arn("iam", "role/zoolanding-thn-registry-test-operator"),
    ThnAuthEnableAlarmScopeArn: arn("cloudwatch", "alarm:zoolanding-auth-admin-test-ThnAuthAdminV2*"),
  };
}
function validateServiceState(service, binding) {
  const p = service?.Parameters;
  if (service?.StackName !== TARGET.service || service.StackId !== binding.stackId || service.RoleARN
    || service.StackStatus !== "UPDATE_COMPLETE" || service.EnableTerminationProtection !== true
    || !Array.isArray(p) || new Set(p.map(x => x.ParameterKey)).size !== p.length
    || p.find(x => x.ParameterKey === "ProvisionThnAuthAdminV2State")?.ParameterValue !== "true"
    || p.find(x => x.ParameterKey === "EnableThnAuthAdminV2")?.ParameterValue !== "false") fail();
}
module.exports = {TARGET, REVIEWED_COMMIT, policyArn, parameterDefinitions, policyResource, validateBindings, validateServiceState};
