"use strict";

const cdk = require("aws-cdk-lib");
const acm = require("aws-cdk-lib/aws-certificatemanager");
const cloudfront = require("aws-cdk-lib/aws-cloudfront");
const origins = require("aws-cdk-lib/aws-cloudfront-origins");
const cr = require("aws-cdk-lib/custom-resources");
const iam = require("aws-cdk-lib/aws-iam");
const lambda = require("aws-cdk-lib/aws-lambda");
const logs = require("aws-cdk-lib/aws-logs");
const s3 = require("aws-cdk-lib/aws-s3");
const ssm = require("aws-cdk-lib/aws-ssm");
const targets = require("aws-cdk-lib/aws-route53-targets");
const {
  applyZoolandingpageTags,
  buildParameterName,
  buildResourceName,
  pascalId,
  removalPolicyForEnvironment,
} = require("../project-helpers");

class FrontendStack extends cdk.Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    const { environment } = props;
    applyZoolandingpageTags(this, environment);

    const frontend = environment.frontendHosting;
    if (!frontend) {
      throw new Error(`Missing frontendHosting configuration for ${environment.name}.`);
    }

    const artifactBucket = new s3.Bucket(this, "FrontendArtifactBucket", {
      bucketName: frontend.artifactBucketName,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      removalPolicy: removalPolicyForEnvironment(environment),
    });

    addStringParameter(this, environment, "FrontendArchitectureParameter", "frontend/hosting-architecture", frontend.architecture);
    addStringParameter(this, environment, "FrontendApiBaseUrlParameter", "frontend/api-base-url", frontend.apiBaseUrl);
    addStringParameter(
      this,
      environment,
      "FrontendConfigApiServerFallbackUrlParameter",
      "frontend/config-api-server-fallback-url",
      frontend.configApiServerFallbackUrl || "not-configured"
    );
    addStringParameter(this, environment, "FrontendArtifactBucketParameter", "frontend/artifact-bucket-name", artifactBucket.bucketName);
    addStringParameter(this, environment, "FrontendStaticBucketParameter", "frontend/static-bucket-name", frontend.staticBucketName);
    addStringParameter(this, environment, "FrontendStaticOriginDomainParameter", "frontend/static-origin-domain-name", frontend.staticOriginDomainName);
    addStringParameter(this, environment, "FrontendArtifactBasePrefixParameter", "frontend/artifact-base-prefix", frontend.artifactBasePrefix);
    addStringParameter(this, environment, "FrontendManifestKeyPatternParameter", "frontend/manifest-key-pattern", frontend.manifestKeyPattern);
    addStringParameter(this, environment, "FrontendStaticPrefixPatternParameter", "frontend/static-prefix-pattern", frontend.staticPrefixPattern);
    addStringParameter(this, environment, "FrontendServerBundlePrefixPatternParameter", "frontend/server-bundle-prefix-pattern", frontend.serverBundlePrefixPattern);
    addStringParameter(this, environment, "FrontendSsrRuntimeParameter", "frontend/ssr-runtime", frontend.ssrRuntime);
    addStringParameter(this, environment, "FrontendReleaseIdParameter", "frontend/release-id", frontend.releaseId || "not-configured");
    addStringParameter(
      this,
      environment,
      "FrontendRoute53RecordsEnabledParameter",
      "frontend/route53-records-enabled",
      String(route53RecordsEnabledForFrontend(frontend))
    );
    addStringParameter(
      this,
      environment,
      "FrontendCustomDomainNamesEnabledParameter",
      "frontend/custom-domain-names-enabled",
      String(customDomainNamesEnabledForFrontend(frontend))
    );

    const publisherRole = createFrontendPublisherRole(this, environment, frontend, artifactBucket);
    addStringParameter(this, environment, "FrontendPublisherRoleArnParameter", "frontend/publisher-role-arn", publisherRole.roleArn);
    createBackendSamDeployRoles(this, environment);
    const runtimeReadDeployment = createRuntimeReadDeploymentIdentities(this, environment, frontend);
    if (runtimeReadDeployment) {
      new cdk.CfnOutput(this, "RuntimeReadGithubDeployRoleArn", {
        value: runtimeReadDeployment.githubRole.roleArn,
      });
      new cdk.CfnOutput(this, "RuntimeReadCloudFormationExecutionRoleArn", {
        value: runtimeReadDeployment.cloudFormationRole.roleArn,
      });
      new cdk.CfnOutput(this, "RuntimeReadExecutionBoundaryArn", {
        value: runtimeReadDeployment.executionBoundary.managedPolicyArn,
      });
    }
    const aliasOpsRole = createFrontendAliasOpsRole(this, environment);
    if (aliasOpsRole) {
      addStringParameter(this, environment, "FrontendAliasOpsRoleArnParameter", "frontend/alias-ops-role-arn", aliasOpsRole.roleArn);
      new cdk.CfnOutput(this, "FrontendAliasOpsRoleArn", {
        value: aliasOpsRole.roleArn,
      });
    }

    new cdk.CfnOutput(this, "FrontendArtifactBucketName", {
      value: artifactBucket.bucketName,
    });
    new cdk.CfnOutput(this, "FrontendStaticBucketName", {
      value: frontend.staticBucketName,
    });
    new cdk.CfnOutput(this, "FrontendArtifactBasePrefix", {
      value: frontend.artifactBasePrefix,
    });
    new cdk.CfnOutput(this, "FrontendPublisherRoleArn", {
      value: publisherRole.roleArn,
    });

    if (!frontend.releaseId) {
      new cdk.CfnOutput(this, "FrontendPlan", {
        value: "Foundation only: publish an Angular SSR artifact, then set FRONTEND_RELEASE_ID to create Lambda SSR and CloudFront.",
      });
      return;
    }

    const serverBundleKey = requiredValue(frontend.serverBundleKey, "serverBundleKey", environment);
    const staticPrefix = requiredValue(frontend.staticPrefix, "staticPrefix", environment);
    const ssrFunctionName = buildResourceName(environment, "frontend", "ssr");

    const ssrLogGroup = shouldManageSsrLogGroup(environment)
      ? new logs.LogGroup(this, "FrontendSsrLogGroup", {
          logGroupName: `/aws/lambda/${ssrFunctionName}`,
          retention: logs.RetentionDays.ONE_MONTH,
          removalPolicy: removalPolicyForEnvironment(environment),
        })
      : undefined;

    const ssrFunction = new lambda.Function(this, "FrontendSsrFunction", {
      functionName: ssrFunctionName,
      description: `Angular SSR frontend for Zoolandingpage ${environment.name}.`,
      runtime: runtimeFromConfig(frontend.ssrRuntime),
      architecture: lambda.Architecture.ARM_64,
      handler: "index.handler",
      code: lambda.Code.fromBucket(artifactBucket, serverBundleKey),
      memorySize: frontend.ssrMemorySizeMb || 512,
      timeout: cdk.Duration.seconds(frontend.ssrTimeoutSeconds || 15),
      environment: {
        CONFIG_API_URL: frontend.apiBaseUrl,
        CONFIG_API_SERVER_FALLBACK_URL: frontend.configApiServerFallbackUrl || "",
        NG_ALLOWED_HOSTS: allowedHostsForEnvironment(environment, frontend).join(","),
        NG_TRUST_PROXY_HEADERS: "x-forwarded-host,x-forwarded-proto,x-forwarded-for,x-forwarded-port",
        NODE_ENV: "production",
        ZLP_DEPLOY_ENV: environment.name,
        ZLP_RELEASE_ID: frontend.releaseId,
        ZLP_RUNTIME_ENV: frontend.runtimeEnvironment || "production",
      },
    });
    if (ssrLogGroup) {
      ssrFunction.node.addDependency(ssrLogGroup);
    }

    const functionUrl = ssrFunction.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.AWS_IAM,
    });
    const ssrOrigin = origins.FunctionUrlOrigin.withOriginAccessControl(functionUrl, {
      readTimeout: cdk.Duration.seconds(frontend.ssrTimeoutSeconds || 15),
      keepaliveTimeout: cdk.Duration.seconds(5),
    });
    const staticOrigin = new origins.HttpOrigin(requiredValue(frontend.staticOriginDomainName, "staticOriginDomainName", environment), {
      originPath: `/${staticPrefix}`,
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
    });
    const responseHeadersPolicy = createFrontendResponseHeadersPolicy(this, environment);

    const frontDoors = frontDoorsForFrontend(frontend);
    for (const frontDoor of frontDoors) {
      createFrontendDistribution(this, {
        environment,
        frontend,
        frontDoor,
        ssrFunction,
        ssrOrigin,
        staticOrigin,
        responseHeadersPolicy,
      });
    }

    addStringParameter(this, environment, "FrontendServerBundleKeyParameter", "frontend/server-bundle-key", serverBundleKey);
    new cdk.CfnOutput(this, "FrontendReleaseId", {
      value: frontend.releaseId,
    });
    new cdk.CfnOutput(this, "FrontendSsrFunctionName", {
      value: ssrFunction.functionName,
    });
  }
}

