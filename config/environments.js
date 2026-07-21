"use strict";

const expectedAccount = "765932874577";
const defaultRegion = "us-east-1";

const certificates = {
  zoolandingpageMx:
    "arn:aws:acm:us-east-1:765932874577:certificate/0412c449-7cbd-4d99-a565-25f26a1b6c17",
  zoositeAndSulanding:
    "arn:aws:acm:us-east-1:765932874577:certificate/17f757f0-19bf-4e6d-b294-16f16092d8e6",
  lynxPardelleWildcard:
    "arn:aws:acm:us-east-1:765932874577:certificate/4b008cec-97a6-447e-bf2f-9165e435b363",
  erosBarajas:
    "arn:aws:acm:us-east-1:765932874577:certificate/4b190eff-7dde-435f-933b-da411d30ab50",
  grupoAstraLegal:
    "arn:aws:acm:us-east-1:765932874577:certificate/882ab0a9-c900-482d-ac9b-2f3baca96f40",
};

const hostedZones = {
  lynxPardelle: {
    hostedZoneName: "lynxpardelle.com",
    hostedZoneId: "Z05088763QG63CC5SE7PN",
  },
  sulandingpageCom: {
    hostedZoneName: "sulandingpage.com",
    hostedZoneId: "Z02344011W5VD7OPMM7SH",
  },
  sulandingpageComMx: {
    hostedZoneName: "sulandingpage.com.mx",
    hostedZoneId: "Z02346862HM1PQ6VRIBM2",
  },
  zoolandingpageCom: {
    hostedZoneName: "zoolandingpage.com",
    hostedZoneId: "Z08405073PYKRCIH5AK2R",
  },
  zoolandingpageComMx: {
    hostedZoneName: "zoolandingpage.com.mx",
    hostedZoneId: "Z0769334CXKBHR43ZZH6",
  },
  zoositiowebCom: {
    hostedZoneName: "zoositioweb.com",
    hostedZoneId: "Z0744909235BRQ55HV9XA",
  },
  zoositiowebComMx: {
    hostedZoneName: "zoositioweb.com.mx",
    hostedZoneId: "Z02338361297KZ2ZAC5WY",
  },
  erosBarajasCom: {
    hostedZoneName: "erosbarajas.com",
    hostedZoneId: "Z0572894Y6DV902JHMWS",
  },
  grupoAstraLegalCom: {
    hostedZoneName: "grupoastralegal.com",
    hostedZoneId: "Z05844193OR5CAJJCR2ZJ",
  },
};

const environmentDefaults = {
  account: process.env.CDK_DEFAULT_ACCOUNT || expectedAccount,
  region: process.env.CDK_DEFAULT_REGION || defaultRegion,
  hostedZoneName: hostedZones.zoolandingpageComMx.hostedZoneName,
  hostedZoneId: hostedZones.zoolandingpageComMx.hostedZoneId,
  staticBucketName: "zoolandingpage-public-files",
  staticDistributionId: "E2DVKBRSVK4JQG",
  staticOriginDomainName: "assets.zoolandingpage.com.mx",
  apiBaseUrl: "https://api.zoolandingpage.com.mx",
};

const runtimeFallbackUrls = {
  test: "https://jaay9p8gv5.execute-api.us-east-1.amazonaws.com/Prod",
  production: "https://y84vk0v44l.execute-api.us-east-1.amazonaws.com/Prod",
};

