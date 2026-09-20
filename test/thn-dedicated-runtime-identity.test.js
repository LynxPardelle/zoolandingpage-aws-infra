"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const cdk = require("aws-cdk-lib");
const { ServiceRepositoryBootstrapStack } = require("../lib/stacks/service-repository-bootstrap-stack");
const { environments } = require("../config/environments");

function synth(name) {
  const environment = environments.find(value => value.name === name);
  const app = new cdk.App();
  const stack = new ServiceRepositoryBootstrapStack(app, `ThnDedicatedIdentity${name}`, {
    env: { account: environment.account, region: environment.region }, environment,
  });
  return cdk.assertions.Template.fromStack(stack).toJSON();
}

function namedResource(template, name) {
  return Object.entries(template.Resources).find(([, value]) => value.Properties?.RoleName === name);
}

function namedPolicy(template, name) {
  return Object.values(template.Resources).find(value =>
    value.Properties?.PolicyName === name || value.Properties?.ManagedPolicyName === name);
}

test("dedicated runtime has a separate CloudFormation execution role only in TEST", () => {
  const template = synth("test");
  const production = synth("production");
  const name = "zoolanding-deployer-thn-auth-runtime-test-cfn-exec";
  const entry = namedResource(template, name);
  assert.ok(entry, "dedicated CloudFormation role is missing");
  assert.equal(entry[1].Type, "AWS::IAM::Role");
  assert.equal(entry[1].DeletionPolicy, "Retain");
  assert.equal(entry[1].Properties.AssumeRolePolicyDocument.Statement[0].Principal.Service,
    "cloudformation.amazonaws.com");
  assert.ok(!JSON.stringify(production).includes(name));
});

test("GitHub may create and execute only the new stack with its own role", () => {
  const template = synth("test");
  const role = namedResource(template, "zoolanding-deployer-thn-auth-runtime-test-cfn-exec");
  const policy = namedPolicy(template, "ThnDedicatedRuntimeTestGithubV1");
  assert.ok(role && policy);
  assert.equal(policy.Type, "AWS::IAM::ManagedPolicy");
  const statements = policy.Properties.PolicyDocument.Statement;
  const create = statements.find(value => value.Action.includes("cloudformation:CreateChangeSet"));
  assert.ok(create);
  assert.deepEqual(create.Condition.ArnEquals["cloudformation:RoleArn"], { "Fn::GetAtt": [role[0], "Arn"] });
  for (const statement of statements.filter(value => value.Action.some(action => action.startsWith("cloudformation:")))) {
    assert.ok(JSON.stringify(statement.Resource).includes("zoolanding-thn-auth-runtime-test"));
    assert.ok(!JSON.stringify(statement.Resource).includes("zoolanding-api-proxy-test"));
  }
  const pass = statements.find(value => value.Action.includes("iam:PassRole"));
  assert.ok(pass);
  assert.deepEqual(pass.Resource, [{ "Fn::GetAtt": [role[0], "Arn"] }]);
  const packageRead = statements.find(value => value.Action.includes("s3:GetObjectVersion"));
  assert.ok(packageRead, "caller needs read-back of only the dedicated package prefix");
  assert.ok(JSON.stringify(packageRead.Resource).includes("zoolanding-api-proxy-test/thn-runtime/*"));
  assert.ok(!packageRead.Action.includes("s3:PutObject"));
  const functionRead = statements.find(value => value.Action.includes("lambda:GetFunction"));
  assert.ok(functionRead, "caller needs the unchanged dedicated Lambda read scope");
  assert.ok(JSON.stringify(functionRead.Resource).includes("zoolanding-thn-auth-runtime-test-*"),
    "this revision must not modify the separate GitHub policy");
});

test("execution role's app resources stay in the dedicated stack namespace", () => {
  const template = synth("test");
  const policy = namedPolicy(template, "ThnDedicatedRuntimeTestExecutionV1");
  assert.ok(policy);
  const statements = policy.Properties.PolicyDocument.Statement;
  assert.ok(!statements.some(value => value.Action.some(action => action.startsWith("cloudformation:"))),
    "native template deployment must not grant transform or nested-stack rights");
  assert.ok(statements.some(value => value.Action.includes("lambda:CreateFunction")));
  assert.ok(statements.some(value => value.Action.includes("iam:CreateRole")));
  assert.ok(statements.some(value => value.Action.includes("logs:CreateLogGroup")));
  for (const statement of statements) {
    const actions = statement.Action;
    if (actions.some(action => action.startsWith("lambda:") || action.startsWith("iam:") || action.startsWith("logs:"))) {
      assert.ok(JSON.stringify(statement.Resource).includes("zoolanding-thn-auth-runti*"));
      assert.ok(!JSON.stringify(statement.Resource).includes("zoolanding-api-proxy-test"));
    }
  }
});

test("execution resources cover CloudFormation-truncated names without covering Auth Admin", () => {
  const policy = namedPolicy(synth("test"), "ThnDedicatedRuntimeTestExecutionV1");
  const statements = policy.Properties.PolicyDocument.Statement;
  const arn = statement => statement.Resource[0]["Fn::Join"][1].map(part => {
    if (typeof part === "string") return part;
    assert.deepEqual(part, { Ref: "AWS::Partition" });
    return "aws";
  }).join("");
  const roleArn = arn(statements.find(value => value.Action.includes("iam:CreateRole")));
  const lambdaArn = arn(statements.find(value => value.Action.includes("lambda:CreateFunction")));
  const logArn = arn(statements.find(value => value.Action.includes("logs:CreateLogGroup")));
  const matches = (pattern, arn) => pattern.endsWith("*") && arn.startsWith(pattern.slice(0, -1));

  assert.ok(matches(roleArn, "arn:aws:iam::765932874577:role/zoolanding-thn-auth-runti-ThnAuthRuntimeV2FunctionR-example"));
  assert.ok(matches(lambdaArn, "arn:aws:lambda:us-east-1:765932874577:function:zoolanding-thn-auth-runtime-test-ThnAuthRuntimeV2Function-example"));
  assert.ok(matches(logArn, "arn:aws:logs:us-east-1:765932874577:log-group:/aws/lambda/zoolanding-thn-auth-runti-ThnAuthRuntimeV2Function-example"));
  for (const pattern of [roleArn, lambdaArn, logArn]) {
    assert.ok(!matches(pattern, pattern.replace("zoolanding-thn-auth-runti*", "zoolanding-thn-auth-admin-test-example")));
  }
});
