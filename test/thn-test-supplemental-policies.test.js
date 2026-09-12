"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const cdk = require("aws-cdk-lib");
const { ServiceRepositoryBootstrapStack } = require("../lib/stacks/service-repository-bootstrap-stack");
const { environments } = require("../config/environments");
const { canonical, sha } = require("../tools/thn-test-prerequisites");

function synth(name) {
  const environment = environments.find(e => e.name === name);
  const stack = new ServiceRepositoryBootstrapStack(new cdk.App(), `SupplementTest${name}`, {
    env: { account: environment.account, region: environment.region }, environment,
  });
  return cdk.assertions.Template.fromStack(stack).toJSON();
}
const ids = ["ThnTestHubSupplementalPolicy", "ThnTestImageCallerSupplementalPolicy", "ThnTestImageExecutorSupplementalPolicy"];
const roles = ["zoolanding-content-hub-test-deploy", "zoolanding-deployer-image-upload-test-github-deploy", "zoolanding-deployer-image-upload-test-cfn-exec"];

test("TEST adds only three separate policies and preserves every pre-existing synthesized value", () => {
  const template = synth("test");
  // The independent recovery revision is proved exactly before removing it
  // from this older three-supplement baseline assertion. Never reset the
  // original hash or weaken the initial-only dispatcher's change-set guard.
  const recovery = require("../tools/thn-test-recovery-permission-policy");
  const recoveryRole = Object.entries(template.Resources).filter(([, r]) =>
    r.Type === "AWS::IAM::Role" && r.Properties?.RoleName === recovery.TARGETS.api.role);
  assert.equal(recoveryRole.length, 1);
  for (const selection of ["api", "api-runtime"]) {
    assert.deepEqual(template.Resources[recovery.TARGETS[selection].logical], {
      ...recovery.policyResource(selection), DependsOn: [recoveryRole[0][0]],
    });
    delete template.Resources[recovery.TARGETS[selection].logical];
    for (const [name, definition] of Object.entries(recovery.parameterDefinitions(selection))) {
      assert.deepEqual(template.Parameters[name], definition);
      delete template.Parameters[name];
    }
  }
  assert.equal(Object.values(template.Resources).filter(r => r.Type === "AWS::IAM::RolePolicy").length, 3);
  for (let i = 0; i < ids.length; i++) {
    assert.equal(template.Resources[ids[i]].Properties.RoleName, roles[i]);
    delete template.Resources[ids[i]];
  }
  assert.equal(sha(canonical(template)), "5c744add89c5fc9a6ba0c0c4c7a30ff171dc9b8e6e6869846e6ee1e52021cb7c");
});

test("production synthesis is byte-equivalent to the independently captured baseline", () => {
  assert.equal(sha(canonical(synth("production"))), "f3410fd8e3bcfbb38a2d8370800e30cc22fb744e7cbcb0c6ff9faf2ac97a99ff");
});

test("supplements contain neither broad actions nor direct application-data writes", () => {
  const template = synth("test");
  for (const id of ids) {
    assert.ok(template.Resources[id], `missing ${id}`);
    const document = template.Resources[id].Properties.PolicyDocument;
    for (const statement of document.Statement) {
      assert.equal(statement.Effect, "Allow");
      assert.ok(Array.isArray(statement.Action));
      assert.ok(Array.isArray(statement.Resource));
      for (const action of statement.Action) {
        assert.doesNotMatch(action, /\*|^(secretsmanager|cognito-idp):|^dynamodb:(PutItem|UpdateItem|DeleteItem|Query|Scan|Transact)|^lambda:Invoke|^s3:(PutObject|DeleteObject)|^events:/);
      }
      for (const resource of statement.Resource) {
        assert.notEqual(resource, "*");
        const text = typeof resource === "string" ? resource : resource["Fn::Sub"];
        assert.equal(typeof text, "string");
        assert.doesNotMatch(text, /:role\/(zoolanding-deployer-|zoolanding-content-hub-test-deploy)|production|zoositioweb/);
        if (text.includes("*")) assert.match(text, /:stack\/zoolanding-(?:image-upload|auth-admin)-test\/\*$/);
      }
    }
  }
});

test("Image caller remains read-only except exact-stack protection while executor gains aliases", () => {
  const template = synth("test");
  assert.ok(template.Resources[ids[1]], "missing caller supplement");
  const caller = template.Resources[ids[1]].Properties.PolicyDocument.Statement.flatMap(s => s.Action);
  assert.deepEqual([...new Set(caller)].sort(), ["cloudformation:GetTemplate", "cloudformation:UpdateTerminationProtection",
    "dynamodb:DescribeTable", "dynamodb:DescribeContinuousBackups", "lambda:GetAlias", "lambda:GetFunctionConcurrency",
    "s3:GetBucketVersioning", "s3:GetBucketPublicAccessBlock", "s3:GetEncryptionConfiguration"].sort());
  const executor = template.Resources[ids[2]].Properties.PolicyDocument.Statement.flatMap(s => s.Action);
  assert.ok(executor.includes("lambda:DeleteAlias"), "native alias rollback needs DeleteAlias");
  assert.ok(executor.includes("lambda:GetProvisionedConcurrencyConfig"), "native alias read needs concurrency metadata");
  assert.ok(executor.includes("s3:GetBucketCORS"), "native private bucket read needs configuration metadata");
  assert.ok(executor.includes("dynamodb:DescribeContributorInsights"), "native private table read needs metadata");
});

test("Hub supplemental IAM mutations require CloudFormation forward access; direct operator preflight is read-only", () => {
  const statements = synth("test").Resources[ids[0]].Properties.PolicyDocument.Statement;
  for (const statement of statements.filter(s => s.Action.some(a => /^iam:(Create|Delete|Put|Update|Attach|Detach|Pass)/.test(a)))) {
    assert.equal(statement.Condition?.StringEquals?.["aws:CalledViaFirst"], "cloudformation.amazonaws.com");
  }
  const direct = statements.filter(s => s.Action.includes("iam:GetRole") && !s.Condition);
  assert.equal(direct.length, 1);
  assert.deepEqual(direct[0].Action, ["iam:GetRole"]);
  assert.equal(direct[0].Resource.length, 2);
});

test("all three supplements fit alongside the independently measured original inline policies", () => {
  const { resolvedPolicy } = require("../tools/thn-test-permissions");
  const baselineCharacters = [3423, 1964, 3768];
  const template = synth("test");
  for (const [index, id] of ids.entries()) {
    const length = JSON.stringify(resolvedPolicy(template.Resources[id].Properties.PolicyDocument, "123456789012")).replace(/\s/g, "").length;
    assert.ok(baselineCharacters[index] + length <= 10240, `${id} exceeds the aggregate role inline-policy quota`);
  }
});
