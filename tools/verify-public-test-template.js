"use strict";

const { createHash } = require("node:crypto");
const { isDeepStrictEqual } = require("node:util");

const PUBLIC_SSR = "FrontendSsrFunction47B61DD8";
const PUBLIC_DISTRIBUTION = "FrontendDistributionTest5861017E";
const PUBLIC_STATIC_ORIGIN = "ZoolandingTestZoolandingpagetestFrontendFrontendDistributionTestOrigin20DBA5DB3";
const RELEASE_PARAMETER = "FrontendReleaseIdParameter16EC4113";
const SERVER_KEY_PARAMETER = "FrontendServerBundleKeyParameter0AEF5A3E";
const PRIVATE_SSR = "FrontendThnAdminSsrFunction874373CC";
const PRIVATE_DISTRIBUTION = "FrontendDistributionThehairnarrativeAdminTest5B029562";
const CDK_PROVIDER = "AWS679f53fac002430cb0da5b7982bd22872D164C4C";
const ARTIFACT_BUCKET = "FrontendArtifactBucket349514A5";
const RELEASE_OUTPUT = "FrontendReleaseId";
const SCHEMA = "zoolanding-public-test-release-projection/v1";
const RELEASE_PREFIX = "frontend/angular-ssr/test/releases/";
const PUBLIC_ALIAS = "test.zoolandingpage.com.mx";
const PRIVATE_ALIAS = "admin-test.thehairnarrative.com";
const SERVER_SUFFIX = "/server/ssr-handler.zip";

const expectedResources = new Map([
  [PUBLIC_SSR, { type: "AWS::Lambda::Function", targets: ["Code", "Environment"] }],
  [PUBLIC_DISTRIBUTION, { type: "AWS::CloudFront::Distribution", targets: ["DistributionConfig"] }],
  [RELEASE_PARAMETER, { type: "AWS::SSM::Parameter", targets: ["Value"] }],
  [SERVER_KEY_PARAMETER, { type: "AWS::SSM::Parameter", targets: ["Value"] }],
]);

function fail(code = "public_test_release_template_invalid") {
  throw new Error(code);
}

function validReleaseId(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value) && !value.includes("..");
}

function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function sortedJson(value) {
  if (Array.isArray(value)) return value.map(sortedJson);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, sortedJson(value[key])]));
}

function templateDigest(template) {
  return createHash("sha256").update(JSON.stringify(sortedJson(template))).digest("hex");
}

function resourceProperties(template, logicalId, type) {
  const resource = template?.Resources?.[logicalId];
  if (!isRecord(resource) || resource.Type !== type || !isRecord(resource.Properties)) fail();
  return resource.Properties;
}

function releaseSelectors(template, currentReleaseId) {
  const ssr = resourceProperties(template, PUBLIC_SSR, "AWS::Lambda::Function");
  const cloudfront = resourceProperties(template, PUBLIC_DISTRIBUTION, "AWS::CloudFront::Distribution").DistributionConfig;
  const releaseParameter = resourceProperties(template, RELEASE_PARAMETER, "AWS::SSM::Parameter");
  const serverKeyParameter = resourceProperties(template, SERVER_KEY_PARAMETER, "AWS::SSM::Parameter");
  const privateSsr = resourceProperties(template, PRIVATE_SSR, "AWS::Lambda::Function");
  const privateCloudfront = resourceProperties(template, PRIVATE_DISTRIBUTION, "AWS::CloudFront::Distribution").DistributionConfig;

  const privateRelease = privateSsr.Environment?.Variables?.ZLP_RELEASE_ID;
  const key = `${RELEASE_PREFIX}${currentReleaseId}${SERVER_SUFFIX}`;
  const output = template.Outputs?.[RELEASE_OUTPUT];
  if (ssr.FunctionName !== "zoolandingpage-test-frontend-ssr"
    || ssr.Code?.S3Key !== key
    || !isDeepStrictEqual(ssr.Code?.S3Bucket, { Ref: ARTIFACT_BUCKET })
    || ssr.Environment?.Variables?.ZLP_RELEASE_ID !== currentReleaseId
    || !isDeepStrictEqual(cloudfront?.Aliases, [PUBLIC_ALIAS])
    || !Array.isArray(cloudfront.Origins)
    || releaseParameter.Type !== "String" || releaseParameter.Name !== "/zoolandingpage/test/frontend/release-id"
    || releaseParameter.Value !== currentReleaseId
    || serverKeyParameter.Type !== "String" || serverKeyParameter.Name !== "/zoolandingpage/test/frontend/server-bundle-key"
    || serverKeyParameter.Value !== key
    || !isRecord(output) || output.Value !== currentReleaseId
    || privateSsr.FunctionName !== "zoolandingpage-test-frontend-thn-admin-ssr"
    || !validReleaseId(privateRelease)
    || privateSsr.Code?.S3Key !== `${RELEASE_PREFIX}${privateRelease}${SERVER_SUFFIX}`
    || !isDeepStrictEqual(privateCloudfront?.Aliases, [PRIVATE_ALIAS])
    || !Array.isArray(privateCloudfront.Origins)
    || privateCloudfront.Origins.filter(origin => origin?.OriginPath === `/${RELEASE_PREFIX}${privateRelease}`).length !== 1) fail();

  const staticOrigins = cloudfront.Origins.filter(origin => origin?.Id === PUBLIC_STATIC_ORIGIN);
  if (staticOrigins.length !== 1 || staticOrigins[0].OriginPath !== `/${RELEASE_PREFIX}${currentReleaseId}/browser`
    || cloudfront.Origins.filter(origin => String(origin?.OriginPath ?? "").startsWith(`/${RELEASE_PREFIX}`)).length !== 1) fail();

  return { ssr, staticOrigin: staticOrigins[0], releaseParameter, serverKeyParameter, output };
}