function createFrontendDistribution(scope, props) {
  const {
    environment,
    frontend,
    frontDoor,
    ssrFunction,
    ssrOrigin,
    staticOrigin,
    responseHeadersPolicy,
  } = props;
  const idSuffix = pascalId(frontDoor.id || frontDoor.domainName || "default");
  const domainNames = frontendAttachedDomainNames(frontDoor);

  if (customDomainNamesEnabledForFrontDoor(frontDoor) && frontDoor.domainName && !frontDoor.certificateArn) {
    throw new Error(`Missing certificateArn for ${environment.name} frontend domain ${frontDoor.domainName}.`);
  }

  const certificate = domainNames.length > 0 && frontDoor.certificateArn
    ? acm.Certificate.fromCertificateArn(scope, `FrontendCertificate${idSuffix}`, frontDoor.certificateArn)
    : undefined;
  const viewerHostHeaderFunction = createViewerHostHeaderFunction(scope, environment, frontDoor, idSuffix);

  const distribution = new cloudfront.Distribution(scope, `FrontendDistribution${idSuffix}`, {
    comment: `Zoolandingpage Angular SSR frontend (${environment.name}/${frontDoor.id || "default"})`,
    domainNames: domainNames.length > 0 ? domainNames : undefined,
    certificate,
    priceClass: priceClassFromConfig(frontend.cachePriceClass),
    defaultBehavior: {
      origin: ssrOrigin,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
      cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      responseHeadersPolicy,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      functionAssociations: [
        {
          eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          function: viewerHostHeaderFunction,
        },
      ],
      compress: true,
    },
  });

  const distributionArn = cdk.Stack.of(scope).formatArn({
    service: "cloudfront",
    region: "",
    resource: "distribution",
    resourceName: distribution.distributionId,
  });
  ssrFunction.addPermission(`AllowCloudFrontInvokeFunctionUrl${idSuffix}`, {
    principal: new iam.ServicePrincipal("cloudfront.amazonaws.com"),
    action: "lambda:InvokeFunctionUrl",
    sourceArn: distributionArn,
    functionUrlAuthType: lambda.FunctionUrlAuthType.AWS_IAM,
  });
  ssrFunction.addPermission(`AllowCloudFrontInvokeFunction${idSuffix}`, {
    principal: new iam.ServicePrincipal("cloudfront.amazonaws.com"),
    action: "lambda:InvokeFunction",
    sourceArn: distributionArn,
  });

  for (const pathPattern of staticPathPatterns()) {
    distribution.addBehavior(pathPattern, staticOrigin, {
      allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
      cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
      cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      responseHeadersPolicy,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      compress: true,
    });
  }

  for (const backendRoute of frontend.backendRoutes || []) {
    const backendOrigin = new origins.HttpOrigin(requiredValue(backendRoute.domainName, "backendRoutes.domainName", environment), {
      originPath: normalizeOriginPath(backendRoute.originPath),
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
      readTimeout: cdk.Duration.seconds(backendRoute.readTimeoutSeconds || 30),
      keepaliveTimeout: cdk.Duration.seconds(5),
    });
    for (const pathPattern of backendRoute.pathPatterns || []) {
      distribution.addBehavior(pathPattern, backendOrigin, {
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD_OPTIONS,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        responseHeadersPolicy,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        compress: true,
      });
    }
  }

  createFrontendAliasRecords(scope, environment, frontend, frontDoor, distribution);

  addStringParameter(
    scope,
    environment,
    `FrontendDistributionDomainParameter${idSuffix}`,
    `frontend/distributions/${frontDoor.id || "default"}/domain-name`,
    distribution.distributionDomainName
  );
  new cdk.CfnOutput(scope, `FrontendDistributionDomainName${idSuffix}`, {
    value: distribution.distributionDomainName,
  });
}