const runtimeReadDeploymentTargets = {
  test: {
    stackName: "zoolanding-config-runtime-read-test",
    apiId: "jaay9p8gv5",
    functionName: "zoolanding-config-runtime-ConfigRuntimeReadFunctio-h2B86UU86X18",
    executionRoleName: "zoolanding-config-runtime-ConfigRuntimeReadFunction-zKufNNnTJX6V",
    samArtifactBucketName: "aws-sam-cli-managed-default-samclisourcebucket-obthkeitxden",
    samArtifactPrefix: "zoolanding-config-runtime-read-test",
    configTableName: "zoolanding-config-registry-test",
    configPayloadsBucketName: "zoolanding-config-payloads-test",
    contentHubMetadataTableNames: [
      "zoolanding-content-hub-test-ContentHubMetadataTable-ZV7P652CS11F",
      "zoolanding-content-hub-prod-ContentHubMetadataTable-IQ1WMU24XMPB",
    ],
    contentHubPackageBucketNames: [
      "zoolanding-content-hub-te-contenthubpackagesbucket-gdgtasj0yb0o",
      "zoolanding-content-hub-pr-contenthubpackagesbucket-ujejm7mr5unu",
    ],
  },
  production: {
    stackName: "zoolanding-config-runtime-read",
    apiId: "y84vk0v44l",
    functionName: "zoolanding-config-runtime-ConfigRuntimeReadFunctio-tyt19jOfQNXg",
    executionRoleName: "zoolanding-config-runtime-ConfigRuntimeReadFunction-qscTUaEzOR3C",
    samArtifactBucketName: "aws-sam-cli-managed-default-samclisourcebucket-obthkeitxden",
    samArtifactPrefix: "zoolanding-config-runtime-read",
    configTableName: "zoolanding-config-registry",
    configPayloadsBucketName: "zoolanding-config-payloads",
    contentHubMetadataTableNames: [
      "zoolanding-content-hub-test-ContentHubMetadataTable-ZV7P652CS11F",
      "zoolanding-content-hub-prod-ContentHubMetadataTable-IQ1WMU24XMPB",
    ],
    contentHubPackageBucketNames: [
      "zoolanding-content-hub-te-contenthubpackagesbucket-gdgtasj0yb0o",
      "zoolanding-content-hub-pr-contenthubpackagesbucket-ujejm7mr5unu",
    ],
  },
};

const backendApiFrontDoors = {
  test: {
    authAdmin: { domainName: "tcuqltoeig.execute-api.us-east-1.amazonaws.com", originPath: "/test" },
    comboCatalog: { domainName: "5g5e63f3g4.execute-api.us-east-1.amazonaws.com", originPath: "/test" },
    contentHub: { domainName: "z1pub0v0c7.execute-api.us-east-1.amazonaws.com", originPath: "/test" },
    apiProxy: { domainName: "11zpm6wug2.execute-api.us-east-1.amazonaws.com", originPath: "/Prod" },
  },
  production: {
    authAdmin: { domainName: "88fcmasim1.execute-api.us-east-1.amazonaws.com", originPath: "/prod" },
    comboCatalog: { domainName: "mtwne6uneh.execute-api.us-east-1.amazonaws.com", originPath: "/prod" },
    contentHub: { domainName: "1qyli2au8f.execute-api.us-east-1.amazonaws.com", originPath: "/prod" },
    apiProxy: { domainName: "yxp97qlog2.execute-api.us-east-1.amazonaws.com", originPath: "/Prod" },
  },
};

const productionCustomDomainNamesEnabled = parseBooleanFlag(
  process.env.FRONTEND_PRODUCTION_CUSTOM_DOMAIN_NAMES_ENABLED ||
    process.env.FRONTEND_CUSTOM_DOMAIN_NAMES_ENABLED
);

const retiredZoolandingpageComMxAliases = [
  "crearpaginaweb.zoolandingpage.com.mx",
  "erosbarajas.zoolandingpage.com.mx",
  "quierounsitioweb.zoolandingpage.com.mx",
  "robertorodriguezrodriguez.zoolandingpage.com.mx",
  "sitiosweb.zoolandingpage.com.mx",
  "alecfest-voliii.zoolandingpage.com.mx",
  "despacholegalastralex.zoolandingpage.com.mx",
  "pamelabetancourt.zoolandingpage.com.mx",
  "pokeapi-demo.zoolandingpage.com.mx",
];

const zoolandingpageMxProductionAliases = [];

const unresolvedEc2Aliases = [
  {
    domainName: "crearpaginaweb.zoolandingpage.com.mx",
    reason: "Serverless browser QA on 2026-07-09 rendered an empty app shell; the production runtime API resolved it to zoolandingpage.com.mx/not-found instead of a published draft.",
  },
  {
    domainName: "erosbarajas.zoolandingpage.com.mx",
    reason: "Retired alias. EC2 returned HTTP 404 during 2026-07-09 audit; the production runtime API resolved it to zoolandingpage.com.mx/not-found.",
  },
  {
    domainName: "quierounsitioweb.zoolandingpage.com.mx",
    reason: "Serverless browser QA on 2026-07-09 rendered an empty app shell; the production runtime API resolved it to zoolandingpage.com.mx/not-found instead of a published draft.",
  },
  {
    domainName: "robertorodriguezrodriguez.zoolandingpage.com.mx",
    reason: "Serverless browser QA on 2026-07-09 rendered an empty app shell; the production runtime API resolved it to zoolandingpage.com.mx/not-found instead of a published draft.",
  },
  {
    domainName: "sitiosweb.zoolandingpage.com.mx",
    reason: "Serverless browser QA on 2026-07-09 rendered an empty app shell; the production runtime API resolved it to zoolandingpage.com.mx/not-found instead of a published draft.",
  },
  {
    domainName: "test.despacholegalastralex.zoolandingpage.com.mx",
    reason: "Two-level test alias is not covered by *.zoolandingpage.com.mx and no exact ACM certificate was found.",
  },
  {
    domainName: "alecfest-voliii.com",
    reason: "Draft registry lists the domain, but Route53/ACM ownership was not verified in this account.",
  },
  {
    domainName: "pamelabetancourt.com",
    reason: "Draft registry lists the domain, but Route53/ACM ownership was not verified in this account.",
  },
  {
    domainName: "robertorodriguezrodriguez.com.mx",
    reason: "Draft registry lists the domain, but Route53/ACM ownership was not verified in this account.",
  },
];

