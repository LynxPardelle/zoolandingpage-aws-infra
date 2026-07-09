"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const cdk = require("aws-cdk-lib");
const { Match, Template } = require("aws-cdk-lib/assertions");

const { FrontendStack, staticPathPatterns } = require("../lib/stacks/frontend-stack");
const {
  buildParameterName,
  buildResourceName,
  removalPolicyForEnvironment,
} = require("../lib/project-helpers");

const testEnvironment = {
  account: "123456789012",
  region: "us-east-1",
  name: "dev",
  stageId: "ZoolandingDev",
  branch: "dev",
  hostedZoneName: "zoolandingpage.com.mx",
  hostedZoneId: "Z0769334CXKBHR43ZZH6",
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
});
