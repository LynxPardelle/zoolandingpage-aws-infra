"use strict";

const cdk = require("aws-cdk-lib");
const iam = require("aws-cdk-lib/aws-iam");
const { applyZoolandingpageTags, pascalId } = require("../project-helpers");

const commonInputParameterSuffixes = [
  "config/registry-table-name",
  "config/payload-bucket-name",
  "auth/session-table-name",
  "auth/user-state-table-name",
];

const serviceRepositories = [
  {
    repository: "zoolanding-data-spaces",
    githubInputParameterSuffixes: commonInputParameterSuffixes,
    cloudFormationInputParameterSuffixes: commonInputParameterSuffixes,
    outputParameterSuffixes: ["services/data-spaces/api-id"],
    capabilities: ["api"],
    iamGeneratedPrefixLength: 25,
    lambdaGeneratedPrefixLength: 25,
  },
  {
    repository: "zoolanding-commerce",
    githubInputParameterSuffixes: [
      ...commonInputParameterSuffixes,
      "services/integrations/api-id",
      "topics/integration-events-arn",
    ],
    cloudFormationInputParameterSuffixes: [
      ...commonInputParameterSuffixes,
      "services/integrations/api-id",
      "topics/integration-events-arn",
    ],
    outputParameterSuffixes: [
      "services/commerce/api-id",
      "topics/commerce-notification-requests-arn",
      "services/commerce/integrations-caller-role-arns",
    ],
    capabilities: ["api", "logs", "queues", "topics", "subscription", "event-sources", "schedule"],
    externalTopicRepository: "zoolanding-integrations",
    iamGeneratedPrefixLength: 25,
    lambdaGeneratedPrefixLength: 25,
    scheduleGeneratedPrefixLength: 25,
  },
  {
    repository: "zoolanding-integrations",
    githubInputParameterSuffixes: [
      ...commonInputParameterSuffixes,
      "services/commerce/integrations-caller-role-arns",
      "services/notifications/smtp-worker-role-arn",
    ],
    cloudFormationInputParameterSuffixes: commonInputParameterSuffixes,
    outputParameterSuffixes: [
      "topics/integration-events-arn",
      "services/integrations/api-id",
    ],
    capabilities: ["api", "logs", "queues", "topics", "event-sources", "managed-policies"],
    iamGeneratedPrefixLength: 25,
    lambdaGeneratedPrefixLength: 25,
    queueGeneratedPrefixLength: 33,
  },
  {
    repository: "zoolanding-notifications",
    githubInputParameterSuffixes: [
      "topics/commerce-notification-requests-arn",
      "services/integrations/api-id",
    ],
    cloudFormationInputParameterSuffixes: [
      "config/registry-table-name",
      "config/payload-bucket-name",
      "topics/commerce-notification-requests-arn",
      "services/integrations/api-id",
    ],
    outputParameterSuffixes: [
      "services/notifications/smtp-worker-role-arn",
      "queues/notification-requests-arn",
      "tables/notifications-delivery-ledger-name",
    ],
    capabilities: ["logs", "queues", "subscription", "event-sources"],
    externalTopicRepository: "zoolanding-commerce",
    iamGeneratedPrefixLength: 28,
  },
];

class ServiceRepositoryBootstrapStack extends cdk.Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    const { environment } = props;
    if (!environment || !["test", "production"].includes(environment.name)) {
      throw new Error("Service repository deployment identities require test or production.");
    }
    const bootstrap = environment.serviceRepositoryBootstrap;
    if (!bootstrap?.samArtifactBucketName) {
      throw new Error(`Missing serviceRepositoryBootstrap.samArtifactBucketName for ${environment.name}.`);
    }

    applyZoolandingpageTags(this, environment);
    for (const service of serviceRepositories) {
      createServiceDeploymentIdentities(this, environment, bootstrap, service);
    }
  }
}

