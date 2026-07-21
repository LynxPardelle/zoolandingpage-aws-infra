"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const cdk = require("aws-cdk-lib");
const { Match, Template } = require("aws-cdk-lib/assertions");

const { FrontendStack, staticPathPatterns } = require("../lib/stacks/frontend-stack");
const {
  buildParameterName,
  buildResourceName,
  removalPolicyForEnvironment,
} = require("../lib/project-helpers");
const { environments, retiredZoolandingpageComMxAliases } = require("../config/environments");

test("cloud environments exclude dev", () => {
  assert.deepEqual(environments.map((environment) => environment.name), ["test", "production"]);
});

const testEnvironment = {
  account: "123456789012",
  region: "us-east-1",
  name: "dev",
  stageId: "ZoolandingDev",
  branch: "dev",
  hostedZoneName: "zoolandingpage.com.mx",
  hostedZoneId: "Z0769334CXKBHR43ZZH6",
  runtimeReadDeployment: {
    stackName: "zoolanding-config-runtime-read-fixture",
    apiId: "example",
    functionName: "zoolanding-config-runtime-fixture-function",
    executionRoleName: "zoolanding-config-runtime-fixture-role",
    samArtifactBucketName: "aws-sam-cli-managed-default-samclisourcebucket-fixture",
    samArtifactPrefix: "zoolanding-config-runtime-read-fixture",
    configTableName: "zoolanding-config-registry-fixture",
    configPayloadsBucketName: "zoolanding-config-payloads-fixture",
    contentHubMetadataTableNames: ["content-hub-test", "content-hub-production"],
    contentHubPackageBucketNames: ["content-hub-packages-test", "content-hub-packages-production"],
  },
  frontendHosting: {
    architecture: "cloudfront-s3-lambda-ssr",
    apiBaseUrl: "https://api.zoolandingpage.com.mx",
    configApiServerFallbackUrl: "https://example.execute-api.us-east-1.amazonaws.com/Prod",
    artifactBucketName: "zoolandingpage-dev-frontend-artifacts-123456789012",
    staticBucketName: "zoolandingpage-public-files",
    staticOriginDomainName: "assets.zoolandingpage.com.mx",
    artifactBasePrefix: "frontend/angular-ssr/dev",
    publisherRepository: "LynxPardelle/zoolandingpage",
    githubEnvironment: "dev",
    manifestKeyPattern: "frontend/angular-ssr/dev/releases/{releaseId}/manifest.json",
    staticPrefixPattern: "frontend/angular-ssr/dev/releases/{releaseId}/browser",
    serverBundlePrefixPattern: "frontend/angular-ssr/dev/releases/{releaseId}/server",
    ssrRuntime: "nodejs22.x",
    ssrMemorySizeMb: 512,
    ssrTimeoutSeconds: 15,
    cachePriceClass: "PRICE_CLASS_100",
    runtimeEnvironment: "test",
    route53RecordsEnabled: false,
    route53RecordManagement: "upsert",
    backendRoutes: [
      {
        id: "auth-admin",
        domainName: "auth.example.com",
        originPath: "/prod",
        pathPatterns: ["auth/session", "auth/session/*", "auth/admin", "auth/admin/*"],
      },
      {
        id: "combo-catalog",
        domainName: "combo.example.com",
        originPath: "/prod",
        pathPatterns: ["features/combo-catalog/*"],
      },
      {
        id: "content-hub",
        domainName: "content.example.com",
        originPath: "/prod",
        pathPatterns: ["features/content-hub/*"],
      },
      {
        id: "api-proxy",
        domainName: "proxy.example.com",
        originPath: "/Prod",
        pathPatterns: ["auth/runtime-config", "api-proxy/*"],
      },
    ],
    frontDoors: [
      {
        id: "dev",
        domainName: "dev.zoolandingpage.com.mx",
        certificateArn: "arn:aws:acm:us-east-1:123456789012:certificate/frontend",
        aliasRecordGroups: [
          {
            hostedZoneName: "zoolandingpage.com.mx",
            hostedZoneId: "Z0769334CXKBHR43ZZH6",
            domainNames: ["dev.zoolandingpage.com.mx"],
          },
        ],
      },
    ],
  },
  removalPolicy: "destroy",
};

test("buildResourceName prefixes Zoolandingpage environment and service", () => {
  assert.equal(
    buildResourceName(testEnvironment, "frontend", "ssr"),
    "zoolandingpage-dev-frontend-ssr"
  );
});

test("buildParameterName creates stable Zoolandingpage parameter paths", () => {
  assert.equal(
    buildParameterName(testEnvironment, "frontend/release-id"),
    "/zoolandingpage/dev/frontend/release-id"
  );
});

test("removalPolicyForEnvironment maps environment policy strings", () => {
  assert.equal(removalPolicyForEnvironment(testEnvironment), cdk.RemovalPolicy.DESTROY);
  assert.equal(
    removalPolicyForEnvironment({ ...testEnvironment, removalPolicy: "retain" }),
    cdk.RemovalPolicy.RETAIN
  );
});

test("static behavior list keeps dynamic SEO/runtime endpoints on SSR", () => {
  const patterns = staticPathPatterns();
  assert.ok(patterns.includes("assets/*"));
  assert.ok(patterns.includes("*.js"));
  assert.ok(!patterns.includes("robots.txt"));
  assert.ok(!patterns.includes("sitemap.xml"));
  assert.ok(!patterns.includes("*.xml"));
  assert.ok(!patterns.includes("*.json"));
});