function createViewerHostHeaderFunction(scope, environment, frontDoor, idSuffix) {
  const auditHost = frontDoor.auditHostHint ? JSON.stringify(frontDoor.auditHostHint) : "";
  const forwardedHostExpression = auditHost || "(request.headers.host && request.headers.host.value) || \"\"";
  return new cloudfront.Function(scope, `FrontendViewerHostHeaderFunction${idSuffix}`, {
    comment: `Preserve viewer host for Zoolandingpage SSR (${environment.name}/${frontDoor.id || "default"}).`,
    code: cloudfront.FunctionCode.fromInline(`function handler(event) {
  var request = event.request;
  var forwardedHost = ${forwardedHostExpression};
  if (forwardedHost) {
    request.headers["x-forwarded-host"] = { value: forwardedHost };
  }
  return request;
}`),
  });
}

function createFrontendResponseHeadersPolicy(scope, environment) {
  return new cloudfront.ResponseHeadersPolicy(scope, "FrontendResponseHeadersPolicy", {
    responseHeadersPolicyName: buildResourceName(environment, "frontend", "headers"),
    comment: `Security headers for Zoolandingpage Angular SSR frontend (${environment.name}).`,
    removeHeaders: ["X-Powered-By"],
    securityHeadersBehavior: {
      contentTypeOptions: {
        override: true,
      },
      frameOptions: {
        frameOption: cloudfront.HeadersFrameOption.SAMEORIGIN,
        override: true,
      },
      referrerPolicy: {
        referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
        override: true,
      },
      strictTransportSecurity: {
        accessControlMaxAge: cdk.Duration.days(365),
        includeSubdomains: true,
        preload: false,
        override: true,
      },
      xssProtection: {
        protection: true,
        modeBlock: true,
        override: true,
      },
    },
    customHeadersBehavior: {
      customHeaders: [
        {
          header: "Permissions-Policy",
          value: "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
          override: true,
        },
      ],
    },
  });
}

function addStringParameter(scope, environment, id, parameterPath, value) {
  return new ssm.StringParameter(scope, id, {
    parameterName: buildParameterName(environment, parameterPath),
    stringValue: value,
  });
}

function createFrontendPublisherRole(scope, environment, frontend, artifactBucket) {
  const repository = requiredValue(frontend.publisherRepository, "publisherRepository", environment);
  const githubEnvironment = frontend.githubEnvironment || environment.name;
  const oidcProviderArn = `arn:aws:iam::${environment.account}:oidc-provider/token.actions.githubusercontent.com`;
  const role = new iam.Role(scope, "FrontendPublisherRole", {
    roleName: buildResourceName(environment, "frontend", "publisher"),
    description: `GitHub OIDC publisher for ${repository} ${githubEnvironment} Angular SSR artifacts.`,
    assumedBy: new iam.FederatedPrincipal(
      oidcProviderArn,
      {
        StringEquals: {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": `repo:${repository}:environment:${githubEnvironment}`,
        },
      },
      "sts:AssumeRoleWithWebIdentity"
    ),
  });

  const bucketNames = [...new Set([artifactBucket.bucketName, frontend.staticBucketName].filter(Boolean))];
  for (const bucketName of bucketNames) {
    const bucketArn = `arn:aws:s3:::${bucketName}`;
    const artifactPrefix = `${frontend.artifactBasePrefix}/`;
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:ListBucket", "s3:ListBucketMultipartUploads"],
        resources: [bucketArn],
        conditions: {
          StringLike: {
            "s3:prefix": [`${artifactPrefix}*`],
          },
        },
      })
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:AbortMultipartUpload", "s3:GetObject", "s3:ListMultipartUploadParts", "s3:PutObject"],
        resources: [`${bucketArn}/${artifactPrefix}*`],
      })
    );
  }

  return role;
}