function createServiceDeploymentIdentities(scope, environment, bootstrap, service) {
  const environmentName = environment.name;
  const branch = environmentName === "test" ? "test" : "main";
  const serviceId = pascalId(service.repository.replace(/^zoolanding-/, ""));
  const stackName = `${service.repository}-${environmentName}`;
  const deployerName = `${service.repository.replace("zoolanding-", "zoolanding-deployer-")}-${environmentName}`;
  const stackArn = arn(
    "cloudformation",
    environment,
    `stack/${stackName}/*`
  );
  const samBootstrapStackArn = arn(
    "cloudformation",
    environment,
    "stack/aws-sam-cli-managed-default/*"
  );
  const samBucketArn = `arn:${cdk.Aws.PARTITION}:s3:::${bootstrap.samArtifactBucketName}`;
  const samArtifactArn = `${samBucketArn}/${stackName}/*`;

  const cloudFormationRole = new iam.Role(scope, `${serviceId}CloudFormationExecutionRole`, {
    roleName: `${deployerName}-cfn-exec`,
    description: `Bounded CloudFormation execution role for ${service.repository} ${environmentName}.`,
    assumedBy: new iam.ServicePrincipal("cloudformation.amazonaws.com"),
  });
  cloudFormationRole.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);
  addCloudFormationExecutionPolicy(
    cloudFormationRole,
    environment,
    service,
    stackName,
    samArtifactArn
  );

  const githubRole = new iam.Role(scope, `${serviceId}GithubDeployRole`, {
    roleName: `${deployerName}-github-deploy`,
    description: `Branch-bound GitHub OIDC deploy role for ${service.repository} ${environmentName}.`,
    assumedBy: new iam.FederatedPrincipal(
      `arn:aws:iam::${environment.account}:oidc-provider/token.actions.githubusercontent.com`,
      {
        StringEquals: {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub":
            `repo:LynxPardelle/${service.repository}:environment:${environmentName}`,
          "token.actions.githubusercontent.com:ref": `refs/heads/${branch}`,
        },
      },
      "sts:AssumeRoleWithWebIdentity"
    ),
  });
  githubRole.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);
  addGithubDeployPolicy(githubRole, {
    environment,
    service,
    stackArn,
    samBootstrapStackArn,
    samBucketArn,
    samArtifactArn,
    samArtifactPrefix: stackName,
    cloudFormationRole,
  });

  new cdk.CfnOutput(scope, `${serviceId}GithubDeployRoleArn`, {
    value: githubRole.roleArn,
    description: `${service.repository} ${environmentName} GitHub Environment AWS_ROLE_ARN.`,
  });
  new cdk.CfnOutput(scope, `${serviceId}CloudFormationExecutionRoleArn`, {
    value: cloudFormationRole.roleArn,
    description: `${service.repository} ${environmentName} GitHub Environment AWS_CLOUDFORMATION_ROLE_ARN.`,
  });
}

function addGithubDeployPolicy(role, props) {
  const {
    environment,
    service,
    stackArn,
    samBootstrapStackArn,
    samBucketArn,
    samArtifactArn,
    samArtifactPrefix,
    cloudFormationRole,
  } = props;

  add(role, ["cloudformation:CreateChangeSet"], [stackArn], {
    ArnEquals: { "cloudformation:RoleArn": cloudFormationRole.roleArn },
  });
  add(role, [
    "cloudformation:DeleteChangeSet",
    "cloudformation:DescribeChangeSet",
    "cloudformation:DescribeStackEvents",
    "cloudformation:DescribeStacks",
    "cloudformation:ExecuteChangeSet",
  ], [stackArn]);
  add(role, ["cloudformation:DescribeStacks"], [samBootstrapStackArn]);
  add(role, ["cloudformation:GetTemplateSummary"], [stackArn]);
  add(role, ["s3:GetBucketLocation"], [samBucketArn]);
  add(role, ["s3:ListBucket"], [samBucketArn], {
    StringLike: {
      "s3:prefix": [samArtifactPrefix, `${samArtifactPrefix}/*`],
    },
  });
  add(role, ["s3:GetObject", "s3:PutObject"], [samArtifactArn]);
  add(role, ["iam:PassRole"], [cloudFormationRole.roleArn], {
    StringEquals: { "iam:PassedToService": "cloudformation.amazonaws.com" },
  });
  add(
    role,
    ["ssm:GetParameter"],
    parameterArns(environment, service.githubInputParameterSuffixes)
  );

  // GetCallerIdentity has no resource-level authorization support.
  add(role, ["sts:GetCallerIdentity"], ["*"]);
}