test("FrontendStack publishes artifact contract and private artifact bucket without hosting resources when release id is missing", () => {
  const app = new cdk.App();
  const stack = new FrontendStack(app, "TestFrontendStack", {
    env: { account: testEnvironment.account, region: testEnvironment.region },
    environment: testEnvironment,
  });
  const template = Template.fromStack(stack);

  template.hasResourceProperties("AWS::S3::Bucket", {
    BucketName: "zoolandingpage-dev-frontend-artifacts-123456789012",
    VersioningConfiguration: {
      Status: "Enabled",
    },
    PublicAccessBlockConfiguration: {
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    },
  });
  template.hasResourceProperties("AWS::SSM::Parameter", {
    Name: "/zoolandingpage/dev/frontend/hosting-architecture",
    Type: "String",
    Value: "cloudfront-s3-lambda-ssr",
  });
  template.hasResourceProperties("AWS::SSM::Parameter", {
    Name: "/zoolandingpage/dev/frontend/static-bucket-name",
    Type: "String",
    Value: "zoolandingpage-public-files",
  });
  template.hasResourceProperties("AWS::IAM::Role", {
    RoleName: "zoolandingpage-dev-frontend-publisher",
    AssumeRolePolicyDocument: Match.objectLike({
      Statement: Match.arrayWith([
        Match.objectLike({
          Condition: {
            StringEquals: {
              "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
              "token.actions.githubusercontent.com:sub": "repo:LynxPardelle/zoolandingpage:environment:dev",
            },
          },
        }),
      ]),
    }),
  });
  assert.equal(Object.keys(template.findResources("AWS::CloudFront::Distribution")).length, 0);
  assert.equal(Object.keys(template.findResources("AWS::Lambda::Function")).length, 0);
  assert.equal(Object.keys(template.findResources("AWS::Route53::RecordSet")).length, 0);
});

test("FrontendStack deploys Lambda SSR and CloudFront distributions when release id is configured", () => {
  const app = new cdk.App();
  const environment = {
    ...testEnvironment,
    frontendHosting: {
      ...testEnvironment.frontendHosting,
      releaseId: "test-release",
      manifestKey: "frontend/angular-ssr/dev/releases/test-release/manifest.json",
      staticPrefix: "frontend/angular-ssr/dev/releases/test-release/browser",
      serverBundleKey: "frontend/angular-ssr/dev/releases/test-release/server/ssr-handler.zip",
      frontDoors: [
        testEnvironment.frontendHosting.frontDoors[0],
        {
          id: "brand",
          domainName: "zoositioweb.com.mx",
          alternateDomainNames: ["sulandingpage.com.mx"],
          certificateArn: "arn:aws:acm:us-east-1:123456789012:certificate/brand",
          aliasRecordGroups: [
            {
              hostedZoneName: "zoositioweb.com.mx",
              hostedZoneId: "Z02338361297KZ2ZAC5WY",
              domainNames: ["zoositioweb.com.mx"],
            },
            {
              hostedZoneName: "sulandingpage.com.mx",
              hostedZoneId: "Z02346862HM1PQ6VRIBM2",
              domainNames: ["sulandingpage.com.mx"],
            },
          ],
        },
      ],
    },
  };
  const stack = new FrontendStack(app, "TestFrontendHostingStack", {
    env: { account: environment.account, region: environment.region },
    environment,
  });
  const template = Template.fromStack(stack);

  template.hasResourceProperties("AWS::Lambda::Function", {
    FunctionName: "zoolandingpage-dev-frontend-ssr",
    Runtime: "nodejs22.x",
    Handler: "index.handler",
    MemorySize: 512,
    Timeout: 15,
    Architectures: ["arm64"],
    Code: {
      S3Bucket: {
        Ref: Match.stringLikeRegexp("FrontendArtifactBucket"),
      },
      S3Key: "frontend/angular-ssr/dev/releases/test-release/server/ssr-handler.zip",
    },
    Environment: {
      Variables: Match.objectLike({
        CONFIG_API_URL: "https://api.zoolandingpage.com.mx",
        CONFIG_API_SERVER_FALLBACK_URL: "https://example.execute-api.us-east-1.amazonaws.com/Prod",
        ZLP_RUNTIME_ENV: "test",
      }),
    },
  });
  template.hasResourceProperties("AWS::Lambda::Url", {
    AuthType: "AWS_IAM",
  });
  template.hasResourceProperties("AWS::Lambda::Permission", {
    Action: "lambda:InvokeFunctionUrl",
    Principal: "cloudfront.amazonaws.com",
    FunctionUrlAuthType: "AWS_IAM",
  });
  template.resourceCountIs("AWS::CloudFront::Distribution", 2);
  template.resourceCountIs("AWS::CloudFront::Function", 2);
  template.hasResourceProperties("AWS::CloudFront::Distribution", {
    DistributionConfig: Match.objectLike({
      Aliases: ["dev.zoolandingpage.com.mx"],
      PriceClass: "PriceClass_100",
    }),
  });
  template.hasResourceProperties("AWS::CloudFront::Distribution", {
    DistributionConfig: Match.objectLike({
      Aliases: ["zoositioweb.com.mx", "sulandingpage.com.mx"],
      PriceClass: "PriceClass_100",
    }),
  });
  const responsePolicies = template.findResources("AWS::CloudFront::ResponseHeadersPolicy");
  const responsePolicy = Object.values(responsePolicies)[0];
  assert.equal(
    responsePolicy.Properties.ResponseHeadersPolicyConfig.SecurityHeadersConfig.ContentSecurityPolicy,
    undefined
  );
  const distributions = template.findResources("AWS::CloudFront::Distribution");
  for (const distribution of Object.values(distributions)) {
    const defaultAssociations = distribution.Properties.DistributionConfig.DefaultCacheBehavior.FunctionAssociations;
    assert.equal(defaultAssociations.length, 1);
    assert.equal(defaultAssociations[0].EventType, "viewer-request");
    const pathPatterns = distribution.Properties.DistributionConfig.CacheBehaviors.map((behavior) => behavior.PathPattern);
    for (const expectedPattern of ["assets/*", "*.js", "*.css", "*.svg", "manifest.webmanifest"]) {
      assert.ok(pathPatterns.includes(expectedPattern), `missing static behavior for ${expectedPattern}`);
    }
    for (const dynamicPattern of ["robots.txt", "sitemap.xml", "*.xml", "*.json"]) {
      assert.ok(!pathPatterns.includes(dynamicPattern), `dynamic pattern should stay on SSR: ${dynamicPattern}`);
    }
  }
  template.resourceCountIs("Custom::ZoolandingFrontendAliasRecords", 0);
  template.hasResourceProperties("AWS::Logs::LogGroup", {
    LogGroupName: "/aws/lambda/zoolandingpage-dev-frontend-ssr",
    RetentionInDays: 30,
  });
});

