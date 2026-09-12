"use strict";
const { canonical, sha } = require("./thn-test-prerequisites");
const runtime = require("./thn-test-api-runtime-permission-policy");
const TARGETS = Object.freeze({
  "api-runtime": runtime.TARGET,
  config: { role: "zoolanding-config-authoring-test-deploy", logical: "ThnConfigTestRecoveryPolicy",
    prefix: "ThnConfigRecovery", service: "zoolanding-config-authoring-test", owner: "certificate" },
  api: { role: "zoolanding-deployer-api-proxy-test-github-deploy", logical: "ThnApiTestRecoveryPolicy",
    prefix: "ThnApiRecovery", service: "zoolanding-api-proxy-test", owner: "operator-role" },
});
const POLICY_NAME = "ThnTestObservedRecoveryV1";
const FUNCTIONS = ["ApiProxyFunction", "AuthProvisioningExecutorFunction", "AuthJwtAuthorizerFunction"];
const BINDING_ANCHORS = Object.freeze({
  account: "3e19eeb25ac142d015c5a4d347dc58784b0a79a124f1353b5e92d90673810a8f",
  config: { selector: "f4cb00cadf1f687b7c5296411ebcd26047bc914fa07eb0c94fef1c16331d1050",
    version: "6984afadd24127cc007a9cdcc387984f50305189ac4e88ff101d81b76a696ea3" },
  api: { selector: "1a860d67a954ad8ceb0786421cb2b62a796f9eab54f436544d3739536ca1c4c0",
    version: "3ded86cf20709eb9cffe17774eb1361544d70581bcbb91bdb4969cbeaf3d4e13" },
});
const fail = () => { throw new Error("thn_recovery_permission_guard_failed"); };
const object = v => v !== null && typeof v === "object" && !Array.isArray(v);
const same = (a, b) => canonical(a) === canonical(b);
const keys = (v, expected) => object(v) && same(Object.keys(v).sort(), [...expected].sort());
const hash = v => sha(canonical(v));
const ref = name => ({ Ref: name });
function target(service) { if (!Object.hasOwn(TARGETS, service)) fail(); return TARGETS[service]; }
function policyName(service) { return target(service).policyName || POLICY_NAME; }

function parameterDefinitions(service) {
  if (service === "api-runtime") return runtime.parameterDefinitions();
  const { prefix } = target(service);
  return Object.fromEntries(["StackArn", "PackageObjectArn", "PackageVersionId", "RecordObjectArn", "RecordVersionId",
    ...(service === "api" ? FUNCTIONS.map(n => n + "Arn") : [])].map(name => [prefix + name,
    { Type: "String", NoEcho: true, MinLength: 1, MaxLength: 2048 }]));
}

function policyResource(service) {
  if (service === "api-runtime") return runtime.policyResource();
  const { role, prefix } = target(service);
  const statement = (Action, Resource, Condition) => ({ Effect: "Allow", Action, Resource, ...(Condition ? { Condition } : {}) });
  const read = name => statement(["s3:GetObjectVersion"], [ref(prefix + name + "ObjectArn")],
    { StringEquals: { "s3:VersionId": ref(prefix + name + "VersionId") } });
  const statements = [read("Package"), read("Record"),
    statement(["cloudformation:GetTemplate", "cloudformation:ListStackResources"], [ref(prefix + "StackArn")])];
  if (service === "api") {
    const functions = FUNCTIONS.map(n => ref(prefix + n + "Arn"));
    statements.push(statement(["cloudformation:CreateChangeSet"], [ref(prefix + "StackArn")], {
      Null: { "cloudformation:RoleArn": "true" }, StringLike: { "cloudformation:ChangeSetName": "aws-recovery-*" } }),
    statement(["lambda:GetFunction", "lambda:ListTags", "lambda:GetFunctionConfiguration"], functions),
    statement(["lambda:UpdateFunctionCode"], functions, { StringEquals: { "aws:CalledViaFirst": "cloudformation.amazonaws.com" } }));
  }
  return { Type: "AWS::IAM::RolePolicy", Properties: { RoleName: role, PolicyName: POLICY_NAME,
    PolicyDocument: { Version: "2012-10-17", Statement: statements } } };
}

