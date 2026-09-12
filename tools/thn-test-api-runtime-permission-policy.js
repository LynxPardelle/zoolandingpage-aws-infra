"use strict";
const { canonical, sha } = require("./thn-test-prerequisites");
const TARGET = Object.freeze({role: "zoolanding-deployer-api-proxy-test-github-deploy", logical: "ThnApiRuntimeProvisioningPolicy",
  prefix: "ThnApiRuntime", service: "zoolanding-api-proxy-test", owner: "operator-role", policyName: "ThnTestRuntimeProvisioningV1"});
const fail = () => { throw new Error("thn_runtime_permission_guard_failed"); };
const hash = value => sha(canonical(value));
const keys = (value, expected) => value && typeof value === "object" && !Array.isArray(value)
  && canonical(Object.keys(value).sort()) === canonical([...expected].sort());
const names = ["StackArn", "AuthStackArn", "PackageObjectArn", "PackageVersionId", "RecordObjectArn", "RecordVersionId",
  "RoutesRecordObjectArn", "FunctionArnScope", "RoleArnScope", "RestApiArn", "DeploymentArn", "DeploymentReadScope", "StageArn", "ExportReadScope"];
const ref = name => ({Ref: TARGET.prefix + name});
function parameterDefinitions() {
  return Object.fromEntries(names.map(name => [TARGET.prefix + name, {Type: "String", NoEcho: true, MinLength: 1, MaxLength: 2048}]));
}
function policyResource() {
  const via = {StringEquals: {"aws:CalledViaFirst": "cloudformation.amazonaws.com"}};
  const statement = (Action, Resource, Condition) => ({Effect: "Allow", Action, Resource, ...(Condition ? {Condition} : {})});
  const version = name => statement(["s3:GetObjectVersion"], [ref(name + "ObjectArn")], {StringEquals: {"s3:VersionId": ref(name + "VersionId")}});
  return {Type: "AWS::IAM::RolePolicy", Properties: {RoleName: TARGET.role, PolicyName: TARGET.policyName,
    PolicyDocument: {Version: "2012-10-17", Statement: [version("Package"), version("Record"),
      // The capture is created after provisioning. This is one exact future key,
      // not a prefix grant; the retained controller enforces version + digest.
      statement(["s3:GetObjectVersion"], [ref("RoutesRecordObjectArn")]),
      statement(["cloudformation:CreateChangeSet"], [ref("StackArn")], {Null: {"cloudformation:RoleArn": "true"},
        StringLike: {"cloudformation:ChangeSetName": ["thn-first-*", "thn-routes-*"]}}),
      statement(["cloudformation:DescribeStackResource"], [ref("AuthStackArn")]),
      statement(["apigateway:GET"], [ref("RestApiArn"), ref("StageArn"), ref("DeploymentReadScope"), ref("ExportReadScope")]),
      statement(["apigateway:PUT"], [ref("RestApiArn")], via),
      statement(["apigateway:POST"], [ref("DeploymentArn")], via),
      statement(["apigateway:PATCH"], [ref("StageArn")], via),
      statement(["lambda:GetFunction", "lambda:ListTags", "lambda:GetFunctionConfiguration", "lambda:GetAlias", "lambda:GetPolicy",
        "lambda:GetProvisionedConcurrencyConfig", "lambda:GetRuntimeManagementConfig", "lambda:GetFunctionRecursionConfig",
        "lambda:GetFunctionCodeSigningConfig", "lambda:GetFunctionScalingConfig", "lambda:ListVersionsByFunction"], [ref("FunctionArnScope")]),
      statement(["lambda:CreateFunction", "lambda:PublishVersion", "lambda:CreateAlias", "lambda:TagResource"], [ref("FunctionArnScope")], via),
      statement(["lambda:AddPermission"], [ref("FunctionArnScope")], {StringEquals: {
        "aws:CalledViaFirst": "cloudformation.amazonaws.com", "lambda:Principal": "apigateway.amazonaws.com"}}),
      statement(["iam:CreateRole", "iam:PutRolePolicy", "iam:TagRole", "iam:UntagRole", "iam:GetRole", "iam:GetRolePolicy",
        "iam:ListRolePolicies", "iam:ListAttachedRolePolicies"], [ref("RoleArnScope")], via),
      statement(["iam:AttachRolePolicy"], [ref("RoleArnScope")], {...via,
        ArnEquals: {"iam:PolicyARN": "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"}}),
      statement(["iam:PassRole"], [ref("RoleArnScope")], {StringEquals: {
        "aws:CalledViaFirst": "cloudformation.amazonaws.com", "iam:PassedToService": "lambda.amazonaws.com"}}),
    ]}}};
}
function validateBindings(binding, config) {
  try {
    if (!keys(binding, ["schemaVersion", "service", "environment", "account", "stackId", "package", "record", "runtime"])
      || binding.schemaVersion !== 1 || binding.service !== "api-runtime" || binding.environment !== "test"
      || typeof binding.account !== "string" || !/^[0-9]{12}$/.test(binding.account) || binding.account !== config.account
      || sha(binding.account) !== config.anchors.account || hash(binding) !== config.expectedBindingSha256
      || sha(binding.stackId) !== config.expectedStackSha256
      || !new RegExp(`^arn:aws:cloudformation:us-east-1:${binding.account}:stack/${TARGET.service}/[A-Za-z0-9-]+$`).test(binding.stackId)
      || !keys(binding.runtime, ["apiId", "authStackId", "routesRecord"]) || !/^[a-z0-9]{8,12}$/.test(binding.runtime.apiId)
      || !new RegExp(`^arn:aws:cloudformation:us-east-1:${binding.account}:stack/zoolanding-auth-admin-test/[A-Za-z0-9-]+$`).test(binding.runtime.authStackId)) fail();
    const objects = [[binding.package, "thn-runtime", ".zip", true], [binding.record, "first-provisioning", ".json", true],
      [binding.runtime.routesRecord, "retained-routes", ".json", false]];
    for (const [item, prefix, extension, versioned] of objects) {
      if (!keys(item, versioned ? ["bucket", "key", "versionId"] : ["bucket", "key"]) || item.bucket !== config.channelBucket
        || typeof item.bucket !== "string" || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(item.bucket)
        || typeof item.key !== "string" || !/^[A-Za-z0-9_./-]{1,1024}$/.test(item.key)
        || !item.key.startsWith(TARGET.service + "/" + prefix + "/") || !item.key.endsWith(extension)
        || item.key.split("/").some(part => !part || part === "." || part === "..")
        || (versioned && (typeof item.versionId !== "string" || !/^[A-Za-z0-9_.+/-]{1,1024}$/.test(item.versionId) || item.versionId === "null"))) fail();
    }
    const apiArn = `arn:aws:apigateway:us-east-1::/restapis/${binding.runtime.apiId}`;
    const values = {StackArn: binding.stackId, AuthStackArn: binding.runtime.authStackId,
      // CloudFormation assigns suffixes and may truncate generated names. The
      // narrow THN-only namespace is fixed here; a caller cannot select a role.
      FunctionArnScope: `arn:aws:lambda:us-east-1:${binding.account}:function:${TARGET.service}-ThnAuthRuntimeV2*`,
      RoleArnScope: `arn:aws:iam::${binding.account}:role/${TARGET.service}-ThnAuthRuntimeV2*`,
      RestApiArn: apiArn, DeploymentArn: apiArn + "/deployments", DeploymentReadScope: apiArn + "/deployments/*",
      StageArn: apiArn + "/stages/Prod", ExportReadScope: apiArn + "/stages/Prod/exports/*",
      RoutesRecordObjectArn: `arn:aws:s3:::${binding.runtime.routesRecord.bucket}/${binding.runtime.routesRecord.key}`};
    for (const name of ["Package", "Record"]) {
      const item = binding[name.toLowerCase()]; values[name + "ObjectArn"] = `arn:aws:s3:::${item.bucket}/${item.key}`;
      values[name + "VersionId"] = item.versionId;
    }
    return Object.fromEntries(Object.entries(values).map(([key, value]) => [TARGET.prefix + key, value]));
  } catch { fail(); }
}
module.exports = {TARGET, parameterDefinitions, policyResource, validateBindings};
