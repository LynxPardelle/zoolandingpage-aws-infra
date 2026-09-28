"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { createHash } = require("node:crypto");
const file = path.join(__dirname, "../tools/thn-test-recovery-permission-policy.js");
const sha = value => createHash("sha256").update(value).digest("hex");
const sorted = x => Array.isArray(x) ? x.map(sorted) : x && typeof x === "object"
  ? Object.fromEntries(Object.keys(x).sort().map(k => [k, sorted(x[k])])) : x;
const hash = value => sha(JSON.stringify(sorted(value)));
const api = () => { assert.ok(fs.existsSync(file), "missing recovery permission policy factory"); return require(file); };
const { fixture, original, account } = require("./fixtures/thn-recovery-bindings");
for (const service of ["config", "api"]) {
  test(`${service}: only exact versioned objects and exact TEST resources`, () => {
    const module = api(), { binding, config } = fixture(service);
    const values = module.validateBindings(binding, config);
    const document = module.resolve(module.policyResource(service).Properties.PolicyDocument, values);
    const reads = document.Statement.filter(s => s.Action.includes("s3:GetObjectVersion"));
    assert.equal(reads.length, 2);
    for (const [index, key] of ["package", "record"].entries()) {
      assert.deepEqual(reads[index].Resource, [`arn:aws:s3:::${binding[key].bucket}/${binding[key].key}`]);
      assert.deepEqual(reads[index].Condition, { StringEquals: { "s3:VersionId": binding[key].versionId } });
    }
    const meta = document.Statement.find(s => s.Action.includes("cloudformation:GetTemplate"));
    assert.deepEqual(meta.Resource, [binding.stackId]);
    assert.ok(!JSON.stringify(document).includes("production"));
    assert.ok(!document.Statement.some(s => s.Action.some(a => /Delete|PutObject|iam:|ListBucket|UpdateStack|CreateRole/.test(a))));
    const composed = module.composeTemplate(original(service), service);
    assert.deepEqual(composed.Resources.ExistingRole, original(service).Resources.ExistingRole);
    assert.deepEqual(composed.Resources.OriginalPolicy, original(service).Resources.OriginalPolicy);
    assert.deepEqual(composed.Outputs, original(service).Outputs);
    assert.equal(Object.keys(composed.Resources).length, 3);
    for (const [name, p] of Object.entries(module.parameterDefinitions(service))) {
      assert.equal(p.NoEcho, true);
      assert.equal(p.Type, "String");
      assert.equal(p.Default, undefined);
      assert.deepEqual(composed.Parameters[name], p);
    }
    assert.equal(JSON.stringify(composed).includes("original-version"), false);
    assert.throws(() => module.composeTemplate(composed, service), /recovery_permission/);
  });
}

test("API: no-role CreateChangeSet and CF-mediated update of exactly three functions", () => {
  const module = api(), { binding, config } = fixture("api");
  const document = module.resolve(module.policyResource("api").Properties.PolicyDocument, module.validateBindings(binding, config));
  const create = document.Statement.find(s => s.Action.includes("cloudformation:CreateChangeSet"));
  assert.deepEqual(create.Resource, [binding.stackId]);
  assert.deepEqual(create.Condition, { Null: { "cloudformation:RoleArn": "true" },
    StringLike: { "cloudformation:ChangeSetName": "aws-recovery-*" } });
  const update = document.Statement.find(s => s.Action.includes("lambda:UpdateFunctionCode"));
  assert.deepEqual(update.Resource, Object.values(binding.functions));
  assert.deepEqual(update.Condition, { StringEquals: { "aws:CalledViaFirst": "cloudformation.amazonaws.com" } });
  assert.ok(!document.Statement.some(s => s.Action.includes("lambda:UpdateFunctionCode") && !s.Condition));
  assert.deepEqual(document.Statement.find(s => s.Action.includes("lambda:GetFunction")).Resource, Object.values(binding.functions));
  assert.deepEqual(document.Statement.find(s => s.Action.includes("lambda:GetFunctionConfiguration"))?.Resource, Object.values(binding.functions));
  assert.deepEqual(document.Statement.find(s => s.Action.includes("lambda:ListTags"))?.Resource, Object.values(binding.functions),
    "tagged original functions require the same exact read dependency");
  assert.ok(document.Statement.find(s => s.Action.includes("cloudformation:ListStackResources")), "the actual baseline observer lists the existing stack inventory");
});

test("API: accepts independently anchored provider names without guessing full logical IDs", () => {
  const { binding, config } = fixture("api"), module = api();
  assert.ok(!binding.functions.AuthProvisioningExecutorFunction.includes("-AuthProvisioningExecutorFunction-"));
  assert.ok(!binding.functions.AuthJwtAuthorizerFunction.includes("-AuthJwtAuthorizerFunction-"));
  const values = module.validateBindings(binding, config);
  const document = module.resolve(module.policyResource("api").Properties.PolicyDocument, values);
  assert.deepEqual(document.Statement.find(s => s.Action.includes("lambda:UpdateFunctionCode")).Resource,
    module.FUNCTIONS.map(name => binding.functions[name]));
  assert.ok(document.Statement.every(s => s.Resource.every(r => !r.includes("*"))));
});