test("FrontendStack creates scoped test OIDC roles for backend SAM deployments", () => {
  const app = new cdk.App();
  const environment = {
    ...testEnvironment,
    name: "test",
    branch: "test",
    frontendHosting: {
      ...testEnvironment.frontendHosting,
      githubEnvironment: "test",
    },
  };
  const stack = new FrontendStack(app, "TestBackendDeployRolesStack", {
    env: { account: environment.account, region: environment.region },
    environment,
  });
  const template = Template.fromStack(stack);
  const resources = template.toJSON().Resources;

  assert.ok(resources.ConfigAuthoringTestDeployRoleD18F6A7E);
  assert.ok(resources.DataDropperTestDeployRole3CA98201);

  for (const [roleName, repository, ref] of [
    ["zoolanding-config-authoring-test-deploy", "zoolanding-config-authoring", "refs/heads/test"],
    ["zoolanding-data-dropper-test-deploy", "zoolanding-data-dropper-lambda", "refs/heads/test"],
  ]) {
    template.hasResourceProperties("AWS::IAM::Role", {
      RoleName: roleName,
      AssumeRolePolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Condition: {
              StringEquals: {
                "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
                "token.actions.githubusercontent.com:sub": `repo:LynxPardelle/${repository}:environment:test`,
                "token.actions.githubusercontent.com:ref": ref,
              },
            },
          }),
        ]),
      }),
    });
  }

  for (const stackName of ["zoolanding-config-authoring-test", "zoolanding-data-dropper-test"]) {
    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(["cloudformation:CreateChangeSet", "cloudformation:ContinueUpdateRollback", "cloudformation:ExecuteChangeSet"]),
            Resource: Match.arrayWith([
              Match.objectLike({ "Fn::Join": Match.anyValue() }),
            ]),
          }),
        ]),
      }),
      Roles: Match.anyValue(),
    });
    assert.match(JSON.stringify(template.toJSON()), new RegExp(stackName));
  }
  const testConfigPolicy = Object.values(resources).find((resource) => (
    resource.Type === "AWS::IAM::Policy"
    && JSON.stringify(resource.Properties.Roles).includes("ConfigAuthoringTestDeployRole")
  ));
  assert.ok(testConfigPolicy);
  assert.equal(
    testConfigPolicy.Properties.PolicyDocument.Statement.some((statement) => (
      statement.Action === "cloudformation:DescribeStacks"
    )),
    false,
    "the test role must not receive a separate cross-environment read grant"
  );
});

