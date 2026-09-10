"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { fixture: adminReleaseFixture } = require("./fixtures/thn-admin-selection");
const { selectThnAdminRelease } = require("../tools/thn-admin-release");
const cdk = require("aws-cdk-lib");
const { Match, Template } = require("aws-cdk-lib/assertions");

const { FrontendStack, staticPathPatterns } = require("../lib/stacks/frontend-stack");
const {
  buildParameterName,
  buildResourceName,
  removalPolicyForEnvironment,
} = require("../lib/project-helpers");
const {
  buildThnAdminTestCertificate,
  buildThnAdminTestFrontDoor,
  environments,
  retiredZoolandingpageComMxAliases,
} = require("../config/environments");

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

const THN_ADMIN_HOST = "admin-test.thehairnarrative.com";
const THN_ADMIN_INPUTS = {
  ...adminReleaseFixture().inputs,
  FRONTEND_TEST_THN_ADMIN_ORIGIN_ENABLED: "true",
  FRONTEND_TEST_THN_ADMIN_CERTIFICATE_ARN:
    "arn:aws:acm:us-east-1:123456789012:certificate/thn-admin-test",
  FRONTEND_TEST_THN_ADMIN_HOSTED_ZONE_ID: "ZTHNFIXTURE",
  FRONTEND_TEST_THN_ADMIN_ROUTE53_RECORDS_ENABLED: "true",
};

const releasedTestFrontend = environments.find(
  (environment) => environment.name === "test"
).frontendHosting;
const releasedTestBackendOwner = (id) => {
  const owner = releasedTestFrontend.backendRoutes.find((backendRoute) => backendRoute.id === id);
  return { domainName: owner.domainName, originPath: owner.originPath };
};
const THN_TRUSTED_TEST_API_FRONT_DOORS = {
  apiProxy: releasedTestBackendOwner("api-proxy"),
  authAdmin: releasedTestBackendOwner("auth-admin"),
  contentHub: releasedTestBackendOwner("content-hub"),
};

function buildFixtureThnAdminFrontDoor(
  source = THN_ADMIN_INPUTS,
  trustedApiFrontDoors = THN_TRUSTED_TEST_API_FRONT_DOORS
) {
  return buildThnAdminTestFrontDoor(
    source,
    testEnvironment.account,
    trustedApiFrontDoors
  );
}

function releasedEnvironmentWithThnAdmin(environmentName = "test") {
  const frontDoor = buildFixtureThnAdminFrontDoor();
  const backendOwnerFixtures = {
    "api-proxy": THN_TRUSTED_TEST_API_FRONT_DOORS.apiProxy,
    "auth-admin": THN_TRUSTED_TEST_API_FRONT_DOORS.authAdmin,
    "content-hub": THN_TRUSTED_TEST_API_FRONT_DOORS.contentHub,
  };
  return {
    ...testEnvironment,
    name: environmentName,
    branch: environmentName === "production" ? "main" : "test",
    stageId: environmentName === "production" ? "ZoolandingProductionFixture" : "ZoolandingTestFixture",
    frontendHosting: {
      ...testEnvironment.frontendHosting,
      releaseId: "test-release",
      manifestKey: `frontend/angular-ssr/${environmentName}/releases/test-release/manifest.json`,
      staticPrefix: `frontend/angular-ssr/${environmentName}/releases/test-release/browser`,
      serverBundleKey: `frontend/angular-ssr/${environmentName}/releases/test-release/server/ssr-handler.zip`,
      backendRoutes: testEnvironment.frontendHosting.backendRoutes.map((backendRoute) => (
        backendOwnerFixtures[backendRoute.id]
          ? { ...backendRoute, ...backendOwnerFixtures[backendRoute.id] }
          : backendRoute
      )),
      frontDoors: [testEnvironment.frontendHosting.frontDoors[0], frontDoor],
    },
  };
}

let thnAdminFixtureTemplate;

function synthesizeThnAdminFixture() {
  if (thnAdminFixtureTemplate) {
    return thnAdminFixtureTemplate;
  }
  const environment = releasedEnvironmentWithThnAdmin();
  const app = new cdk.App();
  const stack = new FrontendStack(app, "TestThnAdminFrontendStack", {
    env: { account: environment.account, region: environment.region },
    environment,
  });
  thnAdminFixtureTemplate = Template.fromStack(stack);
  return thnAdminFixtureTemplate;
}

function assertThnAdminFrontDoorRejected(mutator, expectedError) {
  const environment = releasedEnvironmentWithThnAdmin();
  const adminIndex = environment.frontendHosting.frontDoors.findIndex(
    (frontDoor) => frontDoor.domainName === THN_ADMIN_HOST
  );
  const original = environment.frontendHosting.frontDoors[adminIndex];
  environment.frontendHosting.frontDoors[adminIndex] = mutator({
    ...original,
    aliasRecordGroups: original.aliasRecordGroups.map((group) => ({
      ...group,
      domainNames: [...group.domainNames],
    })),
    backendRoutes: original.backendRoutes.map((backendRoute) => ({
      ...backendRoute,
      routes: backendRoute.routes.map((route) => ({
        ...route,
        methods: [...route.methods],
      })),
    })),
    pageRoutes: original.pageRoutes.map((route) => ({
      ...route,
      methods: [...route.methods],
    })),
    staticAssetPaths: [...original.staticAssetPaths],
  });

  const app = new cdk.App();
  assert.throws(
    () => new FrontendStack(app, `RejectedThnAdmin${Math.random().toString(16).slice(2)}`, {
      env: { account: environment.account, region: environment.region },
      environment,
    }),
    expectedError
  );
}

function distributionForAlias(template, alias) {
  return Object.values(template.findResources("AWS::CloudFront::Distribution")).find((resource) =>
    (resource.Properties.DistributionConfig.Aliases || []).includes(alias)
  );
}

