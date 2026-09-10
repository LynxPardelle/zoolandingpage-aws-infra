"use strict";

// Supplemental grants only. Original roles, policies and trust remain owned by
// their existing declarations; service templates own all application resources.
const TARGETS = Object.freeze({
  ThnTestHubSupplementalPolicy: "zoolanding-content-hub-test-deploy",
  ThnTestImageCallerSupplementalPolicy: "zoolanding-deployer-image-upload-test-github-deploy",
  ThnTestImageExecutorSupplementalPolicy: "zoolanding-deployer-image-upload-test-cfn-exec",
});
const POLICY_NAME = "ThnTestSupplementalDeploymentV1";
const sub = value => ({ "Fn::Sub": value });
const arn = (service, resource) => sub("arn:${AWS::Partition}:" + service + ":${AWS::Region}:${AWS::AccountId}:" + resource);
const roleArn = name => sub("arn:${AWS::Partition}:iam::${AWS::AccountId}:role/" + name);
const bucketArn = name => sub("arn:${AWS::Partition}:s3:::" + name + "-${AWS::AccountId}-${AWS::Region}");
const statement = (Action, Resource, Condition) => ({ Effect: "Allow", Action, Resource, ...(Condition ? { Condition } : {}) });
const HUB_FUNCTIONS = Object.freeze(["ThnContentHubV2Authoring", "ThnV2PrivateAssetCollector", "ThnV2Publisher",
  "ThnV2PublicMedia", "ThnV2Invalidation", "ThnV2EmergencyWithdraw", "ThnV2PreparedOrphanCollector"]);
const HUB_ROLES = Object.freeze(["zlp-thn-ch-test-authoring", "zlp-thn-ch-test-private-asset-gc", "zlp-thn-ch-test-publisher",
  "zlp-thn-ch-test-public-media", "zlp-thn-ch-test-invalidation", "zlp-thn-ch-test-emergency-withdraw",
  "zlp-thn-ch-test-prepared-orphan-gc", "zoolanding-thn-registry-test-mutation"]);

// Configuration reads declared by the native provider schemas. These do not
// permit object/item access or enable the corresponding optional features.
const BUCKET_PROVIDER_READS = ["s3:GetAccelerateConfiguration", "s3:GetLifecycleConfiguration", "s3:GetAnalyticsConfiguration",
  "s3:GetBucketCORS", "s3:GetInventoryConfiguration", "s3:GetBucketLogging", "s3:GetMetricsConfiguration",
  "s3:GetBucketNotification", "s3:GetReplicationConfiguration", "s3:GetBucketWebsite", "s3:GetBucketObjectLockConfiguration",
  "s3:GetIntelligentTieringConfiguration", "s3:GetBucketMetadataTableConfiguration", "s3:ListTagsForResource", "s3:GetBucketAbac"];
const TABLE_PROVIDER_READS = ["dynamodb:DescribeContributorInsights", "dynamodb:DescribeKinesisStreamingDestination", "dynamodb:GetResourcePolicy"];
const viaCloudFormation = { StringEquals: { "aws:CalledViaFirst": "cloudformation.amazonaws.com" } };