test("FrontendStack creates bounded Runtime Read deployment identities", () => {
  for (const definition of [
    {
      name: "test",
      branch: "test",
      githubEnvironment: "test",
      apiId: "testruntime1",
      stackName: "zoolanding-config-runtime-read-test",
      packagingPrefix: "zoolanding-config-runtime-read-test",
      functionName: "zoolanding-config-runtime-test-function",
      executionRoleName: "zoolanding-config-runtime-test-role",
      samArtifactBucketName: "aws-sam-cli-managed-default-samclisourcebucket-testfixture",
      configTableName: "zoolanding-config-registry-test",
      configPayloadsBucketName: "zoolanding-config-payloads-test",
    },
    {
      name: "production",
      branch: "main",
      githubEnvironment: "production",
      apiId: "prodruntime1",
      stackName: "zoolanding-config-runtime-read",
      packagingPrefix: "zoolanding-config-runtime-read",
      functionName: "zoolanding-config-runtime-production-function",
      executionRoleName: "zoolanding-config-runtime-production-role",
      samArtifactBucketName: "aws-sam-cli-managed-default-samclisourcebucket-prodfixture",
      configTableName: "zoolanding-config-registry",
      configPayloadsBucketName: "zoolanding-config-payloads",
    },
  ]) {
    const environment = {
      ...testEnvironment,
      name: definition.name,
      branch: definition.branch,
      removalPolicy: definition.name === "production" ? "retain" : "destroy",
      runtimeReadDeployment: {
        stackName: definition.stackName,
        apiId: definition.apiId,
        functionName: definition.functionName,
        executionRoleName: definition.executionRoleName,
        samArtifactBucketName: definition.samArtifactBucketName,
        samArtifactPrefix: definition.packagingPrefix,
        configTableName: definition.configTableName,
        configPayloadsBucketName: definition.configPayloadsBucketName,
        contentHubMetadataTableNames: ["content-hub-test", "content-hub-production"],
        contentHubPackageBucketNames: ["content-hub-packages-test", "content-hub-packages-production"],
      },
      frontendHosting: {
        ...testEnvironment.frontendHosting,
        githubEnvironment: definition.githubEnvironment,
        configApiServerFallbackUrl: `https://${definition.apiId}.execute-api.us-east-1.amazonaws.com/Prod`,
      },
    };
    const template = Template.fromStack(new FrontendStack(
      new cdk.App(),
      `RuntimeRead${definition.name}DeployRoleStack`,
      { env: { account: environment.account, region: environment.region }, environment }
    ));
    const resources = template.toJSON().Resources;
    const githubRoleEntry = Object.entries(resources).find(([, resource]) => (
      resource.Type === "AWS::IAM::Role"
      && resource.Properties.RoleName === `zoolanding-config-runtime-read-${definition.githubEnvironment}-github-deploy`
    ));
    assert.ok(githubRoleEntry, `missing Runtime Read GitHub role for ${definition.name}`);
    const [githubRoleLogicalId, githubRoleResource] = githubRoleEntry;
    const trust = githubRoleResource.Properties.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals;
    assert.equal(trust["token.actions.githubusercontent.com:aud"], "sts.amazonaws.com");
    assert.equal(
      trust["token.actions.githubusercontent.com:sub"],
      `repo:LynxPardelle/zoolanding-config-runtime-read:environment:${definition.githubEnvironment}`
    );
    assert.equal(
      trust["token.actions.githubusercontent.com:ref"],
      definition.name === "test" ? "refs/heads/test" : "refs/heads/main"
    );

    const githubPolicy = Object.values(resources).find((resource) => (
      resource.Type === "AWS::IAM::Policy"
      && JSON.stringify(resource.Properties.Roles).includes(githubRoleLogicalId)
    ));
    assert.ok(githubPolicy, `missing Runtime Read GitHub policy for ${definition.name}`);
    const githubStatements = githubPolicy.Properties.PolicyDocument.Statement;
    const serializedGithubPolicy = JSON.stringify(githubPolicy.Properties.PolicyDocument);
    assert.doesNotMatch(serializedGithubPolicy, /lambda:/);
    assert.doesNotMatch(serializedGithubPolicy, /apigateway:/);
    const githubActions = githubStatements.flatMap((statement) => (
      Array.isArray(statement.Action) ? statement.Action : [statement.Action]
    ));
    assert.deepEqual(githubActions.filter((action) => action.startsWith("iam:")), ["iam:PassRole"]);
    const summaryStatement = githubStatements.find((statement) => statement.Action === "cloudformation:GetTemplateSummary");
    assert.ok(summaryStatement);
    assert.match(JSON.stringify(summaryStatement.Resource), new RegExp(definition.stackName));
    assert.equal(
      githubStatements.filter((statement) => statement.Resource === "*").length,
      0,
      "the GitHub role must not use an explicit wildcard resource"
    );
    const passCloudFormationRole = githubStatements.find((statement) => statement.Action === "iam:PassRole");
    assert.ok(passCloudFormationRole);
    assert.match(JSON.stringify(passCloudFormationRole.Resource), /RuntimeReadCloudFormationExecutionRole/);
    assert.equal(passCloudFormationRole.Condition.StringEquals["iam:PassedToService"], "cloudformation.amazonaws.com");
    const createChangeSet = githubStatements.find((statement) => (
      statement.Action === "cloudformation:CreateChangeSet"
      || (Array.isArray(statement.Action) && statement.Action.includes("cloudformation:CreateChangeSet"))
    ));
    assert.match(JSON.stringify(createChangeSet.Condition), /cloudformation:RoleArn/);
    assert.match(serializedGithubPolicy, new RegExp(definition.stackName));
    assert.match(serializedGithubPolicy, new RegExp(definition.packagingPrefix));
    assert.match(serializedGithubPolicy, new RegExp(definition.samArtifactBucketName));
    assert.doesNotMatch(serializedGithubPolicy, /samclisourcebucket-\*/);

    const cloudFormationRoleEntry = Object.entries(resources).find(([, resource]) => (
      resource.Type === "AWS::IAM::Role"
      && resource.Properties.RoleName ===
        `zoolanding-config-runtime-read-${definition.githubEnvironment}-cfn-exec`
    ));
    assert.ok(cloudFormationRoleEntry, `missing Runtime Read CloudFormation role for ${definition.name}`);
    const [cloudFormationRoleLogicalId, cloudFormationRoleResource] = cloudFormationRoleEntry;
    assert.equal(
      cloudFormationRoleResource.Properties.AssumeRolePolicyDocument.Statement[0].Principal.Service,
      "cloudformation.amazonaws.com"
    );
    const cloudFormationPolicy = Object.values(resources).find((resource) => (
      resource.Type === "AWS::IAM::Policy"
      && JSON.stringify(resource.Properties.Roles).includes(cloudFormationRoleLogicalId)
    ));
    assert.ok(cloudFormationPolicy);
    const serializedCloudFormationPolicy = JSON.stringify(cloudFormationPolicy.Properties.PolicyDocument);
    assert.match(serializedCloudFormationPolicy, new RegExp(definition.apiId));
    assert.match(serializedCloudFormationPolicy, new RegExp(definition.functionName));
    assert.match(serializedCloudFormationPolicy, new RegExp(definition.executionRoleName));
    const samTransformStatements = cloudFormationPolicy.Properties.PolicyDocument.Statement.filter(
      (statement) => statement.Action === "cloudformation:CreateChangeSet"
    );
    assert.equal(samTransformStatements.length, 1, "the SAM transform grant must exist exactly once");
    assert.notEqual(samTransformStatements[0].Resource, "*");
    assert.deepEqual(samTransformStatements[0].Resource, {
      "Fn::Join": [
        "",
        [
          "arn:",
          { Ref: "AWS::Partition" },
          `:cloudformation:${environment.region}:aws:transform/Serverless-2016-10-31`,
        ],
      ],
    });
    assert.match(serializedCloudFormationPolicy, /iam:PutRolePermissionsBoundary/);
    const boundaryRollbackStatements = cloudFormationPolicy.Properties.PolicyDocument.Statement.filter(
      (statement) => statement.Action === "iam:DeleteRolePermissionsBoundary"
    );
    assert.equal(
      boundaryRollbackStatements.length,
      0,
      `the completed ${definition.name} migration must not retain boundary rollback permission`
    );
    assert.match(serializedCloudFormationPolicy, /lambda:GetPolicy/);
    assert.doesNotMatch(
      serializedCloudFormationPolicy,
      /iam:(PutRolePolicy|DeleteRolePolicy|AttachRolePolicy|DetachRolePolicy|UpdateAssumeRolePolicy|TagRole|UntagRole)/
    );
    assert.doesNotMatch(serializedCloudFormationPolicy, /iam:(CreatePolicy|CreatePolicyVersion|DeletePolicy|DeletePolicyVersion)/);

    const boundary = Object.values(resources).find((resource) => (
      resource.Type === "AWS::IAM::ManagedPolicy"
      && resource.Properties.ManagedPolicyName ===
        `zoolanding-config-runtime-read-${definition.githubEnvironment}-execution-boundary`
    ));
    assert.ok(boundary, `missing Runtime Read permissions boundary for ${definition.name}`);
    const boundaryStatements = boundary.Properties.PolicyDocument.Statement;
    const serializedBoundary = JSON.stringify(boundary.Properties.PolicyDocument);
    assert.match(serializedBoundary, new RegExp(definition.configTableName));
    assert.match(serializedBoundary, new RegExp(definition.configPayloadsBucketName));
    assert.match(serializedBoundary, /DenyServerOnlyDraftDescriptors/);
    assert.doesNotMatch(serializedBoundary, /secretsmanager:|iam:|lambda:|apigateway:|sts:/);
    assert.doesNotMatch(serializedBoundary, /logs:CreateLogGroup/);
    const payloadList = boundaryStatements.find((statement) => statement.Action === "s3:ListBucket");
    assert.ok(payloadList, "optional payload misses require ListBucket to preserve S3 404 semantics");
    assert.match(JSON.stringify(payloadList.Resource), new RegExp(definition.configPayloadsBucketName));
    assert.doesNotMatch(JSON.stringify(payloadList.Resource), /content-hub/);
    const registryQuery = boundaryStatements.find((statement) => (
      (Array.isArray(statement.Action) ? statement.Action : [statement.Action]).includes("dynamodb:Query")
      && JSON.stringify(statement.Resource).includes(definition.configTableName)
    ));
    assert.equal(registryQuery, undefined, "the registry needs GetItem, not Query");
    const wildcardBoundaryActions = boundaryStatements
      .filter((statement) => statement.Resource === "*")
      .flatMap((statement) => Array.isArray(statement.Action) ? statement.Action : [statement.Action]);
    assert.deepEqual(
      wildcardBoundaryActions.sort(),
      [
        "xray:GetSamplingRules",
        "xray:GetSamplingStatisticSummaries",
        "xray:GetSamplingTargets",
        "xray:PutTelemetryRecords",
        "xray:PutTraceSegments",
      ].sort()
    );
  }
});

