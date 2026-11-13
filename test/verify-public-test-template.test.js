"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { verifyPublicTestTemplate, verifyPublicTestChangeSet } = require("../tools/verify-public-test-template");

const currentReleaseId = "public-previous-123";
const releaseId = "public-next-456";
const privateReleaseId = "private-current-789";
const releasePrefix = "frontend/angular-ssr/test/releases/";
const serverKey = id => `${releasePrefix}${id}/server/ssr-handler.zip`;
const originPath = id => `/${releasePrefix}${id}`;
const ssr = "FrontendSsrFunction47B61DD8";
const distribution = "FrontendDistributionTest5861017E";
const staticOrigin = "ZoolandingTestZoolandingpagetestFrontendFrontendDistributionTestOrigin20DBA5DB3";
const releaseParameter = "FrontendReleaseIdParameter16EC4113";
const serverKeyParameter = "FrontendServerBundleKeyParameter0AEF5A3E";
const privateSsr = "FrontendThnAdminSsrFunction874373CC";
const privateDistribution = "FrontendDistributionThehairnarrativeAdminTest5B029562";
const cdkProvider = "AWS679f53fac002430cb0da5b7982bd22872D164C4C";

function lambda(name, id) {
  return {
    Type: "AWS::Lambda::Function",
    Properties: {
      FunctionName: name,
      Code: { S3Bucket: { Ref: "FrontendArtifactBucket349514A5" }, S3Key: serverKey(id) },
      Environment: { Variables: { ZLP_RELEASE_ID: id, ZLP_RUNTIME_ENV: "test" } },
    },
  };
}

function cloudfront(alias, origins) {
  return { Type: "AWS::CloudFront::Distribution", Properties: {
    DistributionConfig: { Aliases: [alias], Origins: origins, Enabled: true },
  } };
}

function ssm(name, value) {
  return { Type: "AWS::SSM::Parameter", Properties: { Name: `/zoolandingpage/test/frontend/${name}`, Type: "String", Value: value } };
}

function fixture(id) {
  return {
    Resources: {
      [ssr]: lambda("zoolandingpage-test-frontend-ssr", id),
      [distribution]: cloudfront("test.zoolandingpage.com.mx", [
        { Id: "public-server" },
        { Id: staticOrigin, OriginPath: `${originPath(id)}/browser` },
        { Id: "api", OriginPath: "/test" },
      ]),
      [releaseParameter]: ssm("release-id", id),
      [serverKeyParameter]: ssm("server-bundle-key", serverKey(id)),
      [privateSsr]: lambda("zoolandingpage-test-frontend-thn-admin-ssr", privateReleaseId),
      [privateDistribution]: cloudfront("admin-test.thehairnarrative.com", [
        { Id: "private-server" },
        { Id: "private-assets", OriginPath: originPath(privateReleaseId) },
      ]),
      CDKMetadata: { Type: "AWS::CDK::Metadata", Properties: { Analytics: "v2:deflate64:before" } },
      [cdkProvider]: { Type: "AWS::Lambda::Function", Properties: { Code: { ZipFile: "unchanged" } },
        Metadata: { "aws:asset:property": "Code", "aws:asset:path": "../asset.before", "aws:cdk:path": "fixed" } },
    },
    Outputs: { FrontendReleaseId: { Value: id }, PrivateOrigin: { Value: "unchanged" } },
    Parameters: { OriginParameter: { Type: "String", NoEcho: true } },
  };
}

function verify(live, candidate) {
  return verifyPublicTestTemplate(live, candidate, { currentReleaseId, releaseId });
}

test("binds the six public selectors to two distinct immutable releases and seals both templates", () => {
  const live = fixture(currentReleaseId);
  const candidate = fixture(releaseId);
  const envelope = verify(live, candidate);
  assert.equal(envelope.currentReleaseId, currentReleaseId);
  assert.equal(envelope.releaseId, releaseId);
  assert.match(envelope.rollbackSha256, /^[a-f0-9]{64}$/);
  assert.match(envelope.candidateSha256, /^[a-f0-9]{64}$/);
  assert.notEqual(envelope.candidateSha256, envelope.rollbackSha256);
  const reordered = { ...candidate, Resources: Object.fromEntries(Object.entries(candidate.Resources).reverse()) };
  assert.deepEqual(verify(live, reordered), envelope);
  assert.deepEqual(live, fixture(currentReleaseId));
  assert.deepEqual(candidate, fixture(releaseId));
});

