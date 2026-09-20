"use strict";

const cdk = require("aws-cdk-lib");
const iam = require("aws-cdk-lib/aws-iam");

// The API's generated ID cannot be known before creation. API Gateway create
// rights therefore live only on this new CFN role, never the shared API role.
function addThnDedicatedRuntimeIdentity(scope, environment, githubRole) {
  if (environment.name !== "test") return;
  const account = environment.account;
  const region = environment.region;
  const stackName = "zoolanding-thn-auth-runtime-test";
  const stackArn = `arn:${cdk.Aws.PARTITION}:cloudformation:${region}:${account}:stack/${stackName}/*`;
  // CloudFormation truncates this stack name when generating physical names
  // for long SAM logical IDs. Keep the execution policy within the dedicated
  // runtime prefix while covering those generated names during create/rollback.
  const generatedPhysicalPrefix = "zoolanding-thn-auth-runti";
  // Keep the existing GitHub managed policy unchanged in this one-policy revision.
  const githubFunctionArn = `arn:${cdk.Aws.PARTITION}:lambda:${region}:${account}:function:${stackName}-*`;
  const functionArn = `arn:${cdk.Aws.PARTITION}:lambda:${region}:${account}:function:${generatedPhysicalPrefix}*`;
  const runtimeRoleArn = `arn:${cdk.Aws.PARTITION}:iam::${account}:role/${generatedPhysicalPrefix}*`;
  const logArn = `arn:${cdk.Aws.PARTITION}:logs:${region}:${account}:log-group:/aws/lambda/${generatedPhysicalPrefix}*`;
  const artifactArn = `arn:${cdk.Aws.PARTITION}:s3:::${environment.serviceRepositoryBootstrap.samArtifactBucketName}/zoolanding-api-proxy-test/thn-runtime/*`;
  const statement = (Action, Resource, Condition) => ({
    Effect: "Allow", Action, Resource, ...(Condition ? { Condition } : {}),
  });

  const executionRole = new iam.Role(scope, "ThnDedicatedRuntimeTestCloudFormationRole", {
    roleName: "zoolanding-deployer-thn-auth-runtime-test-cfn-exec",
    assumedBy: new iam.ServicePrincipal("cloudformation.amazonaws.com"),
    description: "Execution identity for the standalone THN TEST runtime API stack only.",
  });
  executionRole.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);

  new iam.CfnManagedPolicy(scope, "ThnDedicatedRuntimeTestGithubPolicy", {
    managedPolicyName: "ThnDedicatedRuntimeTestGithubV1",
    roles: [githubRole.roleName],
    policyDocument: { Version: "2012-10-17", Statement: [
      statement(["cloudformation:CreateChangeSet"], [stackArn], {
        ArnEquals: { "cloudformation:RoleArn": executionRole.roleArn },
      }),
      statement(["cloudformation:DescribeChangeSet", "cloudformation:DeleteChangeSet",
        "cloudformation:ExecuteChangeSet", "cloudformation:DescribeStacks",
        "cloudformation:DescribeStackEvents", "cloudformation:ListStackResources",
        "cloudformation:GetTemplate", "cloudformation:UpdateTerminationProtection"], [stackArn]),
      statement(["iam:PassRole"], [executionRole.roleArn], {
        StringEquals: { "iam:PassedToService": "cloudformation.amazonaws.com" },
      }),
      statement(["s3:GetObjectVersion"], [artifactArn]),
      statement(["lambda:GetFunction", "lambda:GetFunctionConfiguration", "lambda:GetAlias",
        "lambda:GetPolicy", "lambda:ListVersionsByFunction"], [githubFunctionArn]),
    ] },
  });

  new iam.CfnPolicy(scope, "ThnDedicatedRuntimeTestExecutionPolicy", {
    policyName: "ThnDedicatedRuntimeTestExecutionV1",
    roles: [executionRole.roleName],
    policyDocument: { Version: "2012-10-17", Statement: [
      statement(["s3:GetObject", "s3:GetObjectVersion"], [artifactArn]),
      statement(["lambda:CreateFunction", "lambda:DeleteFunction", "lambda:GetFunction",
        "lambda:GetFunctionConfiguration", "lambda:UpdateFunctionCode",
        "lambda:UpdateFunctionConfiguration", "lambda:PublishVersion", "lambda:ListVersionsByFunction",
        "lambda:CreateAlias", "lambda:UpdateAlias", "lambda:DeleteAlias", "lambda:GetAlias",
        "lambda:AddPermission", "lambda:RemovePermission", "lambda:GetPolicy",
        "lambda:ListTags", "lambda:TagResource", "lambda:UntagResource"], [functionArn]),
      statement(["iam:CreateRole", "iam:DeleteRole", "iam:GetRole", "iam:PutRolePolicy",
        "iam:DeleteRolePolicy", "iam:GetRolePolicy", "iam:ListRolePolicies",
        "iam:ListAttachedRolePolicies", "iam:TagRole", "iam:UntagRole"], [runtimeRoleArn]),
      statement(["iam:AttachRolePolicy", "iam:DetachRolePolicy"], [runtimeRoleArn], {
        ArnEquals: { "iam:PolicyARN": `arn:${cdk.Aws.PARTITION}:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole` },
      }),
      statement(["iam:PassRole"], [runtimeRoleArn], {
        StringEquals: { "iam:PassedToService": "lambda.amazonaws.com" },
      }),
      statement(["logs:CreateLogGroup", "logs:DeleteLogGroup", "logs:DescribeLogGroups",
        "logs:PutRetentionPolicy", "logs:TagResource", "logs:UntagResource"], [logArn]),
      statement(["apigateway:GET", "apigateway:POST", "apigateway:PUT",
        "apigateway:PATCH", "apigateway:DELETE"], [
        `arn:${cdk.Aws.PARTITION}:apigateway:${region}::/restapis`,
        `arn:${cdk.Aws.PARTITION}:apigateway:${region}::/restapis/*`,
      ]),
    ] },
  });
}

module.exports = { addThnDedicatedRuntimeIdentity };
