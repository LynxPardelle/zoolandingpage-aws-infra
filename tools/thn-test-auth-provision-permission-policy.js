"use strict";
const {canonical, sha} = require("./thn-test-prerequisites");
const TARGET = Object.freeze({role: "zoolanding-auth-admin-test-deploy", logical: "ThnAuthTestProvisioningPolicy",
  prefix: "ThnAuthProvision", service: "zoolanding-auth-admin-test", owner: "operator-role",
  policyName: "ThnTestClosedProvisioningV1", externalRole: true});
const REVIEWED_COMMIT = "cbc17c8f560c8586be641faa0abc7c60bd17a698";
const FUNCTIONS = ["zoolanding-auth-admin-test-ThnOwnerOperatorV2", "zoolanding-auth-admin-test-ThnAuthAdminV2Function",
  "zoolanding-auth-test-ThnV2OriginAuthorizer"];
const TABLES = ["Session", "CurrentUserState", "Challenge", "Throttle", "Audit"];
const PARAMS = ["StackArn", "PoolArnScope", ...FUNCTIONS.map((_, i) => `Function${i}Arn`), "Function0QualifiedArn",
  "OwnerAliasArn", ...TABLES.map(n => n + "TableArn"), ...FUNCTIONS.map((_, i) => `Role${i}Arn`),
  ...[0, 1, 2, 3].flatMap(i => [`Log${i}Arn`, `Log${i}AccessArn`])];
const fail = () => { throw new Error("thn_recovery_permission_guard_failed"); };
const keys = (v, names) => v && typeof v === "object" && !Array.isArray(v)
  && canonical(Object.keys(v).sort()) === canonical([...names].sort());