test("FrontendStack does not create backend SAM deployment roles for dev", () => {
  const app = new cdk.App();
  const environment = {
    ...testEnvironment,
    name: "dev",
    branch: "dev",
    frontendHosting: { ...testEnvironment.frontendHosting, githubEnvironment: "dev" },
  };
  const template = Template.fromStack(new FrontendStack(app, "DevBackendDeployRolesStack", {
    env: { account: environment.account, region: environment.region },
    environment,
  }));

  template.resourceCountIs("AWS::IAM::Role", 1);
  assert.doesNotMatch(JSON.stringify(template.toJSON()), /zoolanding-config-authoring-dev/);
  assert.doesNotMatch(JSON.stringify(template.toJSON()), /zoolanding-data-dropper-dev/);
  assert.doesNotMatch(JSON.stringify(template.toJSON()), /zoolanding-config-runtime-read-dev/);
});

test("FrontendStack creates scoped production OIDC roles for backend SAM deployments", () => {
  const app = new cdk.App();
  const environment = {
    ...testEnvironment,
    name: "production",
    branch: "main",
    removalPolicy: "retain",
    frontendHosting: { ...testEnvironment.frontendHosting, githubEnvironment: "production" },
  };
  const template = Template.fromStack(new FrontendStack(app, "ProductionBackendDeployRolesStack", {
    env: { account: environment.account, region: environment.region },
    environment,
  }));
  const resources = template.toJSON().Resources;

  for (const [roleName, repository, ref] of [
    ["zoolanding-config-authoring-production-deploy", "zoolanding-config-authoring", "refs/heads/main"],
    ["zoolanding-data-dropper-production-deploy", "zoolanding-data-dropper-lambda", "refs/heads/main"],
  ]) {
    template.hasResourceProperties("AWS::IAM::Role", {
      RoleName: roleName,
      AssumeRolePolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([Match.objectLike({ Condition: { StringEquals: {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": `repo:LynxPardelle/${repository}:environment:production`,
          "token.actions.githubusercontent.com:ref": ref,
        } } })]),
      }),
    });
  }

  const configAuthoringPolicy = Object.values(resources).find((resource) => (
    resource.Type === "AWS::IAM::Policy"
    && JSON.stringify(resource.Properties.Roles).includes("ConfigAuthoringProductionDeployRole")
  ));
  assert.ok(configAuthoringPolicy, "missing config authoring production deploy policy");
  const testStackRead = configAuthoringPolicy.Properties.PolicyDocument.Statement.find((statement) => (
    statement.Action === "cloudformation:DescribeStacks"
  ));
  assert.ok(testStackRead, "production config authoring role must read the exact test stack outputs");
  assert.match(JSON.stringify(testStackRead.Resource), /stack\/zoolanding-config-authoring-test\/\*/);
  assert.doesNotMatch(JSON.stringify(testStackRead.Resource), /zoolanding-data-dropper-test/);
  assert.notEqual(testStackRead.Resource, "*");
  const versionedArtifactRead = configAuthoringPolicy.Properties.PolicyDocument.Statement.find((statement) => (
    statement.Action === "s3:GetObjectVersion"
  ));
  assert.ok(
    versionedArtifactRead,
    "production config authoring role must read the exact pinned deployment artifact version"
  );
  const versionedArtifactResources = JSON.stringify(versionedArtifactRead.Resource);
  assert.match(versionedArtifactResources, /zoolanding-config-payloads\/\*/);
  assert.doesNotMatch(versionedArtifactResources, /payloads-test|samclisourcebucket/);
  assert.notEqual(versionedArtifactRead.Resource, "*");
  const dataDropperPolicy = Object.values(resources).find((resource) => (
    resource.Type === "AWS::IAM::Policy"
    && JSON.stringify(resource.Properties.Roles).includes("DataDropperProductionDeployRole")
  ));
  assert.ok(dataDropperPolicy);
  assert.equal(
    dataDropperPolicy.Properties.PolicyDocument.Statement.some((statement) => (
      statement.Action === "cloudformation:DescribeStacks"
    )),
    false,
    "the production data-dropper role must not receive the config-authoring test read grant"
  );
  assert.equal(
    dataDropperPolicy.Properties.PolicyDocument.Statement.some((statement) => (
      statement.Action === "s3:GetObjectVersion"
      || (Array.isArray(statement.Action) && statement.Action.includes("s3:GetObjectVersion"))
    )),
    false,
    "the production data-dropper role must not receive versioned config artifact reads"
  );
});