function validateBindings(binding, config) {
  if (config.service === "api-runtime") return runtime.validateBindings(binding, {...config, anchors: config.anchors || BINDING_ANCHORS});
  try {
    const service = config.service, selected = target(service), anchors = config.anchors || BINDING_ANCHORS;
    if (!keys(binding, ["schemaVersion", "service", "environment", "account", "stackId", "package", "record", "functions"])
      || binding.schemaVersion !== 1 || binding.service !== service || binding.environment !== "test"
      || !/^[0-9]{12}$/.test(binding.account) || binding.account !== config.account || sha(binding.account) !== anchors.account
      || hash(binding) !== config.expectedBindingSha256 || sha(binding.stackId) !== config.expectedStackSha256
      || !new RegExp(`^arn:aws:cloudformation:us-east-1:${binding.account}:stack/${selected.service}/[A-Za-z0-9-]+$`).test(binding.stackId)) fail();
    for (const item of [binding.package, binding.record]) {
      if (!keys(item, ["bucket", "key", "versionId"]) || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(item.bucket)
        || typeof item.key !== "string" || !/^[A-Za-z0-9_./-]{1,1024}$/.test(item.key)
        || item.key.split("/").some(s => !s || s === "." || s === "..") || typeof item.versionId !== "string"
        || !/^[A-Za-z0-9_.+/-]{1,1024}$/.test(item.versionId) || item.versionId === "null") fail();
    }
    if (hash({ Bucket: binding.package.bucket, Key: binding.package.key }) !== anchors[service].selector
      || sha(binding.package.versionId) !== anchors[service].version || binding.record.bucket !== config.channelBucket
      || !(service === "config"
        ? /^system\/deploy-artifacts\/[a-f0-9]{40}\/[1-9][0-9]*\/[1-9][0-9]*\/aws-live-snapshot\.json$/.test(binding.record.key)
        : binding.record.key.startsWith(selected.service + "/"))
      || same([binding.package.bucket, binding.package.key], [binding.record.bucket, binding.record.key])
      || !keys(binding.functions, service === "api" ? FUNCTIONS : [])) fail();
    const values = { [selected.prefix + "StackArn"]: binding.stackId };
    for (const name of ["Package", "Record"]) {
      const item = binding[name.toLowerCase()];
      values[selected.prefix + name + "ObjectArn"] = `arn:aws:s3:::${item.bucket}/${item.key}`;
      values[selected.prefix + name + "VersionId"] = item.versionId;
    }
    for (const name of service === "api" ? FUNCTIONS : []) {
      if (!new RegExp(`^arn:aws:lambda:us-east-1:${binding.account}:function:${selected.service}-${name}-[A-Za-z0-9_-]+$`).test(binding.functions[name])) fail();
      values[selected.prefix + name + "Arn"] = binding.functions[name];
    }
    return values;
  } catch { fail(); }
}

function composeTemplate(original, service) {
  const selected = target(service), definitions = parameterDefinitions(service);
  if (!object(original) || !object(original.Resources) || original.Transform || original.Resources[selected.logical]
    || Object.keys(definitions).some(name => Object.hasOwn(original.Parameters || {}, name))
    || Object.values(original.Resources).some(r => r.Properties?.PolicyName === policyName(service))) fail();
  const roles = Object.entries(original.Resources).filter(([, r]) => r.Type === "AWS::IAM::Role" && r.Properties?.RoleName === selected.role);
  if (roles.length !== 1) fail();
  const result = structuredClone(original);
  result.Parameters = { ...(result.Parameters || {}), ...definitions };
  result.Resources[selected.logical] = { ...policyResource(service), DependsOn: [roles[0][0]] };
  return result;
}

function resolve(value, parameters) {
  if (Array.isArray(value)) return value.map(v => resolve(v, parameters));
  if (object(value)) {
    if (Object.hasOwn(value, "Ref")) {
      if (!keys(value, ["Ref"]) || !Object.hasOwn(parameters, value.Ref) || typeof parameters[value.Ref] !== "string") fail();
      return parameters[value.Ref];
    }
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(v, parameters)]));
  }
  return value;
}

function roleSnapshot(input, service, account, newDocument) {
  const selected = target(service), role = input?.Role;
  if (!keys(input, ["Role", "inline", "attached"]) || role?.RoleName !== selected.role
    || role.Arn !== `arn:aws:iam::${account}:role/${selected.role}` || role.Path !== "/"
    || !/^AROA[A-Z0-9]{16,}$/.test(role.RoleId) || !object(role.AssumeRolePolicyDocument)
    || !object(input.inline) || !Object.keys(input.inline).length || Object.hasOwn(input.inline, policyName(service))
    || !Array.isArray(input.attached) || input.attached.length
    || Object.values(input.inline).some(p => !object(p) || !Array.isArray(p.Statement))
    || [...Object.values(input.inline), newDocument].reduce((n, p) => n + JSON.stringify(p).length, 0) > 10240) fail();
  const result = structuredClone(input);
  delete result.Role.RoleLastUsed;
  if (result.Role.Tags) result.Role.Tags.sort((a, b) => canonical(a).localeCompare(canonical(b)));
  return result;
}

function addCanonicalPolicy(scope, environment, service, role) {
  if (environment.name !== "test") return;
  const cdk = require("aws-cdk-lib"), selected = target(service);
  for (const [name, definition] of Object.entries(parameterDefinitions(service))) {
    const parameter = new cdk.CfnParameter(scope, name, { type: definition.Type, noEcho: true,
      minLength: definition.MinLength, maxLength: definition.MaxLength });
    parameter.overrideLogicalId(name);
  }
  const definition = policyResource(service);
  const policy = new cdk.CfnResource(scope, selected.logical, { type: definition.Type, properties: definition.Properties });
  policy.overrideLogicalId(selected.logical);
  policy.addResourceDependency(role);
}

module.exports = { TARGETS, POLICY_NAME, FUNCTIONS, BINDING_ANCHORS, parameterDefinitions, policyResource, policyName,
  validateBindings, composeTemplate, resolve, roleSnapshot, addCanonicalPolicy };