function createBackendSamDeployRoles(scope, environment) {
  if (!["test", "production"].includes(environment.name)) {
    return [];
  }

  const deployEnvironment = environment.name;
  const resourceSuffix = deployEnvironment === "test" ? "-test" : "";
  const oidcProviderArn = `arn:aws:iam::${environment.account}:oidc-provider/token.actions.githubusercontent.com`;
  const services = [
    {
      id: deployEnvironment === "test" ? "ConfigAuthoringTestDeployRole" : "ConfigAuthoringProductionDeployRole",
      roleName: `zoolanding-config-authoring-${deployEnvironment}-deploy`,
      repository: "zoolanding-config-authoring",
      stackName: `zoolanding-config-authoring${resourceSuffix}`,
      iamRolePrefix: "zoolanding-config-",
      buckets: [`zoolanding-config-payloads${resourceSuffix}`],
      tables: [`zoolanding-config-registry${resourceSuffix}`],
      versionedObjectReadBuckets: deployEnvironment === "production"
        ? ["zoolanding-config-payloads"]
        : [],
      readStackNames: deployEnvironment === "production"
        ? ["zoolanding-config-authoring-test"]
        : [],
    },
    {
      id: deployEnvironment === "test" ? "DataDropperTestDeployRole" : "DataDropperProductionDeployRole",
      roleName: `zoolanding-data-dropper-${deployEnvironment}-deploy`,
      repository: "zoolanding-data-dropper-lambda",
      stackName: `zoolanding-data-dropper${resourceSuffix}`,
      iamRolePrefix: "zoolanding-data-",
      buckets: [`zoolanding-data-raw${resourceSuffix}`],
      tables: [],
    },
  ];

  return services.map((service) => {
    const role = new iam.Role(scope, service.id, {
      roleName: service.roleName,
      description: `GitHub OIDC SAM deploy role for ${service.repository} ${deployEnvironment}.`,
      assumedBy: new iam.FederatedPrincipal(
        oidcProviderArn,
        {
          StringEquals: {
            "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
            "token.actions.githubusercontent.com:sub": `repo:LynxPardelle/${service.repository}:environment:${deployEnvironment}`,
            "token.actions.githubusercontent.com:ref": deployEnvironment === "test" ? "refs/heads/test" : "refs/heads/main",
          },
        },
        "sts:AssumeRoleWithWebIdentity"
      ),
    });

    role.addToPolicy(new iam.PolicyStatement({
      actions: [
        "cloudformation:CreateChangeSet",
        "cloudformation:CreateStack",
        "cloudformation:ContinueUpdateRollback",
        "cloudformation:DeleteChangeSet",
        "cloudformation:DescribeChangeSet",
        "cloudformation:DescribeStackEvents",
        "cloudformation:DescribeStacks",
        "cloudformation:ExecuteChangeSet",
        "cloudformation:GetTemplateSummary",
        "cloudformation:UpdateStack",
      ],
      resources: [
        `arn:${cdk.Aws.PARTITION}:cloudformation:${environment.region}:${environment.account}:stack/${service.stackName}/*`,
        `arn:${cdk.Aws.PARTITION}:cloudformation:${environment.region}:${environment.account}:stack/aws-sam-cli-managed-default/*`,
        `arn:${cdk.Aws.PARTITION}:cloudformation:${environment.region}:aws:transform/Serverless-2016-10-31`,
      ],
    }));
    if (service.readStackNames?.length) {
      role.addToPolicy(new iam.PolicyStatement({
        actions: ["cloudformation:DescribeStacks"],
        resources: service.readStackNames.map((stackName) => (
          `arn:${cdk.Aws.PARTITION}:cloudformation:${environment.region}:${environment.account}:stack/${stackName}/*`
        )),
      }));
    }
    role.addToPolicy(new iam.PolicyStatement({
      actions: ["s3:CreateBucket", "s3:GetBucketLocation", "s3:GetObject", "s3:ListBucket", "s3:PutObject"],
      resources: [
        ...service.buckets.flatMap((bucket) => [`arn:${cdk.Aws.PARTITION}:s3:::${bucket}`, `arn:${cdk.Aws.PARTITION}:s3:::${bucket}/*`]),
        `arn:${cdk.Aws.PARTITION}:s3:::aws-sam-cli-managed-default-samclisourcebucket-*`,
        `arn:${cdk.Aws.PARTITION}:s3:::aws-sam-cli-managed-default-samclisourcebucket-*/*`,
      ],
    }));
    if (service.versionedObjectReadBuckets?.length) {
      role.addToPolicy(new iam.PolicyStatement({
        actions: ["s3:GetObjectVersion"],
        resources: service.versionedObjectReadBuckets.map((bucket) => (
          `arn:${cdk.Aws.PARTITION}:s3:::${bucket}/*`
        )),
      }));
    }
    role.addToPolicy(new iam.PolicyStatement({
      actions: [
        "lambda:AddPermission", "lambda:CreateFunction", "lambda:CreateFunctionUrlConfig", "lambda:DeleteFunction",
        "lambda:DeleteFunctionUrlConfig", "lambda:GetFunction", "lambda:GetFunctionConfiguration", "lambda:GetFunctionUrlConfig",
        "lambda:ListTags", "lambda:RemovePermission", "lambda:TagResource", "lambda:UpdateFunctionUrlConfig",
        "lambda:UntagResource", "lambda:UpdateFunctionCode", "lambda:UpdateFunctionConfiguration",
      ],
      resources: [`arn:${cdk.Aws.PARTITION}:lambda:${environment.region}:${environment.account}:function:${service.iamRolePrefix}*`],
    }));
    role.addToPolicy(new iam.PolicyStatement({
      actions: ["apigateway:DELETE", "apigateway:GET", "apigateway:PATCH", "apigateway:POST", "apigateway:PUT"],
      resources: [`arn:${cdk.Aws.PARTITION}:apigateway:${environment.region}::/*`],
    }));
    role.addToPolicy(new iam.PolicyStatement({
      actions: ["logs:CreateLogGroup", "logs:DeleteLogGroup", "logs:DescribeLogGroups", "logs:ListTagsForResource", "logs:PutRetentionPolicy", "logs:TagResource"],
      resources: [`arn:${cdk.Aws.PARTITION}:logs:${environment.region}:${environment.account}:log-group:/aws/lambda/${service.stackName}-*`],
    }));
    role.addToPolicy(new iam.PolicyStatement({
      actions: ["iam:CreateRole", "iam:DeleteRole", "iam:DeleteRolePolicy", "iam:GetRole", "iam:GetRolePolicy", "iam:PassRole", "iam:PutRolePolicy", "iam:TagRole"],
      resources: [`arn:${cdk.Aws.PARTITION}:iam::${environment.account}:role/${service.iamRolePrefix}*`],
    }));
    if (service.tables.length) {
      role.addToPolicy(new iam.PolicyStatement({
        actions: ["dynamodb:CreateTable", "dynamodb:DescribeTable", "dynamodb:ListTagsOfResource", "dynamodb:TagResource", "dynamodb:UpdateTable"],
        resources: service.tables.map((table) => `arn:${cdk.Aws.PARTITION}:dynamodb:${environment.region}:${environment.account}:table/${table}`),
      }));
    }
    return role;
  });
}