test("FrontendStack routes same-origin backend paths to existing serverless APIs", () => {
  const app = new cdk.App();
  const environment = {
    ...testEnvironment,
    frontendHosting: {
      ...testEnvironment.frontendHosting,
      releaseId: "test-release",
      manifestKey: "frontend/angular-ssr/dev/releases/test-release/manifest.json",
      staticPrefix: "frontend/angular-ssr/dev/releases/test-release/browser",
      serverBundleKey: "frontend/angular-ssr/dev/releases/test-release/server/ssr-handler.zip",
    },
  };
  const stack = new FrontendStack(app, "TestFrontendBackendRouteStack", {
    env: { account: environment.account, region: environment.region },
    environment,
  });
  const template = Template.fromStack(stack);

  const distribution = Object.values(template.findResources("AWS::CloudFront::Distribution"))[0];
  const behaviors = distribution.Properties.DistributionConfig.CacheBehaviors;
  const behaviorByPattern = new Map(behaviors.map((behavior) => [behavior.PathPattern, behavior]));
  for (const expectedPattern of [
    "auth/session",
    "auth/session/*",
    "auth/admin",
    "auth/admin/*",
    "features/combo-catalog/*",
    "features/content-hub/*",
    "auth/runtime-config",
    "api-proxy/*",
  ]) {
    const behavior = behaviorByPattern.get(expectedPattern);
    assert.ok(behavior, `missing backend behavior for ${expectedPattern}`);
    assert.deepEqual(behavior.AllowedMethods, ["GET", "HEAD", "OPTIONS", "PUT", "PATCH", "POST", "DELETE"]);
    assert.equal(behavior.CachePolicyId, "4135ea2d-6df8-44a3-9df3-4b5a84be39ad");
  }
  assert.equal(behaviorByPattern.has("auth/callback"), false);
  assert.equal(behaviorByPattern.has("auth/*"), false);
});

test("FrontendStack creates Route53 upsert custom resources only when record cutover is enabled", () => {
  const app = new cdk.App();
  const environment = {
    ...testEnvironment,
    frontendHosting: {
      ...testEnvironment.frontendHosting,
      releaseId: "test-release",
      manifestKey: "frontend/angular-ssr/dev/releases/test-release/manifest.json",
      staticPrefix: "frontend/angular-ssr/dev/releases/test-release/browser",
      serverBundleKey: "frontend/angular-ssr/dev/releases/test-release/server/ssr-handler.zip",
      route53RecordsEnabled: false,
      frontDoors: [
        {
          ...testEnvironment.frontendHosting.frontDoors[0],
          route53RecordsEnabled: true,
        },
      ],
    },
  };
  const stack = new FrontendStack(app, "TestFrontendRoute53Stack", {
    env: { account: environment.account, region: environment.region },
    environment,
  });
  const template = Template.fromStack(stack);

  template.resourceCountIs("Custom::ZoolandingFrontendAliasRecords", 1);
  const customResources = template.findResources("Custom::ZoolandingFrontendAliasRecords");
  const customResource = Object.values(customResources)[0];
  const createPayload = JSON.stringify(customResource.Properties.Create);
  assert.match(createPayload, /changeResourceRecordSets/);
  assert.match(createPayload, /UPSERT/);
  assert.match(createPayload, /dev\.zoolandingpage\.com\.mx\./);
  template.hasResourceProperties("AWS::SSM::Parameter", {
    Name: "/zoolandingpage/dev/frontend/route53-records-enabled",
    Type: "String",
    Value: "true",
  });
});