function projectPublicTestRelease(live, { currentReleaseId, releaseId } = {}) {
  if (!validReleaseId(currentReleaseId) || !validReleaseId(releaseId) || currentReleaseId === releaseId
    || !isRecord(live) || !isRecord(live.Resources)) fail();
  const candidate = structuredClone(live);
  const selectors = releaseSelectors(candidate, currentReleaseId);
  const key = `${RELEASE_PREFIX}${releaseId}${SERVER_SUFFIX}`;
  selectors.ssr.Code.S3Key = key;
  selectors.ssr.Environment.Variables.ZLP_RELEASE_ID = releaseId;
  selectors.staticOrigin.OriginPath = `/${RELEASE_PREFIX}${releaseId}/browser`;
  selectors.releaseParameter.Value = releaseId;
  selectors.serverKeyParameter.Value = key;
  selectors.output.Value = releaseId;
  return {
    candidate,
    envelope: {
      schema: SCHEMA,
      currentReleaseId,
      releaseId,
      rollbackSha256: templateDigest(live),
      candidateSha256: templateDigest(candidate),
    },
  };
}

function normalizeCdkBookkeeping(expected, candidate) {
  // The native change-set reviewer independently proves any bookkeeping entries.
  const expectedAnalytics = expected.Resources.CDKMetadata;
  const candidateAnalytics = candidate.Resources.CDKMetadata;
  if (expectedAnalytics?.Type === "AWS::CDK::Metadata" && candidateAnalytics?.Type === expectedAnalytics.Type
    && typeof expectedAnalytics.Properties?.Analytics === "string" && expectedAnalytics.Properties.Analytics
    && typeof candidateAnalytics.Properties?.Analytics === "string" && candidateAnalytics.Properties.Analytics) {
    expectedAnalytics.Properties.Analytics = candidateAnalytics.Properties.Analytics;
  }

  const expectedProvider = expected.Resources[CDK_PROVIDER];
  const candidateProvider = candidate.Resources?.[CDK_PROVIDER];
  if (expectedProvider?.Type === "AWS::Lambda::Function" && candidateProvider?.Type === expectedProvider.Type
    && expectedProvider.Metadata?.["aws:asset:property"] === "Code" && candidateProvider.Metadata?.["aws:asset:property"] === "Code"
    && typeof expectedProvider.Metadata["aws:asset:path"] === "string" && expectedProvider.Metadata["aws:asset:path"]
    && typeof candidateProvider.Metadata["aws:asset:path"] === "string" && candidateProvider.Metadata["aws:asset:path"]) {
    expectedProvider.Metadata["aws:asset:path"] = candidateProvider.Metadata["aws:asset:path"];
  }
}

function verifyPublicTestTemplate(live, candidate, options) {
  const expected = projectPublicTestRelease(live, options);
  if (!isRecord(candidate)) fail();
  normalizeCdkBookkeeping(expected.candidate, candidate);
  if (!isDeepStrictEqual(candidate, expected.candidate)) fail();
  return { ...expected.envelope, candidateSha256: templateDigest(candidate) };
}

function verifyPublicTestChangeSet(description) {
  const invalid = () => fail("public_test_release_change_set_invalid");
  if (description?.Status !== "CREATE_COMPLETE" || description.ExecutionStatus !== "AVAILABLE"
    || description.NextToken || description.ParentChangeSetId || description.RootChangeSetId
    || !Array.isArray(description.Changes)) invalid();

  // This also checks identity, exact AWS scope and complete evidence for both allowed metadata shapes.
  require("./review-test-infra-change-set").reviewChangeSet(description, {
    expectedStackName: "ZoolandingTest-Zoolandingpage-test-Frontend",
    expectedChangeSetName: description.ChangeSetName,
    expectedChangeSetArn: description.ChangeSetId,
    expectedChangeSetType: "UPDATE",
    expectedAccountId: "765932874577",
    expectedRegion: "us-east-1",
  });

  const seen = new Set();
  for (const change of description.Changes) {
    const resource = change?.ResourceChange;
    const logicalId = resource?.LogicalResourceId;
    const wanted = expectedResources.get(logicalId);
    const metadataOnly = logicalId === "CDKMetadata" && resource?.ResourceType === "AWS::CDK::Metadata"
      || logicalId === CDK_PROVIDER && resource?.ResourceType === "AWS::Lambda::Function"
        && isDeepStrictEqual(resource.Scope, ["Metadata"]);
    if (change?.Type !== "Resource" || seen.has(logicalId) || resource.ChangeSetId
      || resource.Action !== "Modify" || (!metadataOnly && !wanted)) invalid();
    seen.add(logicalId);
    if (metadataOnly) continue;
    if (resource.ResourceType !== wanted.type || resource.Replacement !== "False"
      || !isDeepStrictEqual(resource.Scope, ["Properties"]) || !Array.isArray(resource.Details)) invalid();
    const targets = new Set();
    for (const detail of resource.Details) {
      if (detail?.Evaluation !== "Static" || detail.ChangeSource !== "DirectModification"
        || detail.CausingEntity != null || detail.Target?.Attribute !== "Properties"
        || detail.Target.RequiresRecreation !== "Never" || !wanted.targets.includes(detail.Target.Name)
        || (detail.Target.AttributeChangeType != null && detail.Target.AttributeChangeType !== "Modify")) invalid();
      targets.add(detail.Target.Name);
    }
    if (targets.size !== wanted.targets.length) invalid();
  }
  if ([...expectedResources.keys()].some(logicalId => !seen.has(logicalId))) invalid();
  return "execute";
}

module.exports = { verifyPublicTestTemplate, verifyPublicTestChangeSet };