function createRuntimeReadDeploymentIdentities(scope, environment, frontend) {
  if (!["test", "production"].includes(environment.name)) {
    return undefined;
  }

  const target = environment.runtimeReadDeployment;
  if (!target) {
    throw new Error(`Missing runtimeReadDeployment configuration for ${environment.name}.`);
  }
  for (const fieldName of [
    "stackName",
    "apiId",
    "functionName",
    "executionRoleName",
    "samArtifactBucketName",
    "samArtifactPrefix",
    "configTableName",
    "configPayloadsBucketName",
  ]) {
    if (!target[fieldName]) {
      throw new Error(`Missing runtimeReadDeployment.${fieldName} for ${environment.name}.`);
    }
  }
  if (!target.contentHubMetadataTableNames?.length || !target.contentHubPackageBucketNames?.length) {
    throw new Error(`Runtime Read content-hub boundary resources are required for ${environment.name}.`);
  }

  const githubEnvironment = environment.name === "test" ? "test" : "production";
  const branch = environment.name === "test" ? "test" : "main";
  const apiId = runtimeReadApiId(frontend.configApiServerFallbackUrl, environment);
  if (apiId !== target.apiId) {
    throw new Error(`Runtime Read API ID mismatch for ${environment.name}.`);
  }
  const runtimeFunctionArn =
    `arn:${cdk.Aws.PARTITION}:lambda:${environment.region}:${environment.account}:function:${target.functionName}`;
  const runtimeExecutionRoleArn =
    `arn:${cdk.Aws.PARTITION}:iam::${environment.account}:role/${target.executionRoleName}`;
  const runtimeApiArn =
    `arn:${cdk.Aws.PARTITION}:apigateway:${environment.region}::/restapis/${target.apiId}`;
  const samBucketArn = `arn:${cdk.Aws.PARTITION}:s3:::${target.samArtifactBucketName}`;
  const stackArn =
    `arn:${cdk.Aws.PARTITION}:cloudformation:${environment.region}:${environment.account}:stack/${target.stackName}/*`;
  const oidcProviderArn = `arn:aws:iam::${environment.account}:oidc-provider/token.actions.githubusercontent.com`;

  const executionBoundary = new iam.ManagedPolicy(scope, "RuntimeReadExecutionBoundary", {
    managedPolicyName: `zoolanding-config-runtime-read-${githubEnvironment}-execution-boundary`,
    description: `Maximum runtime data-plane permissions for Runtime Read ${githubEnvironment}.`,
    document: new iam.PolicyDocument({
      statements: [
        new iam.PolicyStatement({
          actions: ["dynamodb:GetItem"],
          resources: [target.configTableName, ...target.contentHubMetadataTableNames].map((tableName) => (
            `arn:${cdk.Aws.PARTITION}:dynamodb:${environment.region}:${environment.account}:table/${tableName}`
          )),
        }),
        new iam.PolicyStatement({
          actions: ["dynamodb:Query"],
          resources: target.contentHubMetadataTableNames.map((tableName) => (
            `arn:${cdk.Aws.PARTITION}:dynamodb:${environment.region}:${environment.account}:table/${tableName}`
          )),
        }),
        new iam.PolicyStatement({
          sid: "DenyServerOnlyDraftDescriptors",
          effect: iam.Effect.DENY,
          actions: ["s3:GetObject"],
          resources: [
            `arn:${cdk.Aws.PARTITION}:s3:::${target.configPayloadsBucketName}/*/server/*`,
          ],
        }),
        new iam.PolicyStatement({
          actions: ["s3:GetObject"],
          resources: [
            `arn:${cdk.Aws.PARTITION}:s3:::${target.configPayloadsBucketName}/*`,
            ...target.contentHubPackageBucketNames.map((bucketName) => (
              `arn:${cdk.Aws.PARTITION}:s3:::${bucketName}/content-hubs/*`
            )),
          ],
        }),
        new iam.PolicyStatement({
          actions: ["s3:ListBucket"],
          resources: [`arn:${cdk.Aws.PARTITION}:s3:::${target.configPayloadsBucketName}`],
        }),
        new iam.PolicyStatement({
          actions: ["logs:CreateLogStream", "logs:PutLogEvents"],
          resources: [
            `arn:${cdk.Aws.PARTITION}:logs:${environment.region}:${environment.account}:log-group:/aws/lambda/${target.functionName}:*`,
          ],
        }),
        new iam.PolicyStatement({
          actions: [
            "xray:GetSamplingRules",
            "xray:GetSamplingStatisticSummaries",
            "xray:GetSamplingTargets",
            "xray:PutTelemetryRecords",
            "xray:PutTraceSegments",
          ],
          resources: ["*"],
        }),
      ],
    }),
  });
  executionBoundary.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);

  const cloudFormationRole = new iam.Role(scope, "RuntimeReadCloudFormationExecutionRole", {
    roleName: `zoolanding-config-runtime-read-${githubEnvironment}-cfn-exec`,
    description: `Bounded CloudFormation execution role for Runtime Read ${githubEnvironment}.`,
    assumedBy: new iam.ServicePrincipal("cloudformation.amazonaws.com"),
  });
  cloudFormationRole.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);
  cloudFormationRole.addToPolicy(new iam.PolicyStatement({
    actions: [
      "lambda:AddPermission",
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
    ],
    resources: [runtimeFunctionArn],
  }));
  cloudFormationRole.addToPolicy(new iam.PolicyStatement({
    actions: ["apigateway:DELETE", "apigateway:GET", "apigateway:PATCH", "apigateway:POST", "apigateway:PUT"],
    resources: [runtimeApiArn, `${runtimeApiArn}/*`],
  }));
  cloudFormationRole.addToPolicy(new iam.PolicyStatement({
    actions: ["iam:GetRole", "iam:GetRolePolicy", "iam:ListAttachedRolePolicies", "iam:ListRolePolicies"],
    resources: [runtimeExecutionRoleArn],
  }));
  cloudFormationRole.addToPolicy(new iam.PolicyStatement({
    actions: ["iam:PutRolePermissionsBoundary"],
    resources: [runtimeExecutionRoleArn],
    conditions: {
      ArnEquals: {
        "iam:PermissionsBoundary": executionBoundary.managedPolicyArn,
      },
    },
  }));
  // TEMPORARY: CloudFormation needs this only to roll back the first boundary attachment.
  // Remove after Runtime Read test and production have both completed the migration.
  cloudFormationRole.addToPolicy(new iam.PolicyStatement({
    sid: "TemporaryDeleteBoundaryRemoveAfterBothMigrations",
    actions: ["iam:DeleteRolePermissionsBoundary"],
    resources: [runtimeExecutionRoleArn],
  }));
  cloudFormationRole.addToPolicy(new iam.PolicyStatement({
    actions: ["iam:PassRole"],
    resources: [runtimeExecutionRoleArn],
    conditions: {
      StringEquals: {
        "iam:PassedToService": "lambda.amazonaws.com",
      },
    },
  }));
  cloudFormationRole.addToPolicy(new iam.PolicyStatement({
    actions: ["s3:GetObject"],
    resources: [`${samBucketArn}/${target.samArtifactPrefix}/*`],
  }));

  const githubRole = new iam.Role(scope, "RuntimeReadGithubDeployRole", {
    roleName: `zoolanding-config-runtime-read-${githubEnvironment}-github-deploy`,
    description: `Branch-bound GitHub OIDC deploy role for Runtime Read ${githubEnvironment}.`,
    assumedBy: new iam.FederatedPrincipal(
      oidcProviderArn,
      {
        StringEquals: {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub":
            `repo:LynxPardelle/zoolanding-config-runtime-read:environment:${githubEnvironment}`,
          "token.actions.githubusercontent.com:ref": `refs/heads/${branch}`,
        },
      },
      "sts:AssumeRoleWithWebIdentity"
    ),
  });
  githubRole.addToPolicy(new iam.PolicyStatement({
    actions: ["cloudformation:CreateChangeSet"],
    resources: [stackArn],
    conditions: {
      ArnEquals: {
        "cloudformation:RoleArn": cloudFormationRole.roleArn,
      },
    },
  }));
  githubRole.addToPolicy(new iam.PolicyStatement({
    actions: [
      "cloudformation:DeleteChangeSet",
      "cloudformation:DescribeChangeSet",
      "cloudformation:DescribeStackEvents",
      "cloudformation:DescribeStacks",
      "cloudformation:ExecuteChangeSet",
    ],
    resources: [stackArn],
  }));
  githubRole.addToPolicy(new iam.PolicyStatement({
    actions: ["cloudformation:DescribeStacks"],
    resources: [
      `arn:${cdk.Aws.PARTITION}:cloudformation:${environment.region}:${environment.account}:stack/aws-sam-cli-managed-default/*`,
    ],
  }));
  githubRole.addToPolicy(new iam.PolicyStatement({
    actions: ["cloudformation:GetTemplateSummary"],
    resources: [stackArn],
  }));
  githubRole.addToPolicy(new iam.PolicyStatement({
    actions: ["s3:GetBucketLocation"],
    resources: [samBucketArn],
  }));
  githubRole.addToPolicy(new iam.PolicyStatement({
    actions: ["s3:ListBucket"],
    resources: [samBucketArn],
    conditions: {
      StringLike: {
        "s3:prefix": [target.samArtifactPrefix, `${target.samArtifactPrefix}/*`],
      },
    },
  }));
  githubRole.addToPolicy(new iam.PolicyStatement({
    actions: ["s3:GetObject", "s3:PutObject"],
    resources: [`${samBucketArn}/${target.samArtifactPrefix}/*`],
  }));
  githubRole.addToPolicy(new iam.PolicyStatement({
    actions: ["iam:PassRole"],
    resources: [cloudFormationRole.roleArn],
    conditions: {
      StringEquals: {
        "iam:PassedToService": "cloudformation.amazonaws.com",
      },
    },
  }));

  return { githubRole, cloudFormationRole, executionBoundary };
}

