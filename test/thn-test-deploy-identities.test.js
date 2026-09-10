"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const cdk = require("aws-cdk-lib");
const { ServiceRepositoryBootstrapStack } = require("../lib/stacks/service-repository-bootstrap-stack");
const { environments } = require("../config/environments");

function synth(name) {
  const environment = environments.find(e => e.name === name);
  const app = new cdk.App();
  const stack = new ServiceRepositoryBootstrapStack(app, `IdentityTest${name}`, {
    env: { account: environment.account, region: environment.region }, environment,
  });
  return cdk.assertions.Template.fromStack(stack).toJSON();
}

test("THN deploy identities exist only in TEST and require exact repo, environment and ref", () => {
  const template = synth("test");
  const production = synth("production");
  for (const service of ["api-proxy", "image-upload"]) {
    const name = `zoolanding-deployer-${service}-test-github-deploy`;
    const role = Object.values(template.Resources).find(r => r.Properties?.RoleName === name);
    assert.ok(role, `missing ${name}`);
    assert.equal(role.DeletionPolicy, "Retain");
    const condition = role.Properties.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals;
    assert.equal(condition["token.actions.githubusercontent.com:sub"], `repo:LynxPardelle/zoolanding-${service}:environment:test`);
    assert.equal(condition["token.actions.githubusercontent.com:ref"], "refs/heads/test");
    assert.equal(condition["token.actions.githubusercontent.com:aud"], "sts.amazonaws.com");
    assert.ok(!JSON.stringify(production).includes(name));
  }
});

test("THN GitHub roles can only pass their matching CloudFormation role", () => {
  const template = synth("test");
  for (const service of ["api-proxy", "image-upload"]) {
    const entry = Object.entries(template.Resources).find(([,r]) => r.Properties?.RoleName === `zoolanding-deployer-${service}-test-github-deploy`);
    assert.ok(entry);
    const statements = Object.values(template.Resources)
      .filter(r => r.Type === "AWS::IAM::Policy" && r.Properties.Roles.some(v => v.Ref === entry[0]))
      .flatMap(r => r.Properties.PolicyDocument.Statement);
    const actions = s => Array.isArray(s.Action) ? s.Action : [s.Action];
    assert.equal(statements.filter(s => actions(s).includes("iam:PassRole")).length, 1);
    for (const s of statements) {
      assert.ok(!actions(s).some(a => /^(lambda|dynamodb|cognito-idp|secretsmanager):/.test(a) && a !== "lambda:GetFunctionConfiguration"));
      assert.ok(!actions(s).some(a => a === "*" || a.endsWith(":*")));
    }
    const create = statements.find(s => actions(s).includes("cloudformation:CreateChangeSet"));
    assert.ok(create.Condition.ArnEquals["cloudformation:RoleArn"]);
  }
});