test("accepts only the known nonfunctional CDK Analytics and Lambda asset-path differences", () => {
  const live = fixture(currentReleaseId);
  const candidate = fixture(releaseId);
  candidate.Resources.CDKMetadata.Properties.Analytics = "v2:deflate64:after";
  candidate.Resources[cdkProvider].Metadata["aws:asset:path"] = "../asset.after";
  assert.doesNotThrow(() => verify(live, candidate));

  candidate.Resources[cdkProvider].Metadata["aws:cdk:path"] = "changed";
  assert.throws(() => verify(live, candidate), /public_test_release_template_invalid/);
});

test("rejects public release drift, foreign paths, wrong public aliases and a mismatched private release", () => {
  for (const mutate of [
    t => { t.Resources[ssr].Properties.Code.S3Bucket.Ref = "OtherBucket"; },
    t => { t.Resources[ssr].Properties.Code.S3Key = serverKey(privateReleaseId); },
    t => { t.Resources[distribution].Properties.DistributionConfig.Aliases.push("production.example.com"); },
    t => { t.Resources[distribution].Properties.DistributionConfig.Origins[1].OriginPath = "/wrong"; },
    t => { t.Resources[releaseParameter].Properties.Value = privateReleaseId; },
    t => { t.Resources[privateSsr].Properties.Environment.Variables.ZLP_RELEASE_ID = "broken"; },
    t => { t.Outputs.FrontendReleaseId.Value = privateReleaseId; },
  ]) {
    const live = fixture(currentReleaseId);
    mutate(live);
    assert.throws(() => verify(live, fixture(releaseId)), /public_test_release_template_invalid/);
  }
  assert.throws(() => verifyPublicTestTemplate(fixture(currentReleaseId), fixture(releaseId),
    { currentReleaseId, releaseId: "../outside" }), /public_test_release_template_invalid/);
});

test("rejects private drift, code and networking changes, and additional template content", () => {
  for (const mutate of [
    t => { t.Resources[privateSsr].Properties.Code.S3Key = serverKey(currentReleaseId); },
    t => { t.Resources[privateDistribution].Properties.DistributionConfig.Origins[1].OriginPath = originPath(releaseId); },
    t => { t.Resources[ssr].Properties.Environment.Variables.ZLP_RUNTIME_ENV = "production"; },
    t => { t.Resources[distribution].Properties.DistributionConfig.Origins[2].OriginPath = "/prod"; },
    t => { t.Resources[cdkProvider].Properties.Code.ZipFile = "changed"; },
    t => { t.Parameters.OriginParameter.NoEcho = false; },
    t => { t.Outputs.PrivateOrigin.Value = "replacement"; },
    t => { t.Resources.Unrelated = { Type: "AWS::S3::Bucket" }; },
  ]) {
    const candidate = fixture(releaseId);
    mutate(candidate);
    assert.throws(() => verify(fixture(currentReleaseId), candidate), /public_test_release_template_invalid/);
  }
});

function nativeChangeSet() {
  const direct = (id, type, names) => ({ Type: "Resource", ResourceChange: {
    LogicalResourceId: id, ResourceType: type, Action: "Modify", Replacement: "False", Scope: ["Properties"],
    Details: names.map(Name => ({ Evaluation: "Static", ChangeSource: "DirectModification",
      Target: { Attribute: "Properties", Name, RequiresRecreation: "Never" } })),
  } });
  return {
    ChangeSetName: "release-123-1",
    ChangeSetId: "arn:aws:cloudformation:us-east-1:765932874577:changeSet/release-123-1/candidate",
    StackName: "ZoolandingTest-Zoolandingpage-test-Frontend",
    StackId: "arn:aws:cloudformation:us-east-1:765932874577:stack/ZoolandingTest-Zoolandingpage-test-Frontend/active",
    Status: "CREATE_COMPLETE", ExecutionStatus: "AVAILABLE",
    Changes: [
      direct(ssr, "AWS::Lambda::Function", ["Code", "Environment"]),
      direct(distribution, "AWS::CloudFront::Distribution", ["DistributionConfig"]),
      direct(releaseParameter, "AWS::SSM::Parameter", ["Value"]),
      direct(serverKeyParameter, "AWS::SSM::Parameter", ["Value"]),
    ],
  };
}

