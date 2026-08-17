"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const cdk = require("aws-cdk-lib");

const { ServiceRepositoryBootstrapStack } = require("../lib/stacks/service-repository-bootstrap-stack");
const { ZoolandingpageEnvironmentStage } = require("../lib/zoolandingpage-environment-stage");
const { environments } = require("../config/environments");

const account = "765932874577";
const region = "us-east-1";
const samBucket = "aws-sam-cli-managed-default-samclisourcebucket-obthkeitxden";
const commonInputs = [
  "config/registry-table-name",
  "config/payload-bucket-name",
  "auth/session-table-name",
  "auth/user-state-table-name",
];
const services = {
  "zoolanding-data-spaces": {
    githubInputs: commonInputs,
    cloudFormationInputs: commonInputs,
    cloudFormationNamespaces: [
      "apigateway", "cloudformation", "cloudwatch", "dynamodb", "iam", "lambda", "s3", "ssm",
    ],
    iamGeneratedPrefixLength: 25,
    lambdaGeneratedPrefixLength: 25,
  },
  "zoolanding-commerce": {
    githubInputs: [
      ...commonInputs,
      "services/integrations/api-id",
      "topics/integration-events-arn",
    ],
    cloudFormationInputs: [
      ...commonInputs,
      "services/integrations/api-id",
      "topics/integration-events-arn",
    ],
    cloudFormationNamespaces: [
      "apigateway", "cloudformation", "cloudwatch", "dynamodb", "events", "iam", "lambda",
      "logs", "s3", "sns", "sqs", "ssm",
    ],
    iamGeneratedPrefixLength: 25,
    lambdaGeneratedPrefixLength: 25,
    scheduleGeneratedPrefixLength: 25,
  },
  "zoolanding-integrations": {
    githubInputs: [
      ...commonInputs,
      "services/commerce/integrations-caller-role-arns",
      "services/notifications/smtp-worker-role-arn",
    ],
    cloudFormationInputs: commonInputs,
    cloudFormationNamespaces: [
      "apigateway", "cloudformation", "cloudwatch", "dynamodb", "iam", "lambda", "logs", "s3",
      "sns", "sqs", "ssm",
    ],
    iamGeneratedPrefixLength: 25,
    lambdaGeneratedPrefixLength: 25,
    queueGeneratedPrefixLength: 33,
  },
  "zoolanding-notifications": {
    githubInputs: [
      "topics/commerce-notification-requests-arn",
      "services/integrations/api-id",
    ],
    cloudFormationInputs: [
      "config/registry-table-name",
      "config/payload-bucket-name",
      "topics/commerce-notification-requests-arn",
      "services/integrations/api-id",
    ],
    cloudFormationNamespaces: [
      "cloudformation", "cloudwatch", "dynamodb", "iam", "lambda", "logs", "s3", "sns", "sqs", "ssm",
    ],
    iamGeneratedPrefixLength: 28,
  },
};

function synthesize(environmentName) {
  const environment = environments.find((candidate) => candidate.name === environmentName);
  assert.ok(environment, `missing ${environmentName} environment`);
  assert.equal(environment.serviceRepositoryBootstrap.samArtifactBucketName, samBucket);
  const app = new cdk.App();
  const stack = new ServiceRepositoryBootstrapStack(app, `ServiceRepositoryBootstrap${environmentName}`, {
    env: { account, region },
    environment,
  });
  return cdk.assertions.Template.fromStack(stack).toJSON();
}

function resourcesOfType(template, type) {
  return Object.entries(template.Resources).filter(([, resource]) => resource.Type === type);
}

function findRole(template, roleName) {
  const entry = resourcesOfType(template, "AWS::IAM::Role")
    .find(([, role]) => role.Properties.RoleName === roleName);
  assert.ok(entry, `missing role ${roleName}`);
  return { logicalId: entry[0], resource: entry[1] };
}