function runtimeReadApiId(configApiServerFallbackUrl, environment) {
  let parsed;
  try {
    parsed = new URL(requiredValue(configApiServerFallbackUrl, "configApiServerFallbackUrl", environment));
  } catch (error) {
    throw new Error(`Invalid configApiServerFallbackUrl for ${environment.name}: ${error.message}`);
  }
  const suffix = `.execute-api.${environment.region}.amazonaws.com`;
  if (parsed.protocol !== "https:" || !parsed.hostname.endsWith(suffix)) {
    throw new Error(`configApiServerFallbackUrl for ${environment.name} must use the regional API Gateway HTTPS endpoint.`);
  }
  const apiId = parsed.hostname.slice(0, -suffix.length);
  if (!/^[a-z0-9]+$/.test(apiId)) {
    throw new Error(`configApiServerFallbackUrl for ${environment.name} does not contain a valid API Gateway ID.`);
  }
  return apiId;
}

function createFrontendAliasOpsRole(scope, environment) {
  if (environment.name !== "production") {
    return undefined;
  }

  const oidcProviderArn = `arn:aws:iam::${environment.account}:oidc-provider/token.actions.githubusercontent.com`;
  const role = new iam.Role(scope, "FrontendAliasOpsRole", {
    roleName: buildResourceName(environment, "frontend", "alias-ops"),
    description: "GitHub OIDC role for guarded Zoolandingpage production alias cleanup and preflight.",
    assumedBy: new iam.FederatedPrincipal(
      oidcProviderArn,
      {
        StringEquals: {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": "repo:LynxPardelle/zoolandingpage-aws-infra:environment:production",
        },
      },
      "sts:AssumeRoleWithWebIdentity"
    ),
  });

  role.addToPolicy(
    new iam.PolicyStatement({
      actions: ["route53:ListResourceRecordSets", "route53:ChangeResourceRecordSets"],
      resources: [`arn:${cdk.Aws.PARTITION}:route53:::hostedzone/${environment.hostedZoneId}`],
    })
  );
  role.addToPolicy(
    new iam.PolicyStatement({
      actions: ["cloudfront:ListDistributions", "cloudfront:ListConflictingAliases"],
      resources: ["*"],
    })
  );
  role.addToPolicy(
    new iam.PolicyStatement({
      actions: ["cloudfront:GetDistribution", "cloudfront:GetDistributionConfig", "cloudfront:UpdateDistribution"],
      resources: [`arn:${cdk.Aws.PARTITION}:cloudfront::${environment.account}:distribution/*`],
    })
  );

  return role;
}