test("FrontendStack can deploy pre-cutover CloudFront distributions without attaching custom aliases", () => {
  const app = new cdk.App();
  const environment = {
    ...testEnvironment,
    frontendHosting: {
      ...testEnvironment.frontendHosting,
      releaseId: "test-release",
      manifestKey: "frontend/angular-ssr/dev/releases/test-release/manifest.json",
      staticPrefix: "frontend/angular-ssr/dev/releases/test-release/browser",
      serverBundleKey: "frontend/angular-ssr/dev/releases/test-release/server/ssr-handler.zip",
      frontDoors: [
        {
          ...testEnvironment.frontendHosting.frontDoors[0],
          customDomainNamesEnabled: false,
          auditHostHint: "dev.zoolandingpage.com.mx",
        },
      ],
    },
  };
  const stack = new FrontendStack(app, "TestFrontendPreCutoverStack", {
    env: { account: environment.account, region: environment.region },
    environment,
  });
  const template = Template.fromStack(stack);

  template.resourceCountIs("AWS::CloudFront::Distribution", 1);
  template.hasResourceProperties("AWS::SSM::Parameter", {
    Name: "/zoolandingpage/dev/frontend/custom-domain-names-enabled",
    Type: "String",
    Value: "false",
  });

  const distributions = template.findResources("AWS::CloudFront::Distribution");
  const distribution = Object.values(distributions)[0];
  assert.equal(distribution.Properties.DistributionConfig.Aliases, undefined);

  const functions = template.findResources("AWS::CloudFront::Function");
  const viewerFunction = Object.values(functions)[0];
  assert.match(
    viewerFunction.Properties.FunctionCode,
    /var forwardedHost = "dev\.zoolandingpage\.com\.mx";/
  );
});

test("FrontendStack redirects alternate hosts to the canonical domain before SSR", () => {
  const app = new cdk.App();
  const environment = {
    ...testEnvironment,
    frontendHosting: {
      ...testEnvironment.frontendHosting,
      releaseId: "test-release",
      manifestKey: "frontend/angular-ssr/dev/releases/test-release/manifest.json",
      staticPrefix: "frontend/angular-ssr/dev/releases/test-release/browser",
      serverBundleKey: "frontend/angular-ssr/dev/releases/test-release/server/ssr-handler.zip",
      frontDoors: [
        {
          ...testEnvironment.frontendHosting.frontDoors[0],
          domainName: "grupoastralegal.com",
          alternateDomainNames: ["www.grupoastralegal.com"],
          auditHostHint: "grupoastralegal.com",
          redirectAlternateDomainNamesToPrimary: true,
        },
      ],
    },
  };
  const stack = new FrontendStack(app, "TestFrontendCanonicalRedirectStack", {
    env: { account: environment.account, region: environment.region },
    environment,
  });
  const template = Template.fromStack(stack);
  const functions = template.findResources("AWS::CloudFront::Function");
  const viewerFunction = Object.values(functions)[0];
  const context = {};
  vm.runInNewContext(viewerFunction.Properties.FunctionCode, context);

  const redirect = context.handler({
    request: {
      headers: { host: { value: "www.grupoastralegal.com" } },
      method: "GET",
      querystring: {
        tag: { multiValue: [{ value: "one" }, { value: "two" }] },
        utm_source: { value: "qa" },
      },
      uri: "/servicios",
    },
  });

  assert.equal(redirect.statusCode, 308);
  assert.equal(
    redirect.headers.location.value,
    "https://grupoastralegal.com/servicios?tag=one&tag=two&utm_source=qa"
  );
});

test("FrontendStack does not create a retained production SSR log group that can conflict after rollback", () => {
  const app = new cdk.App();
  const environment = {
    ...testEnvironment,
    name: "production",
    removalPolicy: "retain",
    frontendHosting: {
      ...testEnvironment.frontendHosting,
      releaseId: "test-release",
      manifestKey: "frontend/angular-ssr/production/releases/test-release/manifest.json",
      staticPrefix: "frontend/angular-ssr/production/releases/test-release/browser",
      serverBundleKey: "frontend/angular-ssr/production/releases/test-release/server/ssr-handler.zip",
      frontDoors: [
        {
          ...testEnvironment.frontendHosting.frontDoors[0],
          customDomainNamesEnabled: false,
          auditHostHint: "zoolandingpage.com.mx",
        },
      ],
    },
  };
  const stack = new FrontendStack(app, "TestFrontendRetainLogGroupStack", {
    env: { account: environment.account, region: environment.region },
    environment,
  });
  const template = Template.fromStack(stack);

  template.resourceCountIs("AWS::Logs::LogGroup", 0);
  template.resourceCountIs("AWS::Lambda::Function", 1);
});

test("production front doors exclude retired zoolandingpage.com.mx aliases", () => {
  const production = environments.find((environment) => environment.name === "production");
  assert.ok(production);
  const frontDoors = production.frontendHosting.frontDoors || [];
  const configuredDomainNames = new Set(
    frontDoors.flatMap((frontDoor) => [
      frontDoor.domainName,
      ...(frontDoor.alternateDomainNames || []),
      ...(frontDoor.aliasRecordGroups || []).flatMap((group) => group.domainNames || []),
    ]).filter(Boolean)
  );
  for (const domainName of retiredZoolandingpageComMxAliases) {
    assert.equal(configuredDomainNames.has(domainName), false, `${domainName} must not be attached to CloudFront`);
  }
});