function statementsForRole(template, logicalId) {
  return resourcesOfType(template, "AWS::IAM::Policy")
    .filter(([, policy]) => JSON.stringify(policy.Properties.Roles).includes(`\"${logicalId}\"`))
    .flatMap(([, policy]) => policy.Properties.PolicyDocument.Statement);
}

function actions(statement) {
  return Array.isArray(statement.Action) ? statement.Action : [statement.Action];
}

function staticResources(statement) {
  const values = Array.isArray(statement.Resource) ? statement.Resource : [statement.Resource];
  return values.map(renderStaticArn).filter(Boolean);
}

function renderStaticArn(value) {
  if (typeof value === "string") {
    return value;
  }
  const join = value?.["Fn::Join"];
  if (!join || join[0] !== "" || !Array.isArray(join[1])) {
    return undefined;
  }
  return join[1].map((part) => (
    part?.Ref === "AWS::Partition" ? "aws" : part
  )).join("");
}

function ssmArn(environmentName, suffix) {
  return `arn:aws:ssm:${region}:${account}:parameter/zoolanding/${environmentName}/${suffix}`;
}

for (const [environmentName, branch] of [["test", "test"], ["production", "main"]]) {
  test(`service repository bootstrap creates exact retained ${environmentName} identities`, () => {
    const template = synthesize(environmentName);
    const oidcProvider = `arn:aws:iam::${account}:oidc-provider/token.actions.githubusercontent.com`;
    const allPolicies = resourcesOfType(template, "AWS::IAM::Policy")
      .flatMap(([, policy]) => policy.Properties.PolicyDocument.Statement);

    assert.doesNotMatch(JSON.stringify(template), /AdministratorAccess|secretsmanager:/);
    assert.equal(resourcesOfType(template, "AWS::IAM::Role").length, 8);
    assert.equal(Object.keys(template.Outputs).length, 8);

    for (const [repository, expected] of Object.entries(services)) {
      const stackName = `${repository}-${environmentName}`;
      const deployerName = `${repository.replace("zoolanding-", "zoolanding-deployer-")}-${environmentName}`;
      const githubName = `${deployerName}-github-deploy`;
      const cfnName = `${deployerName}-cfn-exec`;
      const github = findRole(template, githubName);
      const cfn = findRole(template, cfnName);

      for (const role of [github.resource, cfn.resource]) {
        assert.equal(role.DeletionPolicy, "Retain");
        assert.equal(role.UpdateReplacePolicy, "Retain");
      }

      const githubTrust = github.resource.Properties.AssumeRolePolicyDocument.Statement;
      assert.deepEqual(githubTrust, [{
        Action: "sts:AssumeRoleWithWebIdentity",
        Condition: {
          StringEquals: {
            "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
            "token.actions.githubusercontent.com:ref": `refs/heads/${branch}`,
            "token.actions.githubusercontent.com:sub": `repo:LynxPardelle/${repository}:environment:${environmentName}`,
          },
        },
        Effect: "Allow",
        Principal: { Federated: oidcProvider },
      }]);
      assert.deepEqual(cfn.resource.Properties.AssumeRolePolicyDocument.Statement, [{
        Action: "sts:AssumeRole",
        Effect: "Allow",
        Principal: { Service: "cloudformation.amazonaws.com" },
      }]);

      const githubStatements = statementsForRole(template, github.logicalId);
      const cfnStatements = statementsForRole(template, cfn.logicalId);
      assert.ok(githubStatements.length > 0, `missing policy for ${githubName}`);
      assert.ok(cfnStatements.length > 0, `missing policy for ${cfnName}`);
      assert.deepEqual(
        [...new Set(cfnStatements.flatMap(actions).map((action) => action.split(":")[0]))].sort(),
        [...expected.cloudFormationNamespaces].sort()
      );
      assert.doesNotMatch(
        JSON.stringify(cfnStatements.flatMap(actions)),
        /dynamodb:(Batch|GetItem|PutItem|Query|Scan|Transact|UpdateItem)|lambda:Invoke|s3:(DeleteObject|ListBucket|PutObject)|sns:Publish|sqs:(DeleteMessage|ReceiveMessage|SendMessage)/
      );

      const stackArn = `arn:aws:cloudformation:${region}:${account}:stack/${stackName}/*`;
      const createChangeSet = githubStatements.find((statement) => (
        actions(statement).includes("cloudformation:CreateChangeSet")
      ));
      assert.equal(renderStaticArn(createChangeSet.Resource), stackArn);
      assert.deepEqual(createChangeSet.Condition, {
        ArnEquals: { "cloudformation:RoleArn": { "Fn::GetAtt": [cfn.logicalId, "Arn"] } },
      });
      const githubCloudFormationResources = githubStatements
        .filter((statement) => actions(statement).some((action) => action.startsWith("cloudformation:")))
        .flatMap(staticResources);
      assert.ok(githubCloudFormationResources.includes(stackArn));
      assert.equal(
        githubCloudFormationResources.some((resource) => resource.includes(`stack/${repository}-`) && resource !== stackArn),
        false
      );

      const bucketArn = `arn:aws:s3:::${samBucket}`;
      const artifactArn = `${bucketArn}/${stackName}/*`;
      const githubS3Resources = githubStatements
        .filter((statement) => actions(statement).some((action) => action.startsWith("s3:")))
        .flatMap(staticResources);
      assert.deepEqual([...new Set(githubS3Resources)].sort(), [artifactArn, bucketArn].sort());
      const listBucket = githubStatements.find((statement) => actions(statement).includes("s3:ListBucket"));
      assert.deepEqual(listBucket.Condition, {
        StringLike: { "s3:prefix": [stackName, `${stackName}/*`] },
      });
      assert.ok(cfnStatements.some((statement) => (
        actions(statement).includes("s3:GetObject") && staticResources(statement).includes(artifactArn)
      )));

      const githubSsm = githubStatements.find((statement) => actions(statement).includes("ssm:GetParameter"));
      assert.deepEqual(
        [...staticResources(githubSsm)].sort(),
        expected.githubInputs.map((suffix) => ssmArn(environmentName, suffix)).sort()
      );
      const cfnSsm = cfnStatements.find((statement) => actions(statement).includes("ssm:GetParameters"));
      assert.deepEqual(
        [...staticResources(cfnSsm)].sort(),
        expected.cloudFormationInputs.map((suffix) => ssmArn(environmentName, suffix)).sort()
      );

      const passRole = githubStatements.find((statement) => actions(statement).includes("iam:PassRole"));
      assert.deepEqual(passRole.Resource, { "Fn::GetAtt": [cfn.logicalId, "Arn"] });
      assert.deepEqual(passRole.Condition, {
        StringEquals: { "iam:PassedToService": "cloudformation.amazonaws.com" },
      });
      assert.ok(githubStatements.some((statement) => (
        actions(statement).includes("sts:GetCallerIdentity") && statement.Resource === "*"
      )));

      for (const statement of [...githubStatements, ...cfnStatements]) {
        if (actions(statement).some((action) => action.startsWith("iam:"))) {
          assert.notEqual(statement.Resource, "*");
          assert.doesNotMatch(JSON.stringify(statement.Resource), /:role\/\*|:policy\/\*/);
        }
      }
      const cfnIamResources = cfnStatements
        .filter((statement) => actions(statement).some((action) => action.startsWith("iam:")))
        .flatMap(staticResources);
      assert.ok(cfnIamResources.length > 0);
      const expectedRoleResources = [...new Set([
        stackName,
        stackName.slice(0, expected.iamGeneratedPrefixLength),
      ])].map((prefix) => `arn:aws:iam::${account}:role/${prefix}-*`).sort();
      assert.deepEqual(
        [...new Set(cfnIamResources.filter((resource) => resource.includes(":role/")))].sort(),
        expectedRoleResources
      );
      assert.equal(
        cfnIamResources
          .filter((resource) => resource.includes(":policy/"))
          .every((resource) => resource === `arn:aws:iam::${account}:policy/${stackName}-*`),
        true
      );
      assert.equal(cfnIamResources.some((resource) => resource.includes("zoolanding-deployer-")), false);

      const expectedFunctionResources = [...new Set([
        stackName,
        expected.lambdaGeneratedPrefixLength
          ? stackName.slice(0, expected.lambdaGeneratedPrefixLength)
          : stackName,
      ])].map((prefix) => `arn:aws:lambda:${region}:${account}:function:${prefix}-*`).sort();
      const functionLifecycle = cfnStatements.find((statement) => actions(statement).includes("lambda:CreateFunction"));
      assert.deepEqual(staticResources(functionLifecycle).sort(), expectedFunctionResources);
      if (expected.cloudFormationNamespaces.includes("sqs")) {
        const eventSourceMapping = cfnStatements.find((statement) => (
          actions(statement).includes("lambda:CreateEventSourceMapping")
        ));
        assert.equal(eventSourceMapping.Resource, "*");
        const functionCondition = eventSourceMapping.Condition.ArnLike["lambda:FunctionArn"];
        const renderedFunctionCondition = Array.isArray(functionCondition)
          ? functionCondition.map(renderStaticArn).sort()
          : renderStaticArn(functionCondition);
        assert.deepEqual(
          renderedFunctionCondition,
          expectedFunctionResources.length === 1
            ? expectedFunctionResources[0]
            : expectedFunctionResources
        );
        const queuePrefixes = [...new Set([
          stackName,
          expected.queueGeneratedPrefixLength
            ? stackName.slice(0, expected.queueGeneratedPrefixLength)
            : stackName,
        ])];
        const createQueue = cfnStatements.find((statement) => actions(statement).includes("sqs:CreateQueue"));
        assert.deepEqual(
          staticResources(createQueue).sort(),
          queuePrefixes.map((prefix) => `arn:aws:sqs:${region}:${account}:${prefix}-*`).sort()
        );
      }
      if (expected.cloudFormationNamespaces.includes("events")) {
        const rulePrefixes = [...new Set([
          stackName,
          stackName.slice(0, expected.scheduleGeneratedPrefixLength),
        ])];
        const putRule = cfnStatements.find((statement) => actions(statement).includes("events:PutRule"));
        assert.deepEqual(
          staticResources(putRule).sort(),
          rulePrefixes.map((prefix) => `arn:aws:events:${region}:${account}:rule/${prefix}-*`).sort()
        );
      }

      const cfnPolicy = resourcesOfType(template, "AWS::IAM::Policy")
        .find(([, policy]) => JSON.stringify(policy.Properties.Roles).includes(`\"${cfn.logicalId}\"`))[1];
      assert.ok(
        Buffer.byteLength(JSON.stringify(cfnPolicy.Properties.PolicyDocument), "utf8") < 10240,
        `${cfnName} inline policy exceeds IAM quota`
      );
    }

    const wildcardActions = allPolicies
      .filter((statement) => statement.Resource === "*")
      .flatMap(actions);
    assert.ok(wildcardActions.includes("sts:GetCallerIdentity"));
    assert.equal(wildcardActions.some((action) => action.startsWith("iam:") || action.startsWith("ssm:")), false);
  });
}

test("environment stage exposes service repository bootstrap as an independent stack", () => {
  const environment = environments.find((candidate) => candidate.name === "test");
  const app = new cdk.App();
  const stage = new ZoolandingpageEnvironmentStage(app, "TestStage", {
    env: { account, region },
    environment,
  });
  const childIds = stage.node.children.map((child) => child.node.id);

  assert.ok(childIds.includes("Zoolandingpage-test-Frontend"));
  assert.ok(childIds.includes("Zoolandingpage-test-ServiceRepositoryBootstrap"));
});