test("requires the four exact direct, non-replacing CloudFormation changes", () => {
  assert.equal(verifyPublicTestChangeSet(nativeChangeSet()), "execute");
  for (const mutate of [
    changeSet => { changeSet.Changes.pop(); },
    changeSet => { changeSet.Changes[0].ResourceChange.LogicalResourceId = privateSsr; },
    changeSet => { changeSet.Changes[0].ResourceChange.Replacement = "Conditional"; },
    changeSet => { changeSet.Changes[1].ResourceChange.Details[0].Target.Name = "Tags"; },
    changeSet => { changeSet.Changes[2].ResourceChange.Action = "Add"; },
    changeSet => { changeSet.Changes.push(structuredClone(changeSet.Changes[0])); },
    changeSet => { changeSet.Changes[3].ResourceChange.Details[0].Evaluation = "Dynamic"; },
    changeSet => { changeSet.NextToken = "truncated"; },
    changeSet => { changeSet.ParentChangeSetId = "parent"; },
  ]) {
    const candidate = nativeChangeSet();
    mutate(candidate);
    assert.throws(() => verifyPublicTestChangeSet(candidate));
  }
});

test("native reviews independently prove the allowed CDK bookkeeping", () => {
  const candidate = nativeChangeSet();
  candidate.Changes.push({ Type: "Resource", ResourceChange: {
    LogicalResourceId: "CDKMetadata", ResourceType: "AWS::CDK::Metadata",
    Action: "Modify", Replacement: "Conditional", Scope: ["Properties"],
    BeforeContext: JSON.stringify({ Properties: { Analytics: "old" } }),
    AfterContext: JSON.stringify({ Properties: { Analytics: "new" } }),
    Details: [{ Evaluation: "Static", ChangeSource: "DirectModification", Target: {
      Attribute: "Properties", Name: "Analytics", Path: "/Properties/Analytics",
      RequiresRecreation: "Conditionally", AttributeChangeType: "Modify", BeforeValue: "old", AfterValue: "new",
    } }],
  } });
  assert.equal(verifyPublicTestChangeSet(candidate), "execute");
  candidate.Changes.at(-1).ResourceChange.AfterContext = JSON.stringify({
    Properties: { Analytics: "new", AddedProperty: "outside-scope" },
  });
  assert.throws(() => verifyPublicTestChangeSet(candidate), /cdk_metadata_change_forbidden/);
});

test("native parameter readback can omit reuse flags but cannot change the parameter selection", () => {
  const { verifyPublicTestParameters } = require("../tools/verify-public-test-template");
  const parameters = [
    { ParameterKey: "ThnAdminAuthAdminOriginVerifySecret", ParameterValue: "****" },
    { ParameterKey: "BootstrapVersion", ParameterValue: "/cdk/bootstrap/version", ResolvedValue: "29" },
  ];
  assert.doesNotThrow(() => verifyPublicTestParameters(parameters, structuredClone(parameters).reverse()));
  assert.throws(() => verifyPublicTestParameters(parameters, [parameters[0]]), /public_test_ssr_parameters_changed/);
  assert.throws(() => verifyPublicTestParameters(parameters, [parameters[0], { ...parameters[1], ResolvedValue: "30" }]), /public_test_ssr_parameters_changed/);
  assert.throws(() => verifyPublicTestParameters(parameters, [{ ...parameters[0], UsePreviousValue: false }, parameters[1]]), /public_test_ssr_parameters_changed/);
});