function supplementalResources() {
  const hubFunctions = HUB_FUNCTIONS.map(name => arn("lambda", `function:zoolanding-content-hub-test-${name}`));
  const hubAliases = HUB_FUNCTIONS.map(name => arn("lambda", `function:zoolanding-content-hub-test-${name}:test`));
  const imageFunction = arn("lambda", "function:zoolanding-image-upload-test-ThnImageUploadV2");
  const imageAlias = arn("lambda", "function:zoolanding-image-upload-test-ThnImageUploadV2:test");
  const hubRoles = HUB_ROLES.map(roleArn);
  const operators = ["zoolanding-thn-registry-test-operator", "zoolanding-thn-content-hub-test-operator"].map(roleArn);
  const statements = [
    [
      statement(["lambda:PublishVersion", "lambda:CreateAlias", "lambda:GetAlias", "lambda:UpdateAlias", "lambda:DeleteAlias",
        "lambda:GetProvisionedConcurrencyConfig"], [...hubFunctions, ...hubAliases]),
      statement(["lambda:GetAlias", "lambda:GetFunctionConcurrency"], [imageFunction, imageAlias]),
      statement(["cloudformation:DescribeStacks"], [arn("cloudformation", "stack/zoolanding-auth-admin-test/*"),
        arn("cloudformation", "stack/zoolanding-image-upload-test/*")]),
      statement(["dynamodb:PutResourcePolicy"], [arn("dynamodb", "table/zoolanding-content-hub-test-ServiceBindingRegistryV2")]),
      statement(TABLE_PROVIDER_READS, ["ServiceBindingRegistryV2", "ThnContentHubV2Metadata", "ThnContentHubV2Audit"]
        .map(name => arn("dynamodb", `table/zoolanding-content-hub-test-${name}`))),
      statement(["iam:CreateRole", "iam:DeleteRole", "iam:GetRole", "iam:UpdateRole", "iam:UpdateRoleDescription",
        "iam:UpdateAssumeRolePolicy", "iam:PutRolePolicy", "iam:DeleteRolePolicy", "iam:GetRolePolicy",
        "iam:ListRolePolicies", "iam:ListAttachedRolePolicies", "iam:TagRole", "iam:UntagRole"], hubRoles, viaCloudFormation),
      statement(["iam:AttachRolePolicy", "iam:DetachRolePolicy"], hubRoles, {
        ...viaCloudFormation,
        ArnEquals: { "iam:PolicyARN": sub("arn:${AWS::Partition}:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole") },
      }),
      statement(["iam:PassRole"], hubRoles, { StringEquals: { ...viaCloudFormation.StringEquals, "iam:PassedToService": "lambda.amazonaws.com" } }),
      // Native CFN inline-policy provider calls on the two service-owned
      // mediator-invoke policies. No trust, role creation or PassRole on humans.
      statement(["iam:GetRole"], operators),
      statement(["iam:GetRolePolicy", "iam:PutRolePolicy", "iam:DeleteRolePolicy"], operators, viaCloudFormation),
      statement(["s3:CreateBucket", "s3:GetBucketLocation", "s3:GetBucketTagging", "s3:PutBucketTagging",
        "s3:GetEncryptionConfiguration", "s3:PutEncryptionConfiguration", "s3:GetBucketVersioning", "s3:PutBucketVersioning",
        "s3:GetBucketPublicAccessBlock", "s3:PutBucketPublicAccessBlock", "s3:GetBucketOwnershipControls", "s3:ListBucket",
        ...BUCKET_PROVIDER_READS], [bucketArn("zlp-thn-ch-test-private")]),
    ],
    [
      // IAM scopes the stack; the service's closed runner enforces true-only
      // protection. AWS has no per-boolean condition for this action.
      statement(["cloudformation:GetTemplate", "cloudformation:UpdateTerminationProtection"], [arn("cloudformation", "stack/zoolanding-image-upload-test/*")]),
      statement(["lambda:GetAlias", "lambda:GetFunctionConcurrency"], [imageFunction, imageAlias]),
      statement(["dynamodb:DescribeTable", "dynamodb:DescribeContinuousBackups"], [arn("dynamodb", "table/zoolanding-image-upload-test-ThnPrivateUploadTransactionsV2")]),
      statement(["s3:GetBucketVersioning", "s3:GetBucketPublicAccessBlock", "s3:GetEncryptionConfiguration"], [bucketArn("zlp-thn-private-upload-test")]),
    ],
    [
      statement(["lambda:PublishVersion", "lambda:CreateAlias"], [imageFunction]),
      statement(["lambda:GetAlias", "lambda:UpdateAlias", "lambda:DeleteAlias", "lambda:GetProvisionedConcurrencyConfig"], [imageFunction, imageAlias]),
      statement(TABLE_PROVIDER_READS, [arn("dynamodb", "table/zoolanding-image-upload-test-ThnPrivateUploadTransactionsV2")]),
      statement(BUCKET_PROVIDER_READS, [bucketArn("zlp-thn-private-upload-test")]),
    ],
  ];
  return Object.fromEntries(Object.entries(TARGETS).map(([logical, RoleName], index) => [logical, {
    Type: "AWS::IAM::RolePolicy", Properties: { RoleName, PolicyName: POLICY_NAME,
      PolicyDocument: { Version: "2012-10-17", Statement: statements[index] } },
  }]));
}

function createThnTestSupplementalPolicies(scope, environment) {
  if (environment.name !== "test") return;
  const cdk = require("aws-cdk-lib");
  for (const [logical, definition] of Object.entries(supplementalResources())) {
    const resource = new cdk.CfnResource(scope, logical, { type: definition.Type, properties: definition.Properties });
    resource.overrideLogicalId(logical);
    const child = logical === "ThnTestImageCallerSupplementalPolicy" ? "ImageUploadThnTestGithubRole"
      : logical === "ThnTestImageExecutorSupplementalPolicy" ? "ImageUploadThnTestCloudFormationRole" : null;
    if (child) resource.addResourceDependency(scope.node.findChild(child).node.defaultChild);
  }
}

module.exports = { TARGETS, POLICY_NAME, HUB_FUNCTIONS, HUB_ROLES, supplementalResources, createThnTestSupplementalPolicies };