function viewerHandlerForDistribution(template, distribution) {
  const association = distribution.Properties.DistributionConfig.DefaultCacheBehavior.FunctionAssociations.find(
    (item) => item.EventType === "viewer-request"
  );
  assert.ok(association, "missing viewer-request fence");
  const functionLogicalId = association.FunctionARN["Fn::GetAtt"][0];
  const resources = template.toJSON().Resources;
  const edgeFunction = resources[functionLogicalId];
  assert.ok(edgeFunction, `missing CloudFront Function ${functionLogicalId}`);
  const context = {};
  vm.runInNewContext(edgeFunction.Properties.FunctionCode, context);
  return {
    functionArn: association.FunctionARN,
    functionCode: edgeFunction.Properties.FunctionCode,
    handler: context.handler,
  };
}

function cloudFrontRequest({
  host = THN_ADMIN_HOST,
  method = "GET",
  uri = "/admin/journal",
  querystring = {},
  viewerIp = "198.51.100.42",
} = {}) {
  return {
    viewer: { ip: viewerIp },
    request: {
      headers: { host: { value: host } },
      method,
      querystring,
      uri,
    },
  };
}

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
    const statementActions = (statement) => (
      Array.isArray(statement.Action) ? statement.Action : [statement.Action]
    );
    const serializedGithubPolicy = JSON.stringify(githubPolicy.Properties.PolicyDocument);
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
    const githubLambdaStatements = githubStatements.filter((statement) => (
      statementActions(statement).some((action) => action.startsWith("lambda:"))
    ));
    if (definition.name === "test") {
      assert.equal(githubLambdaStatements.length, 2);
      const githubAliasRead = githubLambdaStatements.find((statement) => (
        statementActions(statement).includes("lambda:GetAlias")
      ));
      assert.deepEqual(statementActions(githubAliasRead), ["lambda:GetAlias"]);
      const serializedAliasReadResources = JSON.stringify(githubAliasRead.Resource);
      assert.match(serializedAliasReadResources, new RegExp(`function:${definition.functionName}"`));
      assert.doesNotMatch(serializedAliasReadResources, new RegExp(`function:${definition.functionName}:live`));
      const githubVersionRead = githubLambdaStatements.find((statement) => (
        statementActions(statement).includes("lambda:GetFunctionConfiguration")
      ));
      assert.deepEqual(statementActions(githubVersionRead), ["lambda:GetFunctionConfiguration"]);
      assert.match(JSON.stringify(githubVersionRead.Resource), new RegExp(`function:${definition.functionName}:\\*`));
    } else {
      assert.equal(githubLambdaStatements.length, 0, "production caller must keep its existing scope");
    }
    assert.equal(githubActions.includes("cloudformation:DescribeStackResource"), false);

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
    const requiredAliasVersionActions = [
      "lambda:CreateAlias",
      "lambda:DeleteAlias",
      "lambda:GetAlias",
      "lambda:ListVersionsByFunction",
      "lambda:PublishVersion",
      "lambda:UpdateAlias",
    ].sort();
    const cloudFormationStatements = cloudFormationPolicy.Properties.PolicyDocument.Statement;
    const aliasVersionStatements = cloudFormationStatements.filter((statement) => (
      statementActions(statement).some((action) => requiredAliasVersionActions.includes(action))
    ));

    assert.equal(
      aliasVersionStatements.length,
      definition.name === "test" ? 1 : 0,
      `Runtime Read ${definition.name} alias/version grant has the expected environment scope`
    );
    if (definition.name === "test") {
      const aliasVersionStatement = aliasVersionStatements[0];
      assert.deepEqual(
        statementActions(aliasVersionStatement).sort(),
        requiredAliasVersionActions
      );
      assert.deepEqual(aliasVersionStatement.Resource, {
        "Fn::Join": [
          "",
          [
            "arn:",
            { Ref: "AWS::Partition" },
            `:lambda:${environment.region}:${environment.account}:function:${definition.functionName}`,
          ],
        ],
      });
    }
    const permissionActions = [
      "lambda:AddPermission",
      "lambda:GetPolicy",
      "lambda:RemovePermission",
    ].sort();
    const livePermissionStatements = cloudFormationStatements.filter((statement) => (
      JSON.stringify(statement.Resource).includes(`function:${definition.functionName}:live`)
    ));
    assert.equal(
      livePermissionStatements.length,
      definition.name === "test" ? 1 : 0,
      `Runtime Read ${definition.name} live permission migration has the expected environment scope`
    );
    if (definition.name === "test") {
      assert.deepEqual(statementActions(livePermissionStatements[0]).sort(), permissionActions);
      assert.deepEqual(livePermissionStatements[0].Resource, {
        "Fn::Join": [
          "",
          [
            "arn:",
            { Ref: "AWS::Partition" },
            `:lambda:${environment.region}:${environment.account}:function:${definition.functionName}:live`,
          ],
        ],
      });
    }
    const qualifiedVersionReadStatements = cloudFormationStatements.filter((statement) => (
      JSON.stringify(statement.Resource).includes(`function:${definition.functionName}:*`)
    ));
    assert.equal(
      qualifiedVersionReadStatements.length,
      definition.name === "test" ? 1 : 0,
      `Runtime Read ${definition.name} qualified version read has the expected environment scope`
    );
    if (definition.name === "test") {
      assert.deepEqual(statementActions(qualifiedVersionReadStatements[0]), [
        "lambda:GetFunctionConfiguration",
        "lambda:GetFunctionScalingConfig",
        "lambda:GetProvisionedConcurrencyConfig",
        "lambda:GetRuntimeManagementConfig",
      ]);
      assert.deepEqual(qualifiedVersionReadStatements[0].Resource, {
        "Fn::Join": [
          "",
          [
            "arn:",
            { Ref: "AWS::Partition" },
            `:lambda:${environment.region}:${environment.account}:function:${definition.functionName}:*`,
          ],
        ],
      });
    }
    const cloudFormationActions = cloudFormationStatements.flatMap(statementActions);
    assert.equal(cloudFormationActions.includes("lambda:DeleteFunction"), false);
    assert.equal(cloudFormationActions.includes("lambda:*"), false);
    const serializedCloudFormationPolicy = JSON.stringify(cloudFormationPolicy.Properties.PolicyDocument);
    assert.match(serializedCloudFormationPolicy, new RegExp(definition.apiId));
    assert.match(serializedCloudFormationPolicy, new RegExp(definition.functionName));
    assert.match(serializedCloudFormationPolicy, new RegExp(definition.executionRoleName));
    const samTransformStatements = cloudFormationPolicy.Properties.PolicyDocument.Statement.filter(
      (statement) => statement.Action === "cloudformation:CreateChangeSet"
    );
    assert.equal(samTransformStatements.length, 1, "the required transform grant must exist exactly once");
    assert.notEqual(samTransformStatements[0].Resource, "*");
    const serverlessTransformResource = {
      "Fn::Join": [
        "",
        [
          "arn:",
          { Ref: "AWS::Partition" },
          `:cloudformation:${environment.region}:aws:transform/Serverless-2016-10-31`,
        ],
      ],
    };
    const expectedTransformResources = definition.name === "test"
      ? [{
        "Fn::Join": [
          "",
          [
            "arn:",
            { Ref: "AWS::Partition" },
            `:cloudformation:${environment.region}:aws:transform/LanguageExtensions`,
          ],
        ],
      }, serverlessTransformResource]
      : serverlessTransformResource;
    assert.deepEqual(samTransformStatements[0].Resource, expectedTransformResources);
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
  assert.equal(
    viewerFunction.Properties.FunctionCode,
    `function handler(event) {
  var request = event.request;
  var forwardedHost = "dev.zoolandingpage.com.mx";
  if (forwardedHost) {
    request.headers["x-forwarded-host"] = { value: forwardedHost };
  }
  return request;
}`
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

test("test deploy workflow targets only the frontend stack", () => {
  const workflow = readFileSync(
    path.join(__dirname, "..", ".github", "workflows", "deploy-test.yml"),
    "utf8"
  );
  const runner = readFileSync(
    path.join(__dirname, "..", "tools", "run-test-infra-change-set.sh"),
    "utf8"
  );

  assert.match(workflow, /STACK_PATH: ZoolandingTest\/Zoolandingpage-test-Frontend/);
  assert.match(workflow, /STACK_NAME: ZoolandingTest-Zoolandingpage-test-Frontend/);
  assert.match(runner, /EXPECTED_STACK="ZoolandingTest-Zoolandingpage-test-Frontend"/);
  assert.match(runner, /EXPECTED_STACK_PATH="ZoolandingTest\/Zoolandingpage-test-Frontend"/);
  assert.match(runner, /--method prepare-change-set/);
  assert.match(runner, /--require-approval never/);
  assert.match(runner, /--exclusively/);
  assert.doesNotMatch(workflow, /ZoolandingTest\/\*/);
  assert.match(workflow, /FRONTEND_TEST_RELEASE_ID: \$\{\{ vars\.FRONTEND_RELEASE_ID \}\}/);
  assert.match(workflow, /EVENT_NAME: \$\{\{ github\.event_name \}\}/);
  assert.match(workflow, /test -n "\$FRONTEND_TEST_RELEASE_ID"/);
  assert.match(workflow, /infra-test-aws\.js verify-public-release/);
  const awsHelper = readFileSync(path.join(__dirname, "..", "tools", "infra-test-aws.js"), "utf8");
  assert.match(awsHelper, /const STACK = "ZoolandingTest-Zoolandingpage-test-Frontend"/);
  assert.match(awsHelper, /item.OutputKey === "FrontendReleaseId"/);
  assert.match(workflow, /if \[ "\$EVENT_NAME" = "push" \]; then/);
  assert.match(awsHelper, /releases\[0\].OutputValue !== artifact.metadata.frontend_release_id/);
});

test("TEST synthesis preserves the retained prerequisite certificate even while its front door is off", () => {
  assert.equal(typeof buildThnAdminTestCertificate, "function");
  assert.equal(buildThnAdminTestCertificate({}, "123456789012"), null);
  const source = { FRONTEND_TEST_THN_ADMIN_CERTIFICATE_ARN: "arn:aws:acm:us-east-1:123456789012:certificate/fixture",
    FRONTEND_TEST_THN_ADMIN_HOSTED_ZONE_ID: "ZTHNFIXTURE", FRONTEND_TEST_THN_ADMIN_ORIGIN_ENABLED: "false" };
  const certificate = buildThnAdminTestCertificate(source, "123456789012");
  assert.throws(() => buildThnAdminTestCertificate({ ...source, FRONTEND_TEST_THN_ADMIN_HOSTED_ZONE_ID: "" }, "123456789012"));
  const app = new cdk.App();
  const environment = { ...testEnvironment, name: "test", frontendHosting: { ...testEnvironment.frontendHosting, thnAdminCertificate: certificate } };
  const template = Template.fromStack(new FrontendStack(app, "RetainedCertificateFixture", { env: { account: environment.account, region: environment.region }, environment })).toJSON();
  const resource = template.Resources.ThnAdminTestCertificate;
  const { composeTemplate } = require("../tools/thn-test-prerequisites");
  const expected = composeTemplate({ Resources: {} }, "certificate", { zoneId: "ZTHNFIXTURE", anchors: { zone: require("node:crypto").createHash("sha256").update("ZTHNFIXTURE").digest("hex") } }).Resources.ThnAdminTestCertificate;
  assert.deepEqual(resource, expected);
  assert.ok(!Object.values(template.Resources).some(item => item.Type === "AWS::CloudFront::Distribution"));
  const production = { ...environment, name: "production" };
  assert.throws(() => new FrontendStack(new cdk.App(), "NoProductionCertificate", { env: { account: environment.account, region: environment.region }, environment: production }), /THN.*TEST/);
});

test("test deploy workflow injects the THN Auth Admin origin proof without storing it", () => {
  const workflow = readFileSync(
    path.join(__dirname, "..", ".github", "workflows", "deploy-test.yml"),
    "utf8"
  );
  const runner = readFileSync(
    path.join(__dirname, "..", "tools", "run-test-infra-change-set.sh"),
    "utf8"
  );

  assert.match(
    workflow,
    /THN_AUTH_ADMIN_ORIGIN_VERIFY_SECRET: \$\{\{ secrets\.THN_AUTH_ADMIN_ORIGIN_VERIFY_SECRET \}\}/
  );
  assert.match(workflow, /if \[ "\$FRONTEND_TEST_THN_ADMIN_ORIGIN_ENABLED" = "true" \]; then/);
  assert.match(runner, /ThnAdminAuthAdminOriginVerifySecret=\$THN_AUTH_ADMIN_ORIGIN_VERIFY_SECRET/);
  assert.doesNotMatch(workflow, /THN_AUTH_ADMIN_ORIGIN_VERIFY_SECRET:\s*[A-Za-z0-9_-]{43}/);
  assert.doesNotMatch(runner, /THN_AUTH_ADMIN_ORIGIN_VERIFY_SECRET=[A-Za-z0-9_-]{43}/);
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

test("THN admin front door stays disabled until every explicit TEST input is present", () => {
  assert.equal(buildThnAdminTestFrontDoor({}, testEnvironment.account), null);

  const frontDoor = buildFixtureThnAdminFrontDoor();
  assert.equal(frontDoor.id, "thehairnarrative-admin-test");
  assert.equal(frontDoor.securityProfile, "thn-admin-test");
  assert.equal(frontDoor.domainName, THN_ADMIN_HOST);
  assert.equal(frontDoor.certificateDomainName, THN_ADMIN_HOST);
  assert.deepEqual(frontDoor.alternateDomainNames, []);
  assert.equal(frontDoor.route53RecordsEnabled, true);
  assert.deepEqual(frontDoor.aliasRecordGroups, [
    {
      hostedZoneName: "thehairnarrative.com",
      hostedZoneId: "ZTHNFIXTURE",
      domainNames: [THN_ADMIN_HOST],
    },
  ]);
  assert.deepEqual(frontDoor.staticAssetPaths, adminReleaseFixture().manifest.staticAssetPaths);
  assert.equal(frontDoor.staticOriginPrefix, adminReleaseFixture().prefix);
  assert.equal(frontDoor.route53RecordManagement, "create-only");
});

test("THN admin inputs fail closed on missing or non-exact certificate coordinates", () => {
  assert.throws(
    () => buildThnAdminTestFrontDoor({ FRONTEND_TEST_THN_ADMIN_ORIGIN_ENABLED: "true" }, testEnvironment.account),
    /FRONTEND_TEST_THN_ADMIN_CERTIFICATE_ARN/
  );
  assert.throws(
    () => buildThnAdminTestFrontDoor({
      ...THN_ADMIN_INPUTS,
      FRONTEND_TEST_THN_ADMIN_CERTIFICATE_ARN:
        "arn:aws:acm:us-west-2:123456789012:certificate/thn-admin-test",
    }, testEnvironment.account),
    /us-east-1/
  );
  assert.throws(
    () => buildThnAdminTestFrontDoor({
      ...THN_ADMIN_INPUTS,
      FRONTEND_TEST_THN_ADMIN_CERTIFICATE_ARN:
        "arn:aws:acm:us-east-1:999999999999:certificate/thn-admin-test",
    }, testEnvironment.account),
    /AWS account 123456789012/
  );
  assert.throws(
    () => buildFixtureThnAdminFrontDoor(THN_ADMIN_INPUTS, {
      ...THN_TRUSTED_TEST_API_FRONT_DOORS,
      authAdmin: {
        ...THN_TRUSTED_TEST_API_FRONT_DOORS.authAdmin,
        domainName: "https://auth-v2.example.com",
      },
    }),
    /bare HTTPS origin domain name/
  );
  assert.throws(
    () => buildFixtureThnAdminFrontDoor(THN_ADMIN_INPUTS, {
      ...THN_TRUSTED_TEST_API_FRONT_DOORS,
      authAdmin: {
        ...THN_TRUSTED_TEST_API_FRONT_DOORS.authAdmin,
        domainName: "attacker.example",
      },
    }),
    /exact regional API Gateway origin/
  );
  assert.throws(
    () => buildFixtureThnAdminFrontDoor(THN_ADMIN_INPUTS, {
      ...THN_TRUSTED_TEST_API_FRONT_DOORS,
      contentHub: {
        ...THN_TRUSTED_TEST_API_FRONT_DOORS.contentHub,
        originPath: "//test",
      },
    }),
    /absolute path/
  );
});

test("production configuration contains no THN admin origin, alias, certificate, or v2 route", () => {
  const production = environments.find((environment) => environment.name === "production");
  assert.ok(production);
  assert.doesNotMatch(JSON.stringify(production), /admin-test\.thehairnarrative\.com/);
  assert.doesNotMatch(JSON.stringify(production), /auth-v2|content-hub-v2/);
});

test("THN admin front doors cannot be synthesized outside TEST", () => {
  const environment = releasedEnvironmentWithThnAdmin("production");
  const app = new cdk.App();
  assert.throws(
    () => new FrontendStack(app, "RejectedProductionThnAdminStack", {
      env: { account: environment.account, region: environment.region },
      environment,
    }),
    /THN admin front door is TEST-only/
  );
});

test("THN exact admin host and security profile cannot be separated", () => {
  assertThnAdminFrontDoorRejected(
    (frontDoor) => ({ ...frontDoor, securityProfile: undefined }),
    /exact THN admin host and thn-admin-test security profile must be configured together/
  );
  assertThnAdminFrontDoorRejected(
    (frontDoor) => ({ ...frontDoor, domainName: "other.example.com" }),
    /exact THN admin host and thn-admin-test security profile must be configured together/
  );

  const environment = releasedEnvironmentWithThnAdmin();
  environment.frontendHosting.frontDoors[0] = {
    ...environment.frontendHosting.frontDoors[0],
    alternateDomainNames: [THN_ADMIN_HOST],
  };
  const app = new cdk.App();
  assert.throws(
    () => new FrontendStack(app, "RejectedThnAdminAlternateAlias", {
      env: { account: environment.account, region: environment.region },
      environment,
    }),
    /exact THN admin host and thn-admin-test security profile must be configured together/
  );

  const uppercaseEnvironment = releasedEnvironmentWithThnAdmin();
  uppercaseEnvironment.frontendHosting.frontDoors[0] = {
    ...uppercaseEnvironment.frontendHosting.frontDoors[0],
    alternateDomainNames: [THN_ADMIN_HOST.toUpperCase()],
  };
  const uppercaseApp = new cdk.App();
  assert.throws(
    () => new FrontendStack(uppercaseApp, "RejectedUppercaseThnAdminAlias", {
      env: { account: uppercaseEnvironment.account, region: uppercaseEnvironment.region },
      environment: uppercaseEnvironment,
    }),
    /exact THN admin host and thn-admin-test security profile must be configured together/
  );

  const wildcardEnvironment = releasedEnvironmentWithThnAdmin();
  wildcardEnvironment.frontendHosting.frontDoors[0] = {
    ...wildcardEnvironment.frontendHosting.frontDoors[0],
    alternateDomainNames: ["*.thehairnarrative.com"],
  };
  const wildcardApp = new cdk.App();
  assert.throws(
    () => new FrontendStack(wildcardApp, "RejectedWildcardThnAdminAlias", {
      env: { account: wildcardEnvironment.account, region: wildcardEnvironment.region },
      environment: wildcardEnvironment,
    }),
    /exact THN admin host and thn-admin-test security profile must be configured together/
  );
});

test("THN admin certificate, DNS, HSTS, route, and asset contracts fail closed", () => {
  assertThnAdminFrontDoorRejected(
    (frontDoor) => ({ ...frontDoor, certificateVerification: undefined }),
    /exact certificate CN\/SAN preflight verification/
  );
  assertThnAdminFrontDoorRejected(
    (frontDoor) => ({ ...frontDoor, route53RecordManagement: "upsert" }),
    /create-only Route 53 record management/
  );
  assertThnAdminFrontDoorRejected(
    (frontDoor) => ({
      ...frontDoor,
      hsts: { ...frontDoor.hsts, includeSubdomains: true },
    }),
    /bounded host-only HSTS/
  );
  assertThnAdminFrontDoorRejected(
    (frontDoor) => ({
      ...frontDoor,
      pageRoutes: [
        ...frontDoor.pageRoutes,
        { path: "/admin/journal/:slug/edit", methods: ["GET"] },
      ],
    }),
    /duplicate path shape/
  );
  assertThnAdminFrontDoorRejected(
    (frontDoor) => ({ ...frontDoor, staticAssetPaths: ["/assets/admin.js"] }),
    /exact manifest-hashed files/
  );
  assertThnAdminFrontDoorRejected(
    (frontDoor) => ({
      ...frontDoor,
      staticAssetPaths: ["/assets/../admin.12345678.js"],
    }),
    /exact absolute path/
  );
});

test("THN admin page and backend route inventories are sealed exactly", () => {
  assertThnAdminFrontDoorRejected(
    (frontDoor) => ({
      ...frontDoor,
      pageRoutes: frontDoor.pageRoutes.filter(
        (route) => route.path !== "/admin/journal/mfa"
      ),
    }),
    /exact approved page route inventory/
  );
  assertThnAdminFrontDoorRejected(
    (frontDoor) => ({
      ...frontDoor,
      backendRoutes: frontDoor.backendRoutes.map((backendRoute) => (
        backendRoute.id === "thn-admin-auth-v2"
          ? {
            ...backendRoute,
            routes: [
              ...backendRoute.routes,
              { path: "/auth-v2/session/debug", methods: ["GET"] },
            ],
          }
          : backendRoute
      )),
    }),
    /exact approved routes for thn-admin-auth-v2/
  );
  assertThnAdminFrontDoorRejected(
    (frontDoor) => ({
      ...frontDoor,
      backendRoutes: frontDoor.backendRoutes.map((backendRoute) => (
        backendRoute.id === "thn-admin-content-hub-v2"
          ? { ...backendRoute, id: "thn-admin-content-hub-debug" }
          : backendRoute
      )),
    }),
    /exact approved backend owner inventory/
  );
  assertThnAdminFrontDoorRejected(
    (frontDoor) => ({
      ...frontDoor,
      backendRoutes: frontDoor.backendRoutes.map((backendRoute) => (
        backendRoute.id === "thn-admin-auth-v2"
          ? {
            ...backendRoute,
            domainName: "attacker123.execute-api.us-east-1.amazonaws.com",
            originPath: "/evil",
          }
          : backendRoute
      )),
    }),
    /must use the verified TEST coordinates owned by auth-admin/
  );

  const coordinatedDriftEnvironment = releasedEnvironmentWithThnAdmin();
  coordinatedDriftEnvironment.frontendHosting.backendRoutes =
    coordinatedDriftEnvironment.frontendHosting.backendRoutes.map((backendRoute) => (
      backendRoute.id === "auth-admin"
        ? {
          ...backendRoute,
          domainName: "attacker123.execute-api.us-east-1.amazonaws.com",
          originPath: "/evil",
        }
        : backendRoute
    ));
  coordinatedDriftEnvironment.frontendHosting.frontDoors =
    coordinatedDriftEnvironment.frontendHosting.frontDoors.map((frontDoor) => (
      frontDoor.domainName === THN_ADMIN_HOST
        ? {
          ...frontDoor,
          backendRoutes: frontDoor.backendRoutes.map((backendRoute) => (
            backendRoute.id === "thn-admin-auth-v2"
              ? {
                ...backendRoute,
                domainName: "attacker123.execute-api.us-east-1.amazonaws.com",
                originPath: "/evil",
              }
              : backendRoute
          )),
        }
        : frontDoor
    ));
  const coordinatedDriftApp = new cdk.App();
  assert.throws(
    () => new FrontendStack(coordinatedDriftApp, "RejectedCoordinatedOwnerDrift", {
      env: {
        account: coordinatedDriftEnvironment.account,
        region: coordinatedDriftEnvironment.region,
      },
      environment: coordinatedDriftEnvironment,
    }),
    /does not match the immutable TEST owner seal/
  );
});

test("THN admin refuses a route inventory that exceeds the CloudFront Function quota", () => {
  const release = adminReleaseFixture(Array.from({ length: 64 }, (_, index) =>
    `/browser/${"long-directory-".repeat(10)}${index}/admin.12345678.js`));
  const selected = selectThnAdminRelease(release.inputs);
  assertThnAdminFrontDoorRejected(
    (frontDoor) => ({
      ...frontDoor,
      staticAssetPaths: selected.manifest.staticAssetPaths,
      staticOriginPrefix: selected.originPrefix,
      staticRelease: selected,
    }),
    /exceeds the CloudFront Function 10 KiB code limit/
  );
});

test("THN admin distribution does not inherit public static or v1 backend behaviors", () => {
  const template = synthesizeThnAdminFixture();
  const admin = distributionForAlias(template, THN_ADMIN_HOST);
  assert.ok(admin);
  const patterns = (admin.Properties.DistributionConfig.CacheBehaviors || []).map(
    (behavior) => behavior.PathPattern
  );
  for (const forbidden of [
    "assets/*",
    "*.js",
    "*.css",
    "*.svg",
    "auth/session",
    "auth/session/*",
    "auth/admin",
    "auth/admin/*",
    "auth/runtime-config",
    "features/content-hub/*",
    "api-proxy/*",
  ]) {
    assert.equal(patterns.includes(forbidden), false, `admin distribution inherited ${forbidden}`);
  }

  const publicDistribution = distributionForAlias(template, "dev.zoolandingpage.com.mx");
  assert.ok(publicDistribution);
  const publicPatterns = publicDistribution.Properties.DistributionConfig.CacheBehaviors.map(
    (behavior) => behavior.PathPattern
  );
  assert.ok(publicPatterns.includes("assets/*"));
  assert.ok(publicPatterns.includes("auth/session/*"));
  assert.equal(publicPatterns.includes("auth-v2/runtime-config"), false);
  assert.equal(publicPatterns.includes("features/content-hub-v2/read"), false);
});

test("THN admin distribution routes only the exact v2 backend inventory", () => {
  const template = synthesizeThnAdminFixture();
  const admin = distributionForAlias(template, THN_ADMIN_HOST);
  assert.ok(admin);
  const patterns = admin.Properties.DistributionConfig.CacheBehaviors.map(
    (behavior) => behavior.PathPattern
  ).sort();
  assert.deepEqual(patterns, [
    "browser/main-2ZPUOXRY.js",
    "auth-v2/runtime-config",
    "auth-v2/session/challenge/respond",
    "auth-v2/session/logout",
    "auth-v2/session/me",
    "auth-v2/session/mfa/setup",
    "auth-v2/session/mfa/verify",
    "auth-v2/session/signin",
    "features/content-hub-v2/action",
    "features/content-hub-v2/read",
  ].sort());
});

test("THN exact assets use selected release prefix without duplicated browser or public changes", () => {
  const template = synthesizeThnAdminFixture();
  const admin = distributionForAlias(template, THN_ADMIN_HOST);
  const config = admin.Properties.DistributionConfig;
  const asset = config.CacheBehaviors.find(item => item.PathPattern === "browser/main-2ZPUOXRY.js");
  assert.ok(asset);
  const origin = config.Origins.find(item => item.Id === asset.TargetOriginId);
  assert.equal(origin.OriginPath, `/${adminReleaseFixture().prefix}`);
  assert.equal(`${origin.OriginPath}/${asset.PathPattern}`, `/${adminReleaseFixture().prefix}/browser/main-2ZPUOXRY.js`);
  const publicConfig = distributionForAlias(template, "dev.zoolandingpage.com.mx").Properties.DistributionConfig;
  const publicAsset = publicConfig.CacheBehaviors.find(item => item.PathPattern === "assets/*");
  assert.equal(publicConfig.Origins.find(item => item.Id === publicAsset.TargetOriginId).OriginPath,
    "/frontend/angular-ssr/test/releases/test-release/browser");
  const { handler } = viewerHandlerForDistribution(template, admin);
  assert.equal(handler(cloudFrontRequest({ uri: "/browser/main-2ZPUOXRY.js" })).statusCode, undefined);
  assert.equal(handler(cloudFrontRequest({ uri: "/browser/other-2ZPUOXRY.js" })).statusCode, 404);
  assert.equal(handler(cloudFrontRequest({ uri: "/browser/main-2ZPUOXRY.js", method: "POST" })).statusCode, 405);
  assert.equal(handler(cloudFrontRequest({ uri: "/browser/main-2ZPUOXRY.js", querystring: { arbitrary: { value: "yes" } } })).statusCode, 404);
});

test("THN manifest selection cannot be overridden by synth-time routes or origin coordinates", () => {
  assertThnAdminFrontDoorRejected(frontDoor => ({ ...frontDoor, staticRelease: undefined }), /thn_admin_release_invalid/);
  assertThnAdminFrontDoorRejected(frontDoor => ({ ...frontDoor, staticOriginPrefix: "frontend/angular-ssr/test/releases/other" }), /THN admin static selection mismatch/);
  assertThnAdminFrontDoorRejected(frontDoor => ({ ...frontDoor, staticAssetPaths: ["/browser/other-2ZPUOXRY.js"] }), /THN admin static selection mismatch/);
});

test("THN admin Auth Admin origin alone receives a NoEcho proof parameter", () => {
  const template = synthesizeThnAdminFixture();
  const json = template.toJSON();
  const parameter = json.Parameters.ThnAdminAuthAdminOriginVerifySecret;
  assert.ok(parameter);
  assert.equal(parameter.Type, "String");
  assert.equal(parameter.NoEcho, true);
  assert.equal(parameter.MinLength, 43);
  assert.equal(parameter.MaxLength, 43);
  assert.equal(parameter.AllowedPattern, "^[A-Za-z0-9_-]{43}$");
  assert.equal(Object.hasOwn(parameter, "Default"), false);

  const distributions = Object.values(
    template.findResources("AWS::CloudFront::Distribution")
  );
  const admin = distributionForAlias(template, THN_ADMIN_HOST);
  const authBehavior = admin.Properties.DistributionConfig.CacheBehaviors.find(
    (behavior) => behavior.PathPattern === "auth-v2/session/signin"
  );
  assert.ok(authBehavior);

  const originsWithProof = distributions.flatMap((distribution) =>
    (distribution.Properties.DistributionConfig.Origins || []).filter((origin) =>
      (origin.OriginCustomHeaders || []).some(
        (header) => header.HeaderName === "x-zlp-origin-verify"
      )
    )
  );
  assert.equal(originsWithProof.length, 1);
  assert.equal(originsWithProof[0].Id, authBehavior.TargetOriginId);
  assert.deepEqual(originsWithProof[0].OriginCustomHeaders, [
    {
      HeaderName: "x-zlp-origin-verify",
      HeaderValue: { Ref: "ThnAdminAuthAdminOriginVerifySecret" },
    },
  ]);
});

test("THN admin viewer fence is attached to the default and every ordered behavior", () => {
  const template = synthesizeThnAdminFixture();
  const admin = distributionForAlias(template, THN_ADMIN_HOST);
  assert.ok(admin);
  const config = admin.Properties.DistributionConfig;
  const behaviors = [config.DefaultCacheBehavior, ...(config.CacheBehaviors || [])];
  const functionArns = behaviors.map((behavior) => {
    assert.deepEqual(
      behavior.AllowedMethods,
      ["GET", "HEAD", "OPTIONS", "PUT", "PATCH", "POST", "DELETE"],
      "the viewer fence must receive every method so it can return the contract 405"
    );
    const association = behavior.FunctionAssociations.find((item) => item.EventType === "viewer-request");
    assert.ok(association);
    return JSON.stringify(association.FunctionARN);
  });
  assert.equal(new Set(functionArns).size, 1);
});

test("THN admin viewer fence rejects foreign hosts and draft-selected context with 404", () => {
  const template = synthesizeThnAdminFixture();
  const admin = distributionForAlias(template, THN_ADMIN_HOST);
  const { handler } = viewerHandlerForDistribution(template, admin);
  for (const host of [
    "test.zoolandingpage.com.mx",
    "another-draft.example.com",
    "d111111abcdef8.cloudfront.net",
    "",
  ]) {
    assert.equal(handler(cloudFrontRequest({ host })).statusCode, 404, host || "empty host");
  }
  for (const queryKey of ["draftDomain", "DRAFTDOMAIN", "draft%44omain"]) {
    const result = handler(cloudFrontRequest({
      querystring: { [queryKey]: { value: "thehairnarrative.com" } },
    }));
    assert.equal(result.statusCode, 404);
  }
});

test("THN admin viewer fence allows only reviewed page shapes", () => {
  const template = synthesizeThnAdminFixture();
  const admin = distributionForAlias(template, THN_ADMIN_HOST);
  const { handler } = viewerHandlerForDistribution(template, admin);
  for (const uri of [
    "/admin/journal/access",
    "/admin/journal/mfa",
    "/admin/journal",
    "/admin/journal/new",
    "/admin/journal/article-123/edit",
    "/admin/journal/article-123/preview",
  ]) {
    const result = handler(cloudFrontRequest({ uri, querystring: { lang: { value: "es" } } }));
    assert.equal(result.statusCode, undefined, uri);
    assert.equal(result.headers["x-forwarded-host"].value, THN_ADMIN_HOST);
  }
});

test("THN admin viewer fence allows only the exact safe language query on pages", () => {
  const template = synthesizeThnAdminFixture();
  const admin = distributionForAlias(template, THN_ADMIN_HOST);
  const { handler } = viewerHandlerForDistribution(template, admin);
  for (const value of ["en", "es"]) {
    const result = handler(cloudFrontRequest({
      querystring: { lang: { value } },
    }));
    assert.equal(result.statusCode, undefined, value);
  }
  for (const querystring of [
    { returnUrl: { value: "/admin/journal" } },
    { Lang: { value: "en" } },
    { lang: { value: "fr" } },
    { lang: { value: "en", multiValue: [{ value: "en" }] } },
    { lang: { value: "en" }, other: { value: "value" } },
  ]) {
    assert.equal(handler(cloudFrontRequest({ querystring })).statusCode, 404);
  }
  assert.equal(handler(cloudFrontRequest({
    method: "POST",
    uri: "/features/content-hub-v2/read",
    querystring: { lang: { value: "en" } },
  })).statusCode, 404);
});

test("THN admin viewer fence bounds article identifiers and removes viewer proxy headers", () => {
  const template = synthesizeThnAdminFixture();
  const admin = distributionForAlias(template, THN_ADMIN_HOST);
  const { handler } = viewerHandlerForDistribution(template, admin);
  const overlongArticleId = "a".repeat(129);
  assert.equal(handler(cloudFrontRequest({
    uri: `/admin/journal/${overlongArticleId}/edit`,
  })).statusCode, 404);

  const event = cloudFrontRequest();
  event.request.headers.forwarded = { value: "for=attacker.example" };
  event.request.headers["x-forwarded-for"] = { value: "203.0.113.10" };
  event.request.headers["x-forwarded-port"] = { value: "81" };
  event.request.headers["x-forwarded-host"] = { value: "attacker.example" };
  event.request.headers["x-zlp-viewer-ip"] = { value: "192.0.2.99" };
  event.viewer.ip = "2001:db8::42";
  const result = handler(event);
  assert.equal(result.statusCode, undefined);
  assert.equal(result.headers.forwarded, undefined);
  assert.equal(result.headers["x-forwarded-for"], undefined);
  assert.equal(result.headers["x-forwarded-port"], undefined);
  assert.equal(result.headers["x-forwarded-host"].value, THN_ADMIN_HOST);
  assert.equal(result.headers["x-zlp-viewer-ip"].value, "2001:db8::42");
});

test("THN admin viewer fence fails closed when CloudFront supplies no viewer IP", () => {
  const template = synthesizeThnAdminFixture();
  const admin = distributionForAlias(template, THN_ADMIN_HOST);
  const { handler } = viewerHandlerForDistribution(template, admin);
  const event = cloudFrontRequest();
  delete event.viewer;

  assert.equal(handler(event).statusCode, 404);
});

test("THN admin viewer fence returns 404 for public, v1, malformed, and non-manifest paths", () => {
  const template = synthesizeThnAdminFixture();
  const admin = distributionForAlias(template, THN_ADMIN_HOST);
  const { handler } = viewerHandlerForDistribution(template, admin);
  for (const uri of [
    "/",
    "/the-journal",
    "/the-narrative",
    "/admin",
    "/admin/journal/",
    "/admin/journal/../edit",
    "/admin/journal/article-123/edit/extra",
    "/auth/session",
    "/auth-v2/session/unknown",
    "/features/content-hub/read",
    "/features/content-hub-v2/public-media/article/en/revision/asset/variant",
    "/main.not-in-manifest.js",
    "/assets/not-in-manifest.svg",
  ]) {
    assert.equal(handler(cloudFrontRequest({ uri })).statusCode, 404, uri);
  }
});

test("THN admin viewer fence enforces the exact API method matrix", () => {
  const template = synthesizeThnAdminFixture();
  const admin = distributionForAlias(template, THN_ADMIN_HOST);
  const { handler } = viewerHandlerForDistribution(template, admin);
  const allowed = [
    ["GET", "/auth-v2/runtime-config"],
    ["POST", "/auth-v2/runtime-config"],
    ["POST", "/auth-v2/session/signin"],
    ["POST", "/auth-v2/session/challenge/respond"],
    ["POST", "/auth-v2/session/mfa/setup"],
    ["POST", "/auth-v2/session/mfa/verify"],
    ["GET", "/auth-v2/session/me"],
    ["POST", "/auth-v2/session/logout"],
    ["POST", "/features/content-hub-v2/read"],
    ["POST", "/features/content-hub-v2/action"],
  ];
  for (const [method, uri] of allowed) {
    const result = handler(cloudFrontRequest({ method, uri }));
    assert.equal(result.statusCode, undefined, `${method} ${uri}`);
  }
  for (const [method, uri] of [
    ["POST", "/admin/journal"],
    ["HEAD", "/admin/journal"],
    ["GET", "/auth-v2/session/signin"],
    ["DELETE", "/auth-v2/session/me"],
    ["GET", "/features/content-hub-v2/action"],
    ["OPTIONS", "/auth-v2/runtime-config"],
    ["get", "/admin/journal"],
  ]) {
    const result = handler(cloudFrontRequest({ method, uri }));
    assert.equal(result.statusCode, 405, `${method} ${uri}`);
    assert.ok(result.headers.allow.value);
  }
});

test("THN admin viewer fence remains below the CloudFront Function size quota", () => {
  const template = synthesizeThnAdminFixture();
  const admin = distributionForAlias(template, THN_ADMIN_HOST);
  const { functionCode } = viewerHandlerForDistribution(template, admin);
  assert.ok(Buffer.byteLength(functionCode, "utf8") < 10 * 1024);
});

test("THN admin distribution has exact TLS, HTTPS, and host-only HSTS controls", () => {
  const template = synthesizeThnAdminFixture();
  const admin = distributionForAlias(template, THN_ADMIN_HOST);
  assert.ok(admin);
  const config = admin.Properties.DistributionConfig;
  assert.deepEqual(config.Aliases, [THN_ADMIN_HOST]);
  assert.equal(config.ViewerCertificate.MinimumProtocolVersion, "TLSv1.2_2021");
  assert.equal(config.ViewerCertificate.SslSupportMethod, "sni-only");
  for (const behavior of [config.DefaultCacheBehavior, ...(config.CacheBehaviors || [])]) {
    assert.equal(behavior.ViewerProtocolPolicy, "redirect-to-https");
  }

  const policyLogicalId = config.DefaultCacheBehavior.ResponseHeadersPolicyId.Ref;
  const policy = template.toJSON().Resources[policyLogicalId];
  assert.ok(policy);
  const hsts = policy.Properties.ResponseHeadersPolicyConfig.SecurityHeadersConfig.StrictTransportSecurity;
  assert.equal(hsts.AccessControlMaxAgeSec, 2_592_000);
  assert.equal(hsts.IncludeSubdomains, false);
  assert.equal(hsts.Preload, false);
  assert.equal(hsts.Override, true);
});

test("THN admin Route53 operation creates only its exact TEST A and AAAA aliases", () => {
  const template = synthesizeThnAdminFixture();
  const resources = template.findResources("Custom::ZoolandingFrontendAliasRecords");
  const thnResource = Object.values(resources).find((resource) =>
    JSON.stringify(resource.Properties).includes(THN_ADMIN_HOST)
  );
  assert.ok(thnResource);
  const payload = JSON.stringify(thnResource.Properties);
  assert.match(payload, /ZTHNFIXTURE/);
  assert.match(payload, /admin-test\.thehairnarrative\.com\./);
  assert.ok(payload.includes('\\"Type\\":\\"A\\"'));
  assert.ok(payload.includes('\\"Type\\":\\"AAAA\\"'));
  assert.ok(payload.includes('\\"Action\\":\\"CREATE\\"'));
  assert.equal(payload.includes('\\"Action\\":\\"UPSERT\\"'), false);
  assert.equal(Object.hasOwn(thnResource.Properties, "Update"), false);
  assert.doesNotMatch(payload, /test\.zoolandingpage\.com\.mx/);
  assert.doesNotMatch(payload, /production/i);
});