test("production front doors model Eros Barajas with traffic cutover enabled", () => {
  const production = environments.find((environment) => environment.name === "production");
  assert.ok(production);
  const erosFrontDoor = production.frontendHosting.frontDoors.find((frontDoor) => frontDoor.id === "erosbarajas");
  assert.ok(erosFrontDoor);
  assert.equal(erosFrontDoor.domainName, "erosbarajas.com");
  assert.equal(erosFrontDoor.auditHostHint, "erosbarajas.com");
  assert.match(erosFrontDoor.certificateArn, /certificate\/4b190eff-7dde-435f-933b-da411d30ab50$/);
  assert.deepEqual(erosFrontDoor.aliasRecordGroups[0].domainNames, ["erosbarajas.com"]);
  assert.equal(production.frontendHosting.route53RecordsEnabled, true);
});

test("production front doors activate Astra Legal aliases and Route53 cutover", () => {
  const production = environments.find((environment) => environment.name === "production");
  assert.ok(production);
  const astraLegal = production.frontendHosting.frontDoors.find((frontDoor) => frontDoor.id === "grupoastralegal");
  assert.ok(astraLegal);
  assert.equal(astraLegal.domainName, "grupoastralegal.com");
  assert.deepEqual(astraLegal.alternateDomainNames, ["www.grupoastralegal.com"]);
  assert.equal(astraLegal.customDomainNamesEnabled, true);
  assert.equal(astraLegal.route53RecordsEnabled, true);
  assert.equal(astraLegal.auditHostHint, "grupoastralegal.com");
  assert.equal(astraLegal.redirectAlternateDomainNamesToPrimary, true);
  assert.match(astraLegal.certificateArn, /certificate\/882ab0a9-c900-482d-ac9b-2f3baca96f40$/);
  assert.deepEqual(astraLegal.aliasRecordGroups, [
    {
      hostedZoneName: "grupoastralegal.com",
      hostedZoneId: "Z05844193OR5CAJJCR2ZJ",
      domainNames: ["grupoastralegal.com", "www.grupoastralegal.com"],
    },
  ]);
});

test("production frontend stack creates guarded alias operations OIDC role", () => {
  const app = new cdk.App();
  const production = environments.find((environment) => environment.name === "production");
  assert.ok(production);
  const stack = new FrontendStack(app, "TestProductionAliasOpsRoleStack", {
    env: { account: production.account, region: production.region },
    environment: {
      ...production,
      frontendHosting: {
        ...production.frontendHosting,
        releaseId: "",
      },
    },
  });
  const template = Template.fromStack(stack);

  template.hasResourceProperties("AWS::IAM::Role", {
    RoleName: "zoolandingpage-production-frontend-alias-ops",
    AssumeRolePolicyDocument: Match.objectLike({
      Statement: Match.arrayWith([
        Match.objectLike({
          Condition: {
            StringEquals: {
              "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
              "token.actions.githubusercontent.com:sub":
                "repo:LynxPardelle/zoolandingpage-aws-infra:environment:production",
            },
          },
        }),
      ]),
    }),
  });
  template.hasResourceProperties("AWS::IAM::Policy", {
    PolicyDocument: Match.objectLike({
      Statement: Match.arrayWith([
        Match.objectLike({
          Action: Match.arrayWith(["route53:ListResourceRecordSets", "route53:ChangeResourceRecordSets"]),
        }),
        Match.objectLike({
          Action: Match.arrayWith(["cloudfront:ListDistributions", "cloudfront:ListConflictingAliases"]),
          Resource: "*",
        }),
        Match.objectLike({
          Action: Match.arrayWith([
            "cloudfront:GetDistribution",
            "cloudfront:GetDistributionConfig",
            "cloudfront:UpdateDistribution",
          ]),
        }),
      ]),
    }),
  });
});

test("production deploy workflow passes custom domain toggle to validation and deploy", () => {
  const workflow = readFileSync(
    path.join(__dirname, "..", ".github", "workflows", "deploy-production.yml"),
    "utf8"
  );
  const occurrences = workflow.match(/FRONTEND_PRODUCTION_CUSTOM_DOMAIN_NAMES_ENABLED/g) || [];

  assert.ok(occurrences.length >= 2);
  assert.match(workflow, /FRONTEND_PRODUCTION_CUSTOM_DOMAIN_NAMES_ENABLED: \$\{\{ vars\.FRONTEND_PRODUCTION_CUSTOM_DOMAIN_NAMES_ENABLED \|\| 'false' \}\}/);
});

test("production alias ops workflow requires explicit retired alias cleanup confirmation", () => {
  const workflow = readFileSync(
    path.join(__dirname, "..", ".github", "workflows", "production-alias-ops.yml"),
    "utf8"
  );

  assert.match(workflow, /environment: production/);
  assert.match(workflow, /AWS_ALIAS_OPS_ROLE_ARN/);
  assert.doesNotMatch(workflow, /role-to-assume: \$\{\{ vars\.AWS_ROLE_ARN \}\}/);
  assert.match(workflow, /confirm_cleanup/);
  assert.match(workflow, /remove-retired-zoolandingpage-aliases/);
  assert.match(workflow, /tools\/ops\/frontend-alias-ops\.mjs/);
});