function createFrontendAliasRecords(scope, environment, frontend, frontDoor, distribution) {
  const recordsEnabled = frontDoor.route53RecordsEnabled ?? frontend.route53RecordsEnabled;
  if (!recordsEnabled || !frontDoor.domainName) {
    return;
  }
  if (!customDomainNamesEnabledForFrontDoor(frontDoor)) {
    throw new Error(`Route53 records require custom domain names to be enabled for ${environment.name}/${frontDoor.id || frontDoor.domainName}.`);
  }

  const domainNames = frontendAliasDomainNames(frontDoor);
  const groups = frontDoor.aliasRecordGroups || [
    {
      hostedZoneId: environment.hostedZoneId,
      hostedZoneName: environment.hostedZoneName,
      domainNames,
    },
  ];

  for (const group of groups) {
    createFrontendAliasUpsert(scope, environment, frontDoor, group, distribution);
  }
}

function createFrontendAliasUpsert(scope, environment, frontDoor, group, distribution) {
  const domainNames = [...new Set((group.domainNames || []).filter(Boolean))];
  if (domainNames.length === 0) {
    return;
  }
  const idSuffix = `${pascalId(frontDoor.id || frontDoor.domainName)}${pascalId(group.hostedZoneName || group.hostedZoneId)}`;
  const changeBatch = {
    Comment: `Upsert Zoolandingpage frontend aliases for ${environment.name}/${frontDoor.id || "default"}.`,
    Changes: domainNames.flatMap((domainName) =>
      ["A", "AAAA"].map((recordType) => ({
        Action: "UPSERT",
        ResourceRecordSet: {
          Name: normalizeRecordName(domainName),
          Type: recordType,
          AliasTarget: {
            DNSName: distribution.distributionDomainName,
            HostedZoneId: targets.CloudFrontTarget.getHostedZoneId(distribution),
            EvaluateTargetHealth: false,
          },
        },
      }))
    ),
  };
  const sdkCall = {
    service: "Route53",
    action: "changeResourceRecordSets",
    parameters: {
      HostedZoneId: requiredValue(group.hostedZoneId, "aliasRecordGroups.hostedZoneId", environment),
      ChangeBatch: changeBatch,
    },
    physicalResourceId: cr.PhysicalResourceId.of(
      `${buildResourceName(environment, "frontend", "aliases")}-${idSuffix}`
    ),
  };

  new cr.AwsCustomResource(scope, `FrontendAliasUpsert${idSuffix}`, {
    resourceType: "Custom::ZoolandingFrontendAliasRecords",
    onCreate: sdkCall,
    onUpdate: sdkCall,
    installLatestAwsSdk: false,
    removalPolicy: removalPolicyForEnvironment(environment),
    policy: cr.AwsCustomResourcePolicy.fromStatements([
      new iam.PolicyStatement({
        actions: ["route53:ChangeResourceRecordSets"],
        resources: [`arn:${cdk.Aws.PARTITION}:route53:::hostedzone/${group.hostedZoneId}`],
      }),
    ]),
  });
}