function buildFrontendHostingConfig(environmentName) {
  const artifactBasePrefix = `frontend/angular-ssr/${environmentName}`;
  const releaseEnvName = environmentName.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  const releaseId =
    process.env[`FRONTEND_${releaseEnvName}_RELEASE_ID`] ||
    process.env.FRONTEND_RELEASE_ID ||
    "";
  return {
    architecture: "cloudfront-s3-lambda-ssr",
    apiBaseUrl: environmentDefaults.apiBaseUrl,
    configApiServerFallbackUrl: runtimeFallbackUrls[environmentName] || runtimeFallbackUrls.production,
    artifactBucketName: `zoolandingpage-${environmentName}-frontend-artifacts-${environmentDefaults.account}`,
    staticBucketName: environmentDefaults.staticBucketName,
    staticOriginDomainName: environmentDefaults.staticOriginDomainName,
    artifactBasePrefix,
    publisherRepository: "LynxPardelle/zoolandingpage",
    githubEnvironment: environmentName,
    releaseId,
    manifestKeyPattern: `${artifactBasePrefix}/releases/{releaseId}/manifest.json`,
    staticPrefixPattern: `${artifactBasePrefix}/releases/{releaseId}/browser`,
    serverBundlePrefixPattern: `${artifactBasePrefix}/releases/{releaseId}/server`,
    manifestKey: releaseId ? `${artifactBasePrefix}/releases/${releaseId}/manifest.json` : "",
    staticPrefix: releaseId ? `${artifactBasePrefix}/releases/${releaseId}/browser` : "",
    serverBundleKey: releaseId ? `${artifactBasePrefix}/releases/${releaseId}/server/ssr-handler.zip` : "",
    ssrRuntime: "nodejs22.x",
    ssrMemorySizeMb: 512,
    ssrTimeoutSeconds: 15,
    cachePriceClass: "PRICE_CLASS_100",
    runtimeEnvironment: environmentName === "production" ? "production" : "test",
    route53RecordsEnabled: false,
    route53RecordManagement: "upsert",
    backendRoutes: buildBackendRoutes(environmentName),
  };
}

function buildBackendRoutes(environmentName) {
  const apiFrontDoors = backendApiFrontDoors[environmentName] || backendApiFrontDoors.production;
  return [
    {
      id: "auth-admin",
      domainName: apiFrontDoors.authAdmin.domainName,
      originPath: apiFrontDoors.authAdmin.originPath,
      pathPatterns: ["auth/session", "auth/session/*", "auth/admin", "auth/admin/*"],
    },
    {
      id: "combo-catalog",
      domainName: apiFrontDoors.comboCatalog.domainName,
      originPath: apiFrontDoors.comboCatalog.originPath,
      pathPatterns: ["features/combo-catalog/*"],
    },
    {
      id: "content-hub",
      domainName: apiFrontDoors.contentHub.domainName,
      originPath: apiFrontDoors.contentHub.originPath,
      pathPatterns: ["features/content-hub/*"],
    },
    {
      id: "api-proxy",
      domainName: apiFrontDoors.apiProxy.domainName,
      originPath: apiFrontDoors.apiProxy.originPath,
      pathPatterns: ["auth/runtime-config", "api-proxy/*"],
    },
  ];
}

