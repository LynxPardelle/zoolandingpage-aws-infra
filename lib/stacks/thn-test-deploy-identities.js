"use strict";
const cdk = require("aws-cdk-lib");
const iam = require("aws-cdk-lib/aws-iam");
const { addCanonicalPolicy } = require("../../tools/thn-test-recovery-permission-policy");

// These identities do not provision service resources or enable THN features.
function createThnTestDeployIdentities(scope, environment) {
  if (environment.name !== "test") return;
  const account = environment.account;
  const region = environment.region;
  const bucket = environment.serviceRepositoryBootstrap.samArtifactBucketName;
  const arn = (service, resource, withAccount = true) =>
    `arn:${cdk.Aws.PARTITION}:${service}:${region}:${withAccount ? account : ""}:${resource}`;
  const policy = (role, actions, resources, conditions) => role.addToPolicy(
    new iam.PolicyStatement({ actions, resources, conditions })
  );
  for (const [service, id] of [["api-proxy", "ApiProxy"], ["image-upload", "ImageUpload"]]) {
    const repository = `zoolanding-${service}`;
    const stack = `${repository}-test`;
    const stackArn = arn("cloudformation", `stack/${stack}/*`);
    const artifactArn = `arn:${cdk.Aws.PARTITION}:s3:::${bucket}/${stack}/*`;
    const runtimeRoles = [`arn:${cdk.Aws.PARTITION}:iam::${account}:role/${stack}-*`];
    const cfn = new iam.Role(scope, `${id}ThnTestCloudFormationRole`, {
      roleName: `zoolanding-deployer-${service}-test-cfn-exec`,
      assumedBy: new iam.ServicePrincipal("cloudformation.amazonaws.com"),
      description: `CloudFormation execution for the exact ${stack} service family.`,
    });
    const github = new iam.Role(scope, `${id}ThnTestGithubRole`, {
      roleName: `zoolanding-deployer-${service}-test-github-deploy`,
      assumedBy: new iam.FederatedPrincipal(
        `arn:aws:iam::${account}:oidc-provider/token.actions.githubusercontent.com`,
        { StringEquals: {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": `repo:LynxPardelle/${repository}:environment:test`,
          "token.actions.githubusercontent.com:ref": "refs/heads/test",
        } },
        "sts:AssumeRoleWithWebIdentity"
      ),
    });
    cfn.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);
    github.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);
    policy(github, ["cloudformation:CreateChangeSet"], [stackArn], {
      ArnEquals: { "cloudformation:RoleArn": cfn.roleArn },
    });
    policy(github, ["cloudformation:DeleteChangeSet", "cloudformation:DescribeChangeSet",
      "cloudformation:DescribeStackEvents", "cloudformation:DescribeStacks",
      "cloudformation:ListStackResources", "cloudformation:ExecuteChangeSet", "cloudformation:GetTemplateSummary"], [stackArn]);
    // Cross-service reads are required by the existing THN dependency preflight.
    policy(github, ["cloudformation:DescribeStacks", "cloudformation:ListStackResources"], [
      arn("cloudformation", "stack/zoolanding-auth-admin-test/*"),
      arn("cloudformation", "stack/zoolanding-content-hub-test/*"),
    ]);
    policy(github, ["iam:PassRole"], [cfn.roleArn], {
      StringEquals: { "iam:PassedToService": "cloudformation.amazonaws.com" },
    });
    policy(github, ["s3:GetBucketLocation"], [`arn:${cdk.Aws.PARTITION}:s3:::${bucket}`]);
    policy(github, ["s3:ListBucket"], [`arn:${cdk.Aws.PARTITION}:s3:::${bucket}`], {
      StringLike: { "s3:prefix": [stack, `${stack}/*`] },
    });
    policy(github, ["s3:GetObject", "s3:PutObject"], [artifactArn]);
    policy(github, ["lambda:GetFunctionConfiguration"], [arn("lambda", `function:${stack}-*`)]);
    policy(github, ["sts:GetCallerIdentity"], ["*"]);
    policy(cfn, ["s3:GetObject"], [artifactArn]);
    policy(cfn, ["cloudformation:CreateChangeSet"], [
      `arn:${cdk.Aws.PARTITION}:cloudformation:${region}:aws:transform/Serverless-2016-10-31`,
    ]);
    policy(cfn, ["lambda:CreateFunction", "lambda:DeleteFunction", "lambda:GetFunction",
      "lambda:GetFunctionConfiguration", "lambda:UpdateFunctionCode", "lambda:UpdateFunctionConfiguration",
      "lambda:AddPermission", "lambda:RemovePermission", "lambda:GetPolicy", "lambda:ListTags",
      "lambda:TagResource", "lambda:UntagResource", "lambda:PutFunctionConcurrency",
      "lambda:DeleteFunctionConcurrency", "lambda:GetFunctionConcurrency"], [arn("lambda", `function:${stack}-*`)]);
    policy(cfn, ["iam:CreateRole", "iam:DeleteRole", "iam:GetRole", "iam:UpdateRole",
      "iam:UpdateRoleDescription", "iam:UpdateAssumeRolePolicy", "iam:PutRolePolicy",
      "iam:DeleteRolePolicy", "iam:GetRolePolicy", "iam:ListRolePolicies",
      "iam:ListAttachedRolePolicies", "iam:TagRole", "iam:UntagRole"], runtimeRoles);
    policy(cfn, ["iam:AttachRolePolicy", "iam:DetachRolePolicy"], runtimeRoles, {
      ArnEquals: { "iam:PolicyARN": `arn:${cdk.Aws.PARTITION}:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole` },
    });
    policy(cfn, ["iam:PassRole"], runtimeRoles, {
      StringEquals: { "iam:PassedToService": "lambda.amazonaws.com" },
    });
    // Existing API Proxy is pinned to its verified TEST API. The first Image
    // Upload API has a service-generated id; only its CloudFormation role gets
    // the regional REST API family, never the GitHub caller directly.
    const apiPaths = service === "api-proxy"
      ? ["/restapis/11zpm6wug2", "/restapis/11zpm6wug2/*"]
      : ["/restapis", "/restapis/*"];
    policy(cfn, ["apigateway:GET", "apigateway:POST", "apigateway:PUT", "apigateway:PATCH", "apigateway:DELETE"],
      apiPaths.map(path => arn("apigateway", path, false)));
    if (service === "image-upload") {
      policy(cfn, ["dynamodb:CreateTable", "dynamodb:DeleteTable", "dynamodb:DescribeTable",
        "dynamodb:UpdateTable", "dynamodb:DescribeContinuousBackups", "dynamodb:UpdateContinuousBackups",
        "dynamodb:DescribeTimeToLive", "dynamodb:UpdateTimeToLive", "dynamodb:ListTagsOfResource",
        "dynamodb:TagResource", "dynamodb:UntagResource"], [
        arn("dynamodb", "table/zoolanding-image-upload-grants-test"),
        arn("dynamodb", "table/zoolanding-image-upload-test-ThnPrivateUploadTransactionsV2"),
      ]);
      const topic = arn("sns", "zoolanding-image-upload-abuse-alerts-test");
      policy(cfn, ["sns:CreateTopic", "sns:DeleteTopic", "sns:GetTopicAttributes", "sns:SetTopicAttributes",
        "sns:ListTagsForResource", "sns:TagResource", "sns:UntagResource", "sns:Subscribe", "sns:ListSubscriptionsByTopic"], [topic]);
      policy(cfn, ["sns:Unsubscribe", "sns:GetSubscriptionAttributes", "sns:SetSubscriptionAttributes"], [`${topic}:*`]);
      policy(cfn, ["cloudwatch:PutMetricAlarm", "cloudwatch:DeleteAlarms", "cloudwatch:DescribeAlarms",
        "cloudwatch:TagResource", "cloudwatch:UntagResource"], [arn("cloudwatch", "alarm:zoolanding-image-upload-grant-denied-test")]);
      const privateBucket = `arn:${cdk.Aws.PARTITION}:s3:::zlp-thn-private-upload-test-${account}-${region}`;
      policy(cfn, ["s3:CreateBucket", "s3:DeleteBucket", "s3:GetBucketLocation", "s3:GetBucketPolicy",
        "s3:PutBucketPolicy", "s3:DeleteBucketPolicy", "s3:GetBucketTagging", "s3:PutBucketTagging",
        "s3:GetEncryptionConfiguration", "s3:PutEncryptionConfiguration", "s3:GetBucketVersioning",
        "s3:PutBucketVersioning", "s3:GetBucketOwnershipControls", "s3:PutBucketOwnershipControls",
        "s3:GetBucketPublicAccessBlock", "s3:PutBucketPublicAccessBlock", "s3:ListBucket"], [privateBucket]);
    }
    if (service === "api-proxy") {
      addCanonicalPolicy(scope, environment, "api", github.node.defaultChild);
      addCanonicalPolicy(scope, environment, "api-runtime", github.node.defaultChild);
    }
    new cdk.CfnOutput(scope, `${id}ThnTestGithubDeployRoleArn`, { value: github.roleArn });
    new cdk.CfnOutput(scope, `${id}ThnTestCloudFormationRoleArn`, { value: cfn.roleArn });
  }
}
module.exports = { createThnTestDeployIdentities };