function addCloudFormationExecutionPolicy(role, environment, service, stackName, samArtifactArn) {
  const functionArns = generatedPrefixes(stackName, service.lambdaGeneratedPrefixLength)
    .map((prefix) => arn("lambda", environment, `function:${prefix}-*`));
  const functionArnCondition = functionArns.length === 1 ? functionArns[0] : functionArns;
  const roleArns = generatedPrefixes(stackName, service.iamGeneratedPrefixLength)
    .map((prefix) => `arn:${cdk.Aws.PARTITION}:iam::${environment.account}:role/${prefix}-*`);
  const policyArn = `arn:${cdk.Aws.PARTITION}:iam::${environment.account}:policy/${stackName}-*`;

  add(role, ["cloudformation:CreateChangeSet"], [
    `arn:${cdk.Aws.PARTITION}:cloudformation:${environment.region}:aws:transform/Serverless-2016-10-31`,
  ]);
  add(role, ["s3:GetObject"], [samArtifactArn]);
  add(
    role,
    ["ssm:GetParameters"],
    parameterArns(environment, service.cloudFormationInputParameterSuffixes)
  );
  add(role, [
    "ssm:AddTagsToResource",
    "ssm:DeleteParameter",
    "ssm:GetParameter",
    "ssm:ListTagsForResource",
    "ssm:PutParameter",
    "ssm:RemoveTagsFromResource",
  ], parameterArns(environment, service.outputParameterSuffixes));

  add(role, [
    "lambda:AddPermission",
    "lambda:CreateFunction",
    "lambda:DeleteFunction",
    "lambda:DeleteFunctionConcurrency",
    "lambda:GetFunction",
    "lambda:GetFunctionConfiguration",
    "lambda:GetFunctionConcurrency",
    "lambda:GetPolicy",
    "lambda:ListTags",
    "lambda:PutFunctionConcurrency",
    "lambda:RemovePermission",
    "lambda:TagResource",
    "lambda:UntagResource",
    "lambda:UpdateFunctionCode",
    "lambda:UpdateFunctionConfiguration",
  ], functionArns);
  if (service.capabilities.includes("event-sources")) {
    // Event-source mapping UUIDs are service-generated. FunctionArn keeps the wildcard bound to this stack.
    add(role, [
      "lambda:CreateEventSourceMapping",
      "lambda:DeleteEventSourceMapping",
      "lambda:GetEventSourceMapping",
      "lambda:UpdateEventSourceMapping",
    ], ["*"], {
      ArnLike: { "lambda:FunctionArn": functionArnCondition },
    });
  }

  add(role, [
    "iam:AttachRolePolicy",
    "iam:CreateRole",
    "iam:DeleteRole",
    "iam:DeleteRolePolicy",
    "iam:DetachRolePolicy",
    "iam:GetRole",
    "iam:GetRolePolicy",
    "iam:ListAttachedRolePolicies",
    "iam:ListRolePolicies",
    "iam:PutRolePolicy",
    "iam:TagRole",
    "iam:UntagRole",
    "iam:UpdateAssumeRolePolicy",
    "iam:UpdateRole",
    "iam:UpdateRoleDescription",
  ], roleArns);
  add(role, ["iam:PassRole"], roleArns, {
    StringEquals: { "iam:PassedToService": "lambda.amazonaws.com" },
  });
  if (service.capabilities.includes("managed-policies")) {
    add(role, [
      "iam:CreatePolicy",
      "iam:CreatePolicyVersion",
      "iam:DeletePolicy",
      "iam:DeletePolicyVersion",
      "iam:GetPolicy",
      "iam:GetPolicyVersion",
      "iam:ListPolicyVersions",
      "iam:SetDefaultPolicyVersion",
      "iam:TagPolicy",
      "iam:UntagPolicy",
    ], [policyArn]);
  }

  addDynamoDbPolicy(role, environment, stackName);
  addAlarmPolicy(role, environment, stackName);

  if (service.capabilities.includes("api")) {
    // REST API ids are service-generated; API Gateway has no name-scoped ARN during creation.
    add(role, [
      "apigateway:DELETE",
      "apigateway:GET",
      "apigateway:PATCH",
      "apigateway:POST",
      "apigateway:PUT",
    ], [
      arn("apigateway", environment, "/restapis", false),
      arn("apigateway", environment, "/restapis/*", false),
    ]);
  }
  if (service.capabilities.includes("logs")) {
    addLogPolicy(role, environment, service, stackName);
  }
  if (service.capabilities.includes("queues")) {
    addQueuePolicy(role, environment, service, stackName);
  }
  if (service.capabilities.includes("topics")) {
    addTopicPolicy(role, environment, stackName);
  }
  if (service.capabilities.includes("subscription")) {
    addSubscriptionPolicy(role, environment, service);
  }
  if (service.capabilities.includes("schedule")) {
    addSchedulePolicy(role, environment, service, stackName);
  }
}

function addDynamoDbPolicy(role, environment, stackName) {
  add(role, [
    "dynamodb:CreateTable",
    "dynamodb:DeleteTable",
    "dynamodb:DescribeContinuousBackups",
    "dynamodb:DescribeTable",
    "dynamodb:DescribeTimeToLive",
    "dynamodb:ListTagsOfResource",
    "dynamodb:TagResource",
    "dynamodb:UntagResource",
    "dynamodb:UpdateContinuousBackups",
    "dynamodb:UpdateTable",
    "dynamodb:UpdateTimeToLive",
  ], [arn("dynamodb", environment, `table/${stackName}-*`)]);
}