const environments = [
  {
    ...environmentDefaults,
    name: "test",
    stageId: "ZoolandingTest",
    branch: "test",
    runtimeReadDeployment: runtimeReadDeploymentTargets.test,
    frontendHosting: {
      ...buildFrontendHostingConfig("test"),
      frontDoors: [
        {
          id: "test",
          domainName: "test.zoolandingpage.com.mx",
          certificateArn: certificates.zoolandingpageMx,
          route53RecordsEnabled: true,
          aliasRecordGroups: [
            {
              ...hostedZones.zoolandingpageComMx,
              domainNames: ["test.zoolandingpage.com.mx"],
            },
          ],
        },
      ],
    },
    removalPolicy: "destroy",
  },
  {
    ...environmentDefaults,
    name: "production",
    stageId: "ZoolandingProduction",
    branch: "main",
    runtimeReadDeployment: runtimeReadDeploymentTargets.production,
    frontendHosting: {
      ...buildFrontendHostingConfig("production"),
      route53RecordsEnabled: true,
      frontDoors: [
        {
          id: "zoolandingpage-mx",
          domainName: "zoolandingpage.com.mx",
          alternateDomainNames: zoolandingpageMxProductionAliases,
          customDomainNamesEnabled: productionCustomDomainNamesEnabled,
          auditHostHint: productionCustomDomainNamesEnabled ? undefined : "zoolandingpage.com.mx",
          certificateArn: certificates.zoolandingpageMx,
          aliasRecordGroups: [
            {
              ...hostedZones.zoolandingpageComMx,
              domainNames: ["zoolandingpage.com.mx", ...zoolandingpageMxProductionAliases],
            },
          ],
        },
        {
          id: "zoosite-sulanding",
          domainName: "zoositioweb.com.mx",
          alternateDomainNames: [
            "zoositioweb.com",
            "sulandingpage.com.mx",
            "sulandingpage.com",
            "zoolandingpage.com",
          ],
          customDomainNamesEnabled: productionCustomDomainNamesEnabled,
          auditHostHint: productionCustomDomainNamesEnabled ? undefined : "zoositioweb.com.mx",
          certificateArn: certificates.zoositeAndSulanding,
          aliasRecordGroups: [
            {
              ...hostedZones.zoositiowebComMx,
              domainNames: ["zoositioweb.com.mx"],
            },
            {
              ...hostedZones.zoositiowebCom,
              domainNames: ["zoositioweb.com"],
            },
            {
              ...hostedZones.sulandingpageComMx,
              domainNames: ["sulandingpage.com.mx"],
            },
            {
              ...hostedZones.sulandingpageCom,
              domainNames: ["sulandingpage.com"],
            },
            {
              ...hostedZones.zoolandingpageCom,
              domainNames: ["zoolandingpage.com"],
            },
          ],
        },
        {
          id: "lynx-draft-aliases",
          domainName: "music.lynxpardelle.com",
          alternateDomainNames: ["alecfest-voliii.lynxpardelle.com"],
          customDomainNamesEnabled: productionCustomDomainNamesEnabled,
          auditHostHint: productionCustomDomainNamesEnabled ? undefined : "music.lynxpardelle.com",
          certificateArn: certificates.lynxPardelleWildcard,
          aliasRecordGroups: [
            {
              ...hostedZones.lynxPardelle,
              domainNames: ["music.lynxpardelle.com", "alecfest-voliii.lynxpardelle.com"],
            },
          ],
        },
        {
          id: "erosbarajas",
          domainName: "erosbarajas.com",
          customDomainNamesEnabled: productionCustomDomainNamesEnabled,
          auditHostHint: productionCustomDomainNamesEnabled ? undefined : "erosbarajas.com",
          certificateArn: certificates.erosBarajas,
          aliasRecordGroups: [
            {
              ...hostedZones.erosBarajasCom,
              domainNames: ["erosbarajas.com"],
            },
          ],
        },
        {
          id: "grupoastralegal",
          domainName: "grupoastralegal.com",
          alternateDomainNames: ["www.grupoastralegal.com"],
          customDomainNamesEnabled: true,
          route53RecordsEnabled: true,
          certificateArn: certificates.grupoAstraLegal,
          aliasRecordGroups: [
            {
              ...hostedZones.grupoAstraLegalCom,
              domainNames: ["grupoastralegal.com", "www.grupoastralegal.com"],
            },
          ],
        },
      ],
    },
    removalPolicy: "retain",
  },
];

function parseBooleanFlag(value) {
  return String(value || "").toLowerCase() === "true";
}

module.exports = {
  environments,
  expectedAccount,
  defaultRegion,
  hostedZones,
  certificates,
  retiredZoolandingpageComMxAliases,
  unresolvedEc2Aliases,
};