function requiredValue(value, fieldName, environment) {
  if (!value) {
    throw new Error(`Missing frontendHosting.${fieldName} for ${environment.name}.`);
  }
  return value;
}

function runtimeFromConfig(value) {
  switch (value) {
    case "nodejs22.x":
    default:
      return lambda.Runtime.NODEJS_22_X;
  }
}

function shouldManageSsrLogGroup(environment) {
  return environment.removalPolicy !== "retain";
}

function priceClassFromConfig(value) {
  switch (value) {
    case "PRICE_CLASS_ALL":
      return cloudfront.PriceClass.PRICE_CLASS_ALL;
    case "PRICE_CLASS_200":
      return cloudfront.PriceClass.PRICE_CLASS_200;
    case "PRICE_CLASS_100":
    default:
      return cloudfront.PriceClass.PRICE_CLASS_100;
  }
}

function frontendAliasDomainNames(frontDoor) {
  return [...new Set([frontDoor.domainName, ...(frontDoor.alternateDomainNames || [])].filter(Boolean))];
}

function frontendAttachedDomainNames(frontDoor) {
  return customDomainNamesEnabledForFrontDoor(frontDoor) ? frontendAliasDomainNames(frontDoor) : [];
}

function customDomainNamesEnabledForFrontDoor(frontDoor) {
  return frontDoor.customDomainNamesEnabled !== false;
}

function customDomainNamesEnabledForFrontend(frontend) {
  return frontDoorsForFrontend(frontend).some(
    (frontDoor) => customDomainNamesEnabledForFrontDoor(frontDoor) && frontendAliasDomainNames(frontDoor).length > 0
  );
}

function route53RecordsEnabledForFrontend(frontend) {
  return frontDoorsForFrontend(frontend).some(
    (frontDoor) => (frontDoor.route53RecordsEnabled ?? frontend.route53RecordsEnabled) === true
  );
}

function frontDoorsForFrontend(frontend) {
  return frontend.frontDoors && frontend.frontDoors.length > 0 ? frontend.frontDoors : [frontend];
}

function allowedHostsForEnvironment(environment, frontend) {
  const frontDoors = frontDoorsForFrontend(frontend);
  return [
    ...frontDoors.flatMap(frontendAliasDomainNames),
    ...frontDoors.map((frontDoor) => frontDoor.auditHostHint),
    environment.hostedZoneName,
    `*.${environment.hostedZoneName}`,
    "*.zoolandingpage.com.mx",
    "*.zoolandingpage.com",
    "*.zoositioweb.com.mx",
    "*.zoositioweb.com",
    "*.sulandingpage.com.mx",
    "*.sulandingpage.com",
    "*.lynxpardelle.com",
    "*.cloudfront.net",
    `*.lambda-url.${environment.region}.on.aws`,
  ].filter(Boolean);
}

function normalizeRecordName(domainName) {
  return domainName.endsWith(".") ? domainName : `${domainName}.`;
}

function normalizeOriginPath(value) {
  const path = String(value || "").trim();
  if (!path) {
    return "";
  }
  return path.startsWith("/") ? path : `/${path}`;
}

function staticPathPatterns() {
  return [
    "assets/*",
    "manifest.webmanifest",
    "site.webmanifest",
    "*.js",
    "*.mjs",
    "*.css",
    "*.ico",
    "*.png",
    "*.jpg",
    "*.jpeg",
    "*.webp",
    "*.avif",
    "*.gif",
    "*.svg",
    "*.woff",
    "*.woff2",
    "*.ttf",
    "*.eot",
  ];
}

module.exports = {
  FrontendStack,
  staticPathPatterns,
};