function addAlarmPolicy(role, environment, stackName) {
  add(role, [
    "cloudwatch:DeleteAlarms",
    "cloudwatch:DescribeAlarms",
    "cloudwatch:PutMetricAlarm",
    "cloudwatch:TagResource",
    "cloudwatch:UntagResource",
  ], [arn("cloudwatch", environment, `alarm:${stackName}-*`)]);
}

function addLogPolicy(role, environment, service, stackName) {
  const logGroupNames = {
    "zoolanding-commerce": [`/zoolanding/commerce/${environment.name}`],
    "zoolanding-integrations": [
      `/aws/lambda/${stackName}-control-plane`,
      `/aws/lambda/${stackName}-webhook-ingress-stream`,
      `/aws/lambda/${stackName}-stripe-webhook`,
      `/aws/lambda/${stackName}-integration-outgoing-stream`,
    ],
    "zoolanding-notifications": [
      `/aws/lambda/zoolanding-notifications-${environment.name}-smtp-delivery`,
    ],
  }[service.repository];
  if (!logGroupNames?.length) {
    throw new Error(`Missing exact log group names for ${service.repository}.`);
  }
  const resources = logGroupNames.flatMap((name) => {
    const logGroupArn = arn("logs", environment, `log-group:${name}`);
    return [logGroupArn, `${logGroupArn}:*`];
  });
  add(role, [
    "logs:CreateLogGroup",
    "logs:DeleteLogGroup",
    "logs:ListTagsForResource",
    "logs:PutRetentionPolicy",
    "logs:TagResource",
    "logs:UntagResource",
  ], resources);
  // DescribeLogGroups has no resource-level authorization support.
  add(role, ["logs:DescribeLogGroups"], ["*"]);
}

function addQueuePolicy(role, environment, service, stackName) {
  add(role, [
    "sqs:CreateQueue",
    "sqs:DeleteQueue",
    "sqs:GetQueueAttributes",
    "sqs:GetQueueUrl",
    "sqs:ListQueueTags",
    "sqs:SetQueueAttributes",
    "sqs:TagQueue",
    "sqs:UntagQueue",
  ], generatedPrefixes(stackName, service.queueGeneratedPrefixLength)
    .map((prefix) => arn("sqs", environment, `${prefix}-*`)));
}

function addTopicPolicy(role, environment, stackName) {
  add(role, [
    "sns:CreateTopic",
    "sns:DeleteTopic",
    "sns:GetTopicAttributes",
    "sns:ListTagsForResource",
    "sns:SetTopicAttributes",
    "sns:TagResource",
    "sns:UntagResource",
  ], [arn("sns", environment, `${stackName}-*`)]);
}

function addSubscriptionPolicy(role, environment, service) {
  const topicArn = arn(
    "sns",
    environment,
    `${service.externalTopicRepository}-${environment.name}-*`
  );
  add(role, ["sns:GetTopicAttributes", "sns:ListSubscriptionsByTopic", "sns:Subscribe"], [topicArn]);
  add(role, ["sns:GetSubscriptionAttributes", "sns:SetSubscriptionAttributes", "sns:Unsubscribe"], [
    `${topicArn}:*`,
  ]);
}

function addSchedulePolicy(role, environment, service, stackName) {
  add(role, [
    "events:DeleteRule",
    "events:DescribeRule",
    "events:DisableRule",
    "events:EnableRule",
    "events:ListTargetsByRule",
    "events:PutRule",
    "events:PutTargets",
    "events:RemoveTargets",
    "events:TagResource",
    "events:UntagResource",
  ], generatedPrefixes(stackName, service.scheduleGeneratedPrefixLength)
    .map((prefix) => arn("events", environment, `rule/${prefix}-*`)));
}

function generatedPrefixes(stackName, truncatedLength) {
  return [...new Set([
    stackName,
    truncatedLength ? stackName.slice(0, truncatedLength) : stackName,
  ])];
}

function parameterArns(environment, suffixes) {
  return suffixes.map((suffix) => (
    arn("ssm", environment, `parameter/zoolanding/${environment.name}/${suffix}`)
  ));
}

function arn(service, environment, resource, includeAccount = true) {
  const account = includeAccount ? environment.account : "";
  return `arn:${cdk.Aws.PARTITION}:${service}:${environment.region}:${account}:${resource}`;
}

function add(role, actions, resources, conditions) {
  role.addToPolicy(new iam.PolicyStatement({
    actions,
    resources,
    conditions,
  }));
}

module.exports = {
  ServiceRepositoryBootstrapStack,
  serviceRepositories,
};
