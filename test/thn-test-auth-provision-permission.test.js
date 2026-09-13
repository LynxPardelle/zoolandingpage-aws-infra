"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const {canonical, sha} = require("../tools/thn-test-prerequisites");
const policy = require("../tools/thn-test-recovery-permission-policy");
const account = "123456789012", selection = "auth-provision", hash = v => sha(canonical(v));
function fixture() {
  const binding = {schemaVersion: 1, service: selection, environment: "test", account,
    stackId: `arn:aws:cloudformation:us-east-1:${account}:stack/zoolanding-auth-admin-test/12345678-1234-1234-1234-123456789012`,
    releaseCommit: "cbc17c8f560c8586be641faa0abc7c60bd17a698"};
  return {binding, config: {service: selection, account, anchors: {account: sha(account)},
    expectedBindingSha256: hash(binding), expectedStackSha256: sha(binding.stackId)}};
}
function document() {
  assert.ok(policy.TARGETS[selection], "missing bounded Auth provisioning target");
  const {binding, config} = fixture();
  const value = policy.resolve(policy.policyResource(selection).Properties.PolicyDocument, policy.validateBindings(binding, config));
  const size = JSON.stringify(value).length;
  for (const s of value.Statement) {s.Action = [].concat(s.Action); s.Resource = [].concat(s.Resource);}
  return {binding, config, value, size};
}
test("Auth provisioning creates one supplemental policy without adopting the pre-existing manual role", () => {
  document();
  const before = {Parameters: {Keep: {Type: "String", NoEcho: true}}, Resources: {
    Existing: {Type: "AWS::IAM::RolePolicy", Properties: {PolicyName: "unrelated", RoleName: "other"}}}};
  const copy = structuredClone(before), after = policy.composeTemplate(before, selection);
  assert.deepEqual(before, copy); assert.deepEqual(after.Resources.Existing, copy.Resources.Existing);
  const resource = after.Resources.ThnAuthTestProvisioningPolicy;
  assert.equal(resource.Type, "AWS::IAM::RolePolicy"); assert.equal(resource.DependsOn, undefined);
  assert.equal(resource.Properties.RoleName, "zoolanding-auth-admin-test-deploy");
  assert.equal(resource.Properties.PolicyName, "ThnTestClosedProvisioningV1");
  assert.equal(Object.keys(after.Resources).length, 2);
  assert.throws(() => policy.composeTemplate(after, selection));
  before.Resources.AdoptedRole = {Type: "AWS::IAM::Role", Properties: {RoleName: resource.Properties.RoleName}};
  assert.throws(() => policy.composeTemplate(before, selection));
});
test("Cognito creation requires exact stack/logical request tags, region and CloudFormation", () => {
  const {binding, value} = document(), s = value.Statement.find(s => s.Action.includes("cognito-idp:CreateUserPool"));
  assert.deepEqual(s.Action, ["cognito-idp:CreateUserPool"]); assert.deepEqual(s.Resource, ["*"]);
  assert.deepEqual(s.Condition.StringEquals, {"aws:CalledViaFirst": "cloudformation.amazonaws.com", "aws:RequestedRegion": "us-east-1",
    "aws:RequestTag/aws:cloudformation:stack-id": binding.stackId,
    "aws:RequestTag/aws:cloudformation:logical-id": "ThnAuthAdminV2UserPool"});
  for (const st of value.Statement.filter(st => st.Action.includes("cognito-idp:CreateGroup"))) {
    assert.equal(st.Condition.StringEquals["aws:ResourceTag/aws:cloudformation:stack-id"], binding.stackId);
  }
  const read = value.Statement.find(s => s.Action.includes("cognito-idp:DescribeUserPool"));
  assert.equal(read.Condition.StringEquals["aws:ResourceTag/aws:cloudformation:stack-id"], binding.stackId);
  assert.equal(read.Condition.StringEquals["aws:ResourceTag/aws:cloudformation:logical-id"], "ThnAuthAdminV2UserPool");
  assert.equal(read.Condition.StringEquals["aws:CalledViaFirst"], undefined, "closed verifier requires a direct metadata read");
});
test("Auth scope never grants application data, human administration or broad service actions", () => {
  const {value, size} = document();
  for (const s of value.Statement) for (const action of s.Action) {
    assert.ok(!action.includes("*"));
    assert.doesNotMatch(action, /^(s3:|ec2:|kms:|apigateway:|cloudwatch:)/);
    assert.doesNotMatch(action, /Admin|Invoke|GetItem|PutItem|Scan|Query|DeleteTable|DeleteUserPool|GetLogEvents|FilterLogEvents|AttachRolePolicy/);
    if (!/:(Get|List|Describe)/.test(action)) assert.equal(s.Condition.StringEquals["aws:CalledViaFirst"], "cloudformation.amazonaws.com");
    if (s.Resource.includes("*")) assert.ok(["cognito-idp:CreateUserPool", "logs:DescribeLogGroups"].includes(action));
  }
  assert.ok(size + 2514 <= 10240, `supplemental plus observed original must fit inline quota: ${size + 2514}`);
});
test("only the fixed origin-authorizer execution role can be passed, through CF to Lambda", () => {
  const {value} = document(), pass = value.Statement.find(s => s.Action.includes("iam:PassRole"));
  assert.deepEqual(pass.Resource, [`arn:aws:iam::${account}:role/zoolanding-auth-test-ThnV2OriginAuthorizerRole`]);
  assert.deepEqual(pass.Condition, {StringEquals: {"aws:CalledViaFirst": "cloudformation.amazonaws.com", "iam:PassedToService": "lambda.amazonaws.com"}});
});
test("only the exact THN origin-authorizer gets missing function creation and rollback authority", () => {
  const {value} = document(), s = value.Statement.find(s => s.Action.includes("lambda:CreateFunction"));
  assert.deepEqual(s.Resource, [`arn:aws:lambda:us-east-1:${account}:function:zoolanding-auth-test-ThnV2OriginAuthorizer`]);
  assert.ok(s.Action.includes("lambda:DeleteFunction"));
  for (const st of value.Statement.filter(s => s.Action.some(a => a.startsWith("lambda:")))) {
    for (const arn of st.Resource) assert.match(arn, /:function:zoolanding-auth(?:-admin)?-test-Thn/);
  }
});
test("backup settings and audit resource policy affect only dedicated tables", () => {
  const {value} = document(), backup = value.Statement.find(s => s.Action.includes("dynamodb:UpdateContinuousBackups"));
  assert.equal(backup.Resource.length, 5);
  for (const arn of backup.Resource) assert.match(arn, /:table\/zoolanding-auth-admin-test-Thn\w+V2$/);
  assert.deepEqual(value.Statement.find(s => s.Action.includes("dynamodb:PutResourcePolicy")).Resource,
    [`arn:aws:dynamodb:us-east-1:${account}:table/zoolanding-auth-admin-test-ThnAuditV2`]);
});
test("Auth bindings reject rebinding, other environments, extra selectors and release drift", () => {
  document();
  for (const mutate of [b => b.environment = "production", b => b.service = "api", b => b.account = "999999999999",
    b => b.stackId = b.stackId.replace("auth-admin-test", "auth-admin-prod"), b => b.stackId += "/*",
    b => b.releaseCommit = "0".repeat(40), b => b.functions = {}, b => b.poolArn = "unapproved"] ) {
    const {binding, config} = fixture(); mutate(binding); config.expectedBindingSha256 = hash(binding);
    config.expectedStackSha256 = sha(binding.stackId);
    assert.throws(() => policy.validateBindings(binding, config));
  }
  const {binding, config} = fixture(); config.expectedBindingSha256 = "0".repeat(64);
  assert.throws(() => policy.validateBindings(binding, config));
});
test("Auth canonical hook matches native composition and production is a no-op", () => {
  document();
  const cdk = require("aws-cdk-lib"), {Template} = require("aws-cdk-lib/assertions"), app = new cdk.App();
  const scope = new cdk.Stack(app, "AuthTest"), prod = new cdk.Stack(app, "AuthProd"), control = new cdk.Stack(app, "Control");
  for (const stack of [prod, control]) new cdk.CfnResource(stack, "Existing", {type: "AWS::IAM::RolePolicy", properties: {RoleName: "synthetic", PolicyName: "keep"}});
  policy.addCanonicalPolicy(scope, {name: "test"}, selection);
  policy.addCanonicalPolicy(prod, {name: "production"}, selection);
  assert.deepEqual(Template.fromStack(scope).toJSON().Resources.ThnAuthTestProvisioningPolicy,
    policy.composeTemplate({Resources: {}}, selection).Resources.ThnAuthTestProvisioningPolicy);
  assert.deepEqual(Template.fromStack(prod).toJSON(), Template.fromStack(control).toJSON());
  for (const p of Object.values(policy.parameterDefinitions(selection))) {assert.equal(p.NoEcho, true); assert.equal(p.Default, undefined);}
  assert.match(fs.readFileSync(path.join(__dirname, "../lib/stacks/service-repository-bootstrap-stack.js"), "utf8"),
    /addCanonicalPolicy\(this, environment, "auth-provision"\)/);
});
test("Auth dispatch is a distinct private binding and seals its source before credentials", () => {
  const workflow = fs.readFileSync(path.join(__dirname, "../.github/workflows/thn-test-recovery-permissions.yml"), "utf8");
  assert.match(workflow, /options: \[config, api, api-runtime, config-runtime, auth-provision\]/);
  assert.match(workflow, /inputs.service == 'auth-provision' && secrets.THN_AUTH_PROVISION_BINDING_JSON/);
  assert.match(fs.readFileSync(path.join(__dirname, "../tools/thn-test-recovery-permissions.js"), "utf8"), /"thn-test-auth-provision-permission-policy.js"/);
});
