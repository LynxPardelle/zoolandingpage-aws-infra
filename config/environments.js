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
  dev: "https://p5sbs2w8zb.execute-api.us-east-1.amazonaws.com/Prod",
  test: "https://jaay9p8gv5.execute-api.us-east-1.amazonaws.com/Prod",
  production: "https://y84vk0v44l.execute-api.us-east-1.amazonaws.com/Prod",
};

const productionCustomDomainNamesEnabled = parseBooleanFlag(
  process.env.FRONTEND_PRODUCTION_CUSTOM_DOMAIN_NAMES_ENABLED ||
    process.env.FRONTEND_CUSTOM_DOMAIN_NAMES_ENABLED
);

const zoolandingpageMxProductionAliases = [
  "alecfest-voliii.zoolandingpage.com.mx",
  "crearpaginaweb.zoolandingpage.com.mx",
  "despacholegalastralex.zoolandingpage.com.mx",
  "erosbarajas.zoolandingpage.com.mx",
  "pamelabetancourt.zoolandingpage.com.mx",
  "pokeapi-demo.zoolandingpage.com.mx",
  "quierounsitioweb.zoolandingpage.com.mx",
  "robertorodriguezrodriguez.zoolandingpage.com.mx",
  "sitiosweb.zoolandingpage.com.mx",
];

const unresolvedEc2Aliases = [
  {
    domainName: "erosbarajas.com",
    reason: "No issued ACM certificate was found in us-east-1 on 2026-07-09.",
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
    domainName: "grupoastralegal.com",
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
  };
}

const environments = [
  {
    ...environmentDefaults,
    name: "dev",
    stageId: "ZoolandingDev",
    branch: "dev",
    frontendHosting: {
      ...buildFrontendHostingConfig("dev"),
      frontDoors: [
        {
          id: "dev",
          domainName: "dev.zoolandingpage.com.mx",
          certificateArn: certificates.zoolandingpageMx,
          aliasRecordGroups: [
            {
              ...hostedZones.zoolandingpageComMx,
              domainNames: ["dev.zoolandingpage.com.mx"],
            },
          ],
        },
      ],
    },
    removalPolicy: "destroy",
  },
  {
    ...environmentDefaults,
    name: "test",
    stageId: "ZoolandingTest",
    branch: "test",
    frontendHosting: {
      ...buildFrontendHostingConfig("test"),
      frontDoors: [
        {
          id: "test",
          route53RecordsEnabled: false,
          auditHostHint: "test.zoolandingpage.com.mx",
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
    frontendHosting: {
      ...buildFrontendHostingConfig("production"),
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
  unresolvedEc2Aliases,
};