const ref = n => ({Ref: TARGET.prefix + n});
function parameterDefinitions() {
  return Object.fromEntries(PARAMS.map(n => [TARGET.prefix + n, {Type: "String", NoEcho: true, MinLength: 1, MaxLength: 2048}]));
}
function policyResource() {
  const region = {"aws:RequestedRegion": "us-east-1"};
  const via = {StringEquals: {"aws:CalledViaFirst": "cloudformation.amazonaws.com"}};
  const poolTags = kind => ({[`aws:${kind}/aws:cloudformation:stack-id`]: ref("StackArn"),
    [`aws:${kind}/aws:cloudformation:logical-id`]: "ThnAuthAdminV2UserPool"});
  const statement = (Action, Resource, Condition) => ({Effect: "Allow", Action: Action.length === 1 ? Action[0] : Action,
    Resource: Resource.length === 1 ? Resource[0] : Resource, ...(Condition ? {Condition} : {})});
  const functions = [...FUNCTIONS.map((_, i) => ref(`Function${i}Arn`)), ref("Function0QualifiedArn")];
  const tables = TABLES.map(n => ref(n + "TableArn"));
  return {Type: "AWS::IAM::RolePolicy", Properties: {RoleName: TARGET.role, PolicyName: TARGET.policyName,
    PolicyDocument: {Version: "2012-10-17", Statement: [
      statement(["cognito-idp:CreateUserPool"], ["*"], {StringEquals: {...via.StringEquals, ...region, ...poolTags("RequestTag")}}),
      statement(["cognito-idp:TagResource"], [ref("PoolArnScope")], {StringEquals: {...via.StringEquals, ...poolTags("RequestTag")}}),
      statement(["cognito-idp:CreateUserPoolClient", "cognito-idp:CreateGroup", "cognito-idp:SetUserPoolMfaConfig"],
        [ref("PoolArnScope")], {StringEquals: {...via.StringEquals, ...poolTags("ResourceTag")}}),
      statement(["cognito-idp:DescribeUserPool", "cognito-idp:GetUserPoolMfaConfig", "cognito-idp:DescribeUserPoolClient",
        "cognito-idp:GetGroup"], [ref("PoolArnScope")], {StringEquals: poolTags("ResourceTag")}),
      statement(["lambda:GetAlias", "lambda:ListVersionsByFunction", "lambda:GetProvisionedConcurrencyConfig", "lambda:GetRuntimeManagementConfig",
        "lambda:GetFunctionCodeSigningConfig", "lambda:GetFunctionRecursionConfig",
        "lambda:GetFunctionScalingConfig"], functions),
      statement(["lambda:CreateFunction", "lambda:DeleteFunction", "lambda:TagResource",
        "lambda:GetFunction", "lambda:ListTags"], [ref("Function2Arn")], via),
      statement(["lambda:PublishVersion", "lambda:PutFunctionConcurrency"], [ref("Function0Arn")], via),
      statement(["lambda:CreateAlias", "lambda:DeleteAlias"], [ref("Function0Arn"), ref("OwnerAliasArn")], via),
      statement(["lambda:PutResourcePolicy", "lambda:DeleteResourcePolicy", "lambda:GetResourcePolicy"], [ref("OwnerAliasArn")], via),
      statement(["dynamodb:DescribeContinuousBackups", "dynamodb:DescribeContributorInsights", "dynamodb:DescribeKinesisStreamingDestination",
        "dynamodb:GetResourcePolicy"], tables),
      statement(["dynamodb:UpdateContinuousBackups"], tables, via),
      statement(["dynamodb:PutResourcePolicy"], [ref("AuditTableArn")], via),
      statement(["iam:ListAttachedRolePolicies", "iam:ListRolePolicies"], [ref("Role0Arn"), ref("Role1Arn")],
        {StringEquals: {"aws:CalledViaFirst": "cloudformation.amazonaws.com"}}),
      // The origin authorizer's fixed role name is outside the original auth-admin prefix.
      statement(["iam:CreateRole", "iam:GetRole", "iam:GetRolePolicy", "iam:PutRolePolicy", "iam:DeleteRolePolicy",
        "iam:DeleteRole", "iam:TagRole", "iam:ListAttachedRolePolicies", "iam:ListRolePolicies"], [ref("Role2Arn")],
        {StringEquals: {"aws:CalledViaFirst": "cloudformation.amazonaws.com"}}),
      statement(["iam:PassRole"], [ref("Role2Arn")], {StringEquals: {
        "aws:CalledViaFirst": "cloudformation.amazonaws.com", "iam:PassedToService": "lambda.amazonaws.com"}}),
      statement(["logs:CreateLogGroup", "logs:PutRetentionPolicy"], [0, 1, 2, 3].map(i => ref(`Log${i}AccessArn`)), via),
      statement(["logs:TagResource", "logs:ListTagsForResource"], [0, 1, 2, 3].map(i => ref(`Log${i}Arn`)), via),
      statement(["logs:DescribeLogGroups"], ["*"], {StringEquals: region}),
    ]}}};
}
function validateBindings(binding, config) {
  if (!keys(binding, ["schemaVersion", "service", "environment", "account", "stackId", "releaseCommit"])
    || binding.schemaVersion !== 1 || binding.service !== "auth-provision" || binding.environment !== "test"
    || typeof binding.account !== "string" || !/^[0-9]{12}$/.test(binding.account) || binding.account !== config.account
    || sha(binding.account) !== config.anchors.account || sha(canonical(binding)) !== config.expectedBindingSha256
    || typeof binding.stackId !== "string" || sha(binding.stackId) !== config.expectedStackSha256
    || !new RegExp(`^arn:aws:cloudformation:us-east-1:${binding.account}:stack/${TARGET.service}/[A-Za-z0-9-]+$`).test(binding.stackId)
    || binding.releaseCommit !== REVIEWED_COMMIT) fail();
  const arn = (service, value) => `arn:aws:${service}:${service === "iam" ? "" : "us-east-1"}:${binding.account}:${value}`;
  const values = {StackArn: binding.stackId, PoolArnScope: arn("cognito-idp", "userpool/us-east-1_*")};
  FUNCTIONS.forEach((name, i) => {values[`Function${i}Arn`] = arn("lambda", "function:" + name);
    values[`Function${i}QualifiedArn`] = values[`Function${i}Arn`] + ":*";
    values[`Role${i}Arn`] = arn("iam", "role/" + name + "Role");});
  values.OwnerAliasArn = values.Function0Arn + ":test";
  TABLES.forEach(n => {values[n + "TableArn"] = arn("dynamodb", `table/${TARGET.service}-Thn${n}V2`);});
  [...FUNCTIONS.map(n => "/aws/lambda/" + n), "/aws/apigateway/zoolanding-auth-admin-test-ThnAuthAdminV2Api"].forEach((name, i) => {
    values[`Log${i}Arn`] = arn("logs", "log-group:" + name); values[`Log${i}AccessArn`] = values[`Log${i}Arn`] + ":*";
  });
  return Object.fromEntries(PARAMS.map(n => [TARGET.prefix + n, values[n]]));
}
module.exports = {TARGET, REVIEWED_COMMIT, parameterDefinitions, policyResource, validateBindings};