test("API: rebinding a reviewed ledger does not accept an unanchored or swapped function", () => {
  for (const mutate of [
    b => b.functions.AuthProvisioningExecutorFunction += "x",
    b => { [b.functions.AuthProvisioningExecutorFunction, b.functions.AuthJwtAuthorizerFunction] =
      [b.functions.AuthJwtAuthorizerFunction, b.functions.AuthProvisioningExecutorFunction]; },
  ]) {
    const { binding, config } = fixture("api"); mutate(binding); config.expectedBindingSha256 = hash(binding);
    assert.throws(() => api().validateBindings(binding, config), /recovery_permission/);
  }
});

test("API: rejects missing, incomplete or extra independent function anchors", () => {
  for (const mutate of [
    anchors => delete anchors.api.functions,
    anchors => delete anchors.api.functions.AuthJwtAuthorizerFunction,
    anchors => anchors.api.functions.UnreviewedFunction = "f".repeat(64),
    anchors => anchors.api.functions.ApiProxyFunction = "g".repeat(64),
  ]) {
    const { binding, config } = fixture("api"); mutate(config.anchors);
    assert.throws(() => api().validateBindings(binding, config), /recovery_permission/);
  }
});

test("API: even an anchored function must be an unqualified same-account regional Lambda ARN", () => {
  for (const replacement of [
    `arn:aws:lambda:us-west-2:${account}:function:synthetic`,
    "arn:aws:lambda:us-east-1:999999999999:function:synthetic",
    `arn:aws:lambda:us-east-1:${account}:function:synthetic:live`,
    `arn:aws:lambda:us-east-1:${account}:function:${"x".repeat(65)}`,
  ]) {
    const { binding, config } = fixture("api");
    binding.functions.ApiProxyFunction = replacement;
    config.anchors.api.functions.ApiProxyFunction = sha(replacement);
    config.expectedBindingSha256 = hash(binding);
    assert.throws(() => api().validateBindings(binding, config), /recovery_permission/);
  }
});

test("binding rejects foreign service, account, original bytes selector, version or reviewed digest", () => {
  for (const mutate of [b => b.environment = "production", b => b.service = "config", b => b.account = "999999999999",
    b => b.stackId += "-foreign", b => b.package.key = "other/key", b => b.package.versionId = "newer",
    b => b.record.versionId = "null", b => b.record.key = "other-draft/snapshot.json",
    b => b.record.bucket = "foreign-channel", b => b.functions.ApiProxyFunction += ":test", b => b.extra = true]) {
    const { binding, config } = fixture("api"); mutate(binding);
    config.expectedBindingSha256 = hash(binding);
    assert.throws(() => api().validateBindings(binding, config), /recovery_permission/);
  }
});

test("owning source preserves hooks in Config Frontend and API Bootstrap only", () => {
  const frontend = fs.readFileSync(path.join(__dirname, "../lib/stacks/frontend-stack.js"), "utf8");
  const apiIdentities = fs.readFileSync(path.join(__dirname, "../lib/stacks/thn-test-deploy-identities.js"), "utf8");
  assert.match(frontend, /addCanonicalPolicy\(scope, environment, "config", role\.node\.defaultChild\)/);
  assert.match(apiIdentities, /addCanonicalPolicy\(scope, environment, "api", github\.node\.defaultChild\)/);
});

test("role snapshot preserves original policy and trust, rejects overflow or existing addition", () => {
  const module = api(), { binding, config } = fixture("api");
  const name = module.TARGETS.api.role;
  const role = { Role: { RoleName: name, Arn: `arn:aws:iam::${account}:role/${name}`, Path: "/",
    RoleId: "AROA" + "Q".repeat(16), AssumeRolePolicyDocument: { Statement: [] } },
    inline: { Existing: { Statement: [] } }, attached: [] };
  const doc = module.resolve(module.policyResource("api").Properties.PolicyDocument, module.validateBindings(binding, config));
  assert.deepEqual(module.roleSnapshot(role, "api", account, doc), role);
  role.inline.Existing.Statement.push({ Effect: "Allow", Action: "read", Resource: "x".repeat(11000) });
  assert.throws(() => module.roleSnapshot(role, "api", account, doc), /recovery_permission/);
});

test("canonical hooks are TEST-only and identical to exact-template additions", () => {
  const module = api(), cdk = require("aws-cdk-lib");
  for (const service of ["config", "api"]) {
    const app = new cdk.App(), scope = new cdk.Stack(app, service);
    const role = new cdk.CfnResource(scope, "ExistingRole", { type: "AWS::IAM::Role",
      properties: original(service).Resources.ExistingRole.Properties });
    role.overrideLogicalId("ExistingRole");
    module.addCanonicalPolicy(scope, { name: "test" }, service, role);
    const prod = new cdk.Stack(app, `${service}Prod`);
    const control = new cdk.Stack(app, `${service}Control`);
    for (const stack of [prod, control]) {
      const existing = new cdk.CfnResource(stack, "Keep", { type: "AWS::CloudFormation::WaitConditionHandle" });
      existing.overrideLogicalId("Keep");
    }
    module.addCanonicalPolicy(prod, { name: "production" }, service, role);
    const synthesized = require("aws-cdk-lib/assertions").Template.fromStack(scope).toJSON();
    assert.deepEqual(synthesized.Resources[module.TARGETS[service].logical], module.composeTemplate(original(service), service).Resources[module.TARGETS[service].logical]);
    assert.deepEqual(require("aws-cdk-lib/assertions").Template.fromStack(prod).toJSON(),
      require("aws-cdk-lib/assertions").Template.fromStack(control).toJSON());
  }
});
