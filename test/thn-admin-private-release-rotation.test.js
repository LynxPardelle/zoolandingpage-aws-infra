"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const test = require("node:test");
const { fixture } = require("./fixtures/thn-admin-selection");
const release = require("../tools/thn-admin-release");
let subject;
try { subject = require("../tools/thn-admin-private-release-rotation"); }
catch (error) { if (error.code !== "MODULE_NOT_FOUND") throw error; subject = {}; }

const FUNCTION_ID = "FrontendViewerHostHeaderFunctionThehairnarrativeAdminTestD75B90C2";
const DISTRIBUTION_ID = "FrontendDistributionThehairnarrativeAdminTest5B029562";
const SSR_ID = "FrontendThnAdminSsrFunction874373CC";
const JOURNAL_PAGES = ["/admin/journal", "/admin/journal/new",
  "/admin/journal/:articleId/edit", "/admin/journal/:articleId/preview"];
const OLD_QUERY = `    var queryKeys = [];
    for (var queryKey in querystring) {
      queryKeys.push(queryKey);
    }
    if (queryKeys.length === 0) {
      return true;
    }
    if (!rule.allowLanguageQuery || queryKeys.length !== 1 || queryKeys[0] !== "lang") {
      return false;
    }
    var language = querystring.lang || {};
    if (language.multiValue && language.multiValue.length > 0) {
      return false;
    }
    return language.value === "en" || language.value === "es";`;
const NEW_QUERY = `    for (var queryKey in querystring) {
      if ((queryKey !== "lang" || !rule.allowLanguageQuery)
        && (queryKey !== "articleLocale" || !rule.allowArticleLocaleQuery)) {
        return false;
      }
      var language = querystring[queryKey] || {};
      if ((language.multiValue && language.multiValue.length > 0)
        || (language.value !== "en" && language.value !== "es")) {
        return false;
      }
    }
    return true;`;

const selected = release.selectThnAdminRelease(fixture(["/browser/chunk-12345678.js", "/browser/styles-abcdef12.css"]).inputs);
test("pins the verified replacement APP artifact and rejects another source run", () => {
  const reviewed = require("./fixtures/thn-private-reviewed-app.json");
  const coordinates = reviewed.coordinates;
  const metadata = { schemaVersion: 1, environment: "test", releaseId: reviewed.manifest.releaseId,
    sourceCommit: coordinates.sourceSha, runId: coordinates.runId, runAttempt: coordinates.runAttempt,
    deliverySha256: coordinates.deliverySha256, manifestSha256: coordinates.manifestSha256 };
  const selection = release.selectThnAdminRelease({ FRONTEND_TEST_THN_ADMIN_ORIGIN_ENABLED: "true",
    FRONTEND_TEST_THN_ADMIN_MANIFEST_BASE64: Buffer.from(`${JSON.stringify(reviewed.manifest, null, 2)}\n`).toString("base64"),
    FRONTEND_TEST_THN_ADMIN_RELEASE_METADATA_JSON: JSON.stringify(metadata) });
  assert.deepEqual(subject.validatePinnedAppCoordinates(selection, coordinates), coordinates);
  assert.throws(() => subject.validatePinnedAppCoordinates(selection, { ...coordinates, artifactId: "10939780047" }),
    /private_release_coordinates_invalid/);
  const changedSelection = structuredClone(selection);
  changedSelection.metadata.runId = "123";
  const changedCoordinates = { ...coordinates, runId: "123" };
  assert.deepEqual(subject.validateAppCoordinates(changedSelection, changedCoordinates), changedCoordinates);
  assert.throws(() => subject.validatePinnedAppCoordinates(changedSelection, changedCoordinates), /private_release_coordinates_invalid/);
});
test("requires exact independent APP artifact coordinates", () => {
  const coordinates = { artifactId: "10939780047", sourceSha: selected.metadata.sourceCommit,
    runId: selected.metadata.runId, runAttempt: selected.metadata.runAttempt,
    deliverySha256: selected.metadata.deliverySha256, manifestSha256: selected.metadata.manifestSha256 };
  assert.deepEqual(subject.validateAppCoordinates(selected, coordinates), coordinates);
  assert.throws(() => subject.validatePinnedAppCoordinates(selected, coordinates),
    /private_release_coordinates_invalid/);
  assert.throws(() => subject.validateAppCoordinates(selected, { ...coordinates, manifestSha256: "0".repeat(64) }),
    /private_release_coordinates_invalid/);
  assert.throws(() => subject.validateAppCoordinates(selected, { ...coordinates, artifactId: "0" }),
    /private_release_coordinates_invalid/);
});
const oldPaths = ["/browser/chunk-87654321.js", "/browser/styles-fedcba98.css"];
const pageRules = [{ path: "/admin/journal/access", methods: ["GET"], allowLanguageQuery: true },
  ...JOURNAL_PAGES.map(path => ({ path, methods: ["GET"], allowLanguageQuery: true }))];
const assetRules = paths => paths.map(path => ({ path, methods: ["GET"], allowLanguageQuery: false }));
const code = (rules, query) => `function handler(event) {\n  var expectedHost = "admin-test.thehairnarrative.com";\n  var rules = ${JSON.stringify(rules)};\n  function queryAllowed(rule, querystring) {\n${query}\n  }\n  return event.request;\n}`;
const behavior = path => ({ PathPattern: path.slice(1), TargetOriginId: "private-static", ViewerProtocolPolicy: "redirect-to-https" });

function templates() {
  const liveRules = [...pageRules, ...assetRules(oldPaths)];
  const desiredRules = [...pageRules.map(rule => JOURNAL_PAGES.includes(rule.path)
    ? { ...rule, allowArticleLocaleQuery: true } : rule), ...assetRules(selected.manifest.staticAssetPaths)];
  const live = { Resources: {
    Other: { Type: "AWS::S3::Bucket", Properties: { BucketName: "unchanged" } },
    [SSR_ID]: { Type: "AWS::Lambda::Function", Properties: {
      FunctionName: "zoolanding-test-private-ssr",
      Code: { S3Bucket: { Ref: "PrivateBucket" }, S3Key: "frontend/angular-ssr/test/releases/previous/server/ssr-handler.zip" },
      Environment: { Variables: { ZLP_RELEASE_ID: "previous", NODE_ENV: "production" } },
      Runtime: "nodejs22.x", Handler: "index.handler" } },
    [FUNCTION_ID]: { Type: "AWS::CloudFront::Function", Properties: {
      Name: "zoolanding-test-admin-viewer", FunctionCode: code(liveRules, OLD_QUERY) } },
    [DISTRIBUTION_ID]: { Type: "AWS::CloudFront::Distribution", Properties: { DistributionConfig: {
      Aliases: ["admin-test.thehairnarrative.com"],
      Origins: [{ Id: "private-static", OriginPath: "/frontend/angular-ssr/test/releases/previous" },
        { Id: "api", OriginPath: "/Prod" }],
      CacheBehaviors: [...oldPaths.map(behavior), { PathPattern: "auth-v2/session/me", TargetOriginId: "api" }],
    } } },
  } };
  const desired = structuredClone(live);
  desired.Resources[SSR_ID].Properties.Code.S3Key = `${selected.originPrefix}/server/ssr-handler.zip`;
  desired.Resources[SSR_ID].Properties.Environment.Variables.ZLP_RELEASE_ID = selected.metadata.releaseId;
  desired.Resources[FUNCTION_ID].Properties.FunctionCode = code(desiredRules, NEW_QUERY);
  desired.Resources[DISTRIBUTION_ID].Properties.DistributionConfig.Origins[0].OriginPath = `/${selected.originPrefix}`;
  desired.Resources[DISTRIBUTION_ID].Properties.DistributionConfig.CacheBehaviors =
    [...selected.manifest.staticAssetPaths.map(behavior), { PathPattern: "auth-v2/session/me", TargetOriginId: "api" }];
  return { live, desired };
}

test("projects only the private release while keeping the deployed query policy", () => {
  assert.equal(typeof subject.projectPrivateReleaseTemplate, "function");
  const { live, desired } = templates();
  const candidate = subject.projectPrivateReleaseTemplate(desired, live, selected);
  assert.equal(candidate.Resources[SSR_ID].Properties.Code.S3Key, `${selected.originPrefix}/server/ssr-handler.zip`);
  assert.equal(candidate.Resources[SSR_ID].Properties.Environment.Variables.ZLP_RELEASE_ID, selected.metadata.releaseId);
  assert.ok(candidate.Resources[FUNCTION_ID].Properties.FunctionCode.includes(OLD_QUERY));
  assert.ok(!candidate.Resources[FUNCTION_ID].Properties.FunctionCode.includes("articleLocale"));
  assert.equal(candidate.Resources[DISTRIBUTION_ID].Properties.DistributionConfig.Origins[0].OriginPath, `/${selected.originPrefix}`);
  assert.deepEqual(live.Resources[SSR_ID].Properties.Environment.Variables.ZLP_RELEASE_ID, "previous");
});

test("rotates assets after Query Fence is deployed without changing its policy", () => {
  const { live, desired } = templates();
  live.Resources[FUNCTION_ID].Properties.FunctionCode = code([
    ...pageRules.map(rule => JOURNAL_PAGES.includes(rule.path)
      ? { ...rule, allowArticleLocaleQuery: true } : rule), ...assetRules(oldPaths)], NEW_QUERY);
  const candidate = subject.projectPrivateReleaseTemplate(desired, live, selected);
  assert.equal(candidate.Resources[FUNCTION_ID].Properties.FunctionCode,
    desired.Resources[FUNCTION_ID].Properties.FunctionCode);
  for (const mutation of [
    source => source + "\n// unexpected handler change",
    source => source.replace('"allowArticleLocaleQuery":true', '"allowArticleLocaleQuery":false'),
    source => source.replace('"methods":["GET"]', '"methods":["GET","POST"]'),
  ]) {
    const changed = structuredClone(desired);
    changed.Resources[FUNCTION_ID].Properties.FunctionCode = mutation(changed.Resources[FUNCTION_ID].Properties.FunctionCode);
    assert.throws(() => subject.projectPrivateReleaseTemplate(changed, live, selected),
      /^Error: private_release_template_invalid_query_policy$/);
  }
});

test("rejects a live private Lambda whose code and release ID point to different artifacts", () => {
  const { live, desired } = templates();
  live.Resources[SSR_ID].Properties.Environment.Variables.ZLP_RELEASE_ID = "another-release";
  assert.throws(() => subject.projectPrivateReleaseTemplate(desired, live, selected),
    /^Error: private_release_template_invalid_ssr_coordinates$/);
});

test("rejects unrelated template changes and nonstatic route changes", () => {
  const unrelated = templates();
  unrelated.desired.Resources.Other.Properties.BucketName = "different";
  assert.throws(() => subject.projectPrivateReleaseTemplate(unrelated.desired, unrelated.live, selected),
    /^Error: private_release_template_invalid_static_rotation$/);
  const route = templates();
  route.desired.Resources[FUNCTION_ID].Properties.FunctionCode = route.desired.Resources[FUNCTION_ID]
    .Properties.FunctionCode.replace('"methods":["GET"]', '"methods":["GET","POST"]');
  assert.throws(() => subject.projectPrivateReleaseTemplate(route.desired, route.live, selected),
    /private_release_template_invalid/);
  const handler = templates();
  handler.desired.Resources[FUNCTION_ID].Properties.FunctionCode += "\n// unexpected handler change";
  assert.throws(() => subject.projectPrivateReleaseTemplate(handler.desired, handler.live, selected),
    /private_release_template_invalid/);
});

test("rejects Lambda changes outside the selected code and release ID", () => {
  const { live, desired } = templates();
  desired.Resources[SSR_ID].Properties.Environment.Variables.NODE_ENV = "test";
  assert.throws(() => subject.projectPrivateReleaseTemplate(desired, live, selected),
    /private_release_template_invalid/);
});

const STACK = "ZoolandingTest-Zoolandingpage-test-Frontend";
const STACK_ID = `arn:aws:cloudformation:us-east-1:765932874577:stack/${STACK}/00000000-0000-0000-0000-000000000001`;
const CHANGE_SET_ID = "arn:aws:cloudformation:us-east-1:765932874577:changeSet/release-123-1/00000000-0000-0000-0000-000000000001";
const changeSet = changes => ({ StackName: STACK, StackId: STACK_ID, ChangeSetName: "release-123-1",
  ChangeSetId: CHANGE_SET_ID, Status: "CREATE_COMPLETE", ExecutionStatus: "AVAILABLE", Parameters: [],
  Changes: changes.map(ResourceChange => ({ Type: "Resource", ResourceChange })) });
const signature = token => `(Truncated-Signature):${token.repeat(64)}`;
const direct = (id, type, name) => ({ Action: "Modify", LogicalResourceId: id, ResourceType: type,
  Replacement: "False", Scope: ["Properties"],
  BeforeContext: JSON.stringify({ Properties: { ...(id === DISTRIBUTION_ID ? { Tags: [{ Key: "Environment", Value: "test" }] }
    : id === FUNCTION_ID ? { AutoPublish: "true", FunctionConfig: { Runtime: "cloudfront-js-2.0" },
      Name: "private-admin-test", Tags: [{ Key: "Environment", Value: "test" }] } : {}), [name]: signature("a") },
  Metadata: { "aws:cdk:path": `ZoolandingTest/Zoolandingpage-test-Frontend/${id.replace(/[A-F0-9]{8}$/, "")}/Resource` } }),
  AfterContext: JSON.stringify({ Properties: { ...(id === DISTRIBUTION_ID ? { Tags: [{ Key: "Environment", Value: "test" }] }
    : id === FUNCTION_ID ? { AutoPublish: "true", FunctionConfig: { Runtime: "cloudfront-js-2.0" },
      Name: "private-admin-test", Tags: [{ Key: "Environment", Value: "test" }] } : {}), [name]: signature("b") },
  Metadata: { "aws:cdk:path": `ZoolandingTest/Zoolandingpage-test-Frontend/${id.replace(/[A-F0-9]{8}$/, "")}/Resource` } }),
  Details: [{ Evaluation: "Static", ChangeSource: "DirectModification", Target: {
    Attribute: "Properties", Name: name, Path: `/Properties/${name}`, RequiresRecreation: "Never",
    AttributeChangeType: "Modify", BeforeValue: signature("a"), AfterValue: signature("b") } }] });
function rotationChanges() {
  const distribution = direct(DISTRIBUTION_ID, "AWS::CloudFront::Distribution", "DistributionConfig");
  const viewer = direct(FUNCTION_ID, "AWS::CloudFront::Function", "FunctionCode");
  const lambda = direct(SSR_ID, "AWS::Lambda::Function", "Code");
  lambda.Details[0].Target.Path = "/Properties/Code/S3Key";
  lambda.Details.push({ Evaluation: "Static", ChangeSource: "DirectModification", Target: {
    Attribute: "Properties", Name: "Environment", Path: "/Properties/Environment/Variables/ZLP_RELEASE_ID",
    RequiresRecreation: "Never", AttributeChangeType: "Modify", BeforeValue: "before", AfterValue: "after" } });
  const detailed = changeSet([distribution, viewer, lambda]);
  const summary = structuredClone(detailed);
  for (const item of summary.Changes) {
    delete item.ResourceChange.BeforeContext;
    delete item.ResourceChange.AfterContext;
    for (const detail of item.ResourceChange.Details) {
      delete detail.Target.BeforeValue;
      delete detail.Target.AfterValue;
      delete detail.Target.Path;
      delete detail.Target.AttributeChangeType;
    }
  }
  const dynamic = (id, type, replacement, name, recreation, cause = `${DISTRIBUTION_ID}.DomainName`) => ({ Action: "Modify", LogicalResourceId: id,
    ResourceType: type, Replacement: replacement, Scope: ["Properties"],
    Details: [{ Evaluation: "Dynamic", ChangeSource: "ResourceAttribute",
      CausingEntity: cause, Target: { Attribute: "Properties", Name: name,
        RequiresRecreation: recreation } }] });
  summary.Changes.unshift(
    { Type: "Resource", ResourceChange: dynamic("FrontendAliasUpsertThehairnarrativeAdminTestThehairnarrativeComD6748622",
      "Custom::ZoolandingFrontendAliasRecords", "Conditional", "Create", "Conditionally") },
    { Type: "Resource", ResourceChange: dynamic("FrontendDistributionDomainParameterThehairnarrativeAdminTest95A70218",
      "AWS::SSM::Parameter", "False", "Value", "Never") });
  summary.Changes[2].ResourceChange.Details = [
    { Evaluation: "Dynamic", ChangeSource: "ResourceAttribute",
      CausingEntity: "FrontendThnAdminSsrFunctionFunctionUrlA847D4A7.FunctionUrl",
      Target: { Attribute: "Properties", Name: "DistributionConfig", RequiresRecreation: "Never" } },
    { Evaluation: "Dynamic", ChangeSource: "ResourceAttribute", CausingEntity: `${FUNCTION_ID}.FunctionARN`,
      Target: { Attribute: "Properties", Name: "DistributionConfig", RequiresRecreation: "Never" } },
    { Evaluation: "Dynamic", ChangeSource: "DirectModification",
      Target: { Attribute: "Properties", Name: "DistributionConfig", RequiresRecreation: "Never" } }];
  summary.Changes.push(
    { Type: "Resource", ResourceChange: dynamic(
      "FrontendDistributionThehairnarrativeAdminTestOrigin1InvokeFromApiForZoolandingTestZoolandingpagetestFrontendFrontendDistributionThehairnarrativeAdminTestOrigin16C8F5824458F999C",
      "AWS::Lambda::Permission", "Conditional", "FunctionName", "Always",
      "FrontendThnAdminSsrFunctionFunctionUrlA847D4A7.FunctionArn") },
    { Type: "Resource", ResourceChange: dynamic(
      "FrontendThnAdminSsrFunctionAllowCloudFrontInvokeFunctionThehairnarrativeAdminTest3FBFDE4C",
      "AWS::Lambda::Permission", "Conditional", "FunctionName", "Always", `${SSR_ID}.Arn`) },
    { Type: "Resource", ResourceChange: dynamic(
      "FrontendThnAdminSsrFunctionAllowCloudFrontInvokeFunctionUrlThehairnarrativeAdminTestA8483BAF",
      "AWS::Lambda::Permission", "Conditional", "FunctionName", "Always", `${SSR_ID}.Arn`) },
    { Type: "Resource", ResourceChange: dynamic(
      "FrontendThnAdminSsrFunctionFunctionUrlA847D4A7",
      "AWS::Lambda::Url", "Conditional", "TargetFunctionArn", "Always", `${SSR_ID}.Arn`) });
  return { detailed, summary };
}
const reviewContext = { expectedStackName: STACK, expectedChangeSetName: "release-123-1",
  expectedChangeSetArn: CHANGE_SET_ID, expectedChangeSetType: "UPDATE", expectedAccountId: "765932874577",
  expectedRegion: "us-east-1", adminInfrastructureApproved: true,
  adminRouteAssociationApproved: true, aliasCreateOnly: true, dnsUnchanged: true, expectedParameters: [] };

test("reviews exactly the private Lambda plus proven static rotation entries", () => {
  assert.equal(typeof subject.reviewPrivateReleaseChangeSet, "function");
  const { detailed, summary } = rotationChanges();
  assert.equal(subject.reviewPrivateReleaseChangeSet(detailed, summary, reviewContext), "execute");
});

test("rejects an extra change or a replacing private Lambda", () => {
  const extra = rotationChanges();
  extra.summary.Changes.push({ Type: "Resource", ResourceChange: direct("OtherFunctionAABBCCDD",
    "AWS::Lambda::Function", "Code") });
  assert.throws(() => subject.reviewPrivateReleaseChangeSet(extra.detailed, extra.summary, reviewContext),
    /private_release_change_set_invalid/);
  const replacing = rotationChanges();
  replacing.detailed.Changes[2].ResourceChange.Replacement = "True";
  assert.throws(() => subject.reviewPrivateReleaseChangeSet(replacing.detailed, replacing.summary, reviewContext),
    /private_release_change_set_invalid/);
});

test("conditional dependency entries require the exact native reference proof", () => {
  const cases = [
    evidence => { evidence.summary.Changes[5].ResourceChange.Replacement = "True"; },
    evidence => { evidence.summary.Changes[5].ResourceChange.Details[0].ChangeSource = "DirectModification"; },
    evidence => { evidence.summary.Changes[8].ResourceChange.Details[0].CausingEntity = `${FUNCTION_ID}.FunctionARN`; },
    evidence => { evidence.summary.Changes.splice(5, 1); },
    evidence => { evidence.detailed.Changes.push(structuredClone(evidence.summary.Changes[5])); },
  ];
  for (const mutate of cases) {
    const evidence = rotationChanges();
    mutate(evidence);
    assert.throws(() => subject.reviewPrivateReleaseChangeSet(evidence.detailed, evidence.summary,
      reviewContext), /private_release_change_set_invalid/);
  }
});

test("failed change-set review reports a bounded cause without property values", () => {
  const evidence = rotationChanges();
  evidence.detailed.Changes[2].ResourceChange.Details[1].Target.Name = "Role";
  evidence.detailed.Changes[2].ResourceChange.Details[1].Target.BeforeValue = "private-secret";
  let failure;
  try { subject.reviewPrivateReleaseChangeSet(evidence.detailed, evidence.summary, reviewContext); }
  catch (error) { failure = error; }
  assert.equal(failure?.reviewStage, "detailed_lambda_details");
  assert.equal(failure?.reviewReason, "private_release_template_invalid");
  assert.equal(failure?.changeInventory?.detailed?.[2]?.details?.[1]?.name, "Role");
  assert.doesNotMatch(JSON.stringify(failure?.changeInventory), /private-secret/);
});

test("rejects incomplete, drifted, or unapproved change set evidence", () => {
  const cases = [
    ({ detailed }) => { detailed.NextToken = "more"; },
    ({ summary }) => { summary.Parameters = [{ ParameterKey: "Unexpected", ParameterValue: "1" }]; },
    ({ detailed }) => { detailed.Changes[2].ResourceChange.Details[1].Target.Name = "Role"; },
    ({ summary }) => { summary.Changes[4].ResourceChange.Details[0].ChangeSource = "ResourceAttribute"; },
    ({ summary }) => { summary.Changes.push(structuredClone(summary.Changes[4])); },
  ];
  for (const change of cases) {
    const evidence = rotationChanges();
    change(evidence);
    assert.throws(() => subject.reviewPrivateReleaseChangeSet(evidence.detailed, evidence.summary, reviewContext),
      /private_release_change_set_invalid/);
  }
  const evidence = rotationChanges();
  assert.throws(() => subject.reviewPrivateReleaseChangeSet(evidence.detailed, evidence.summary,
    { ...reviewContext, dnsUnchanged: false }), /private_release_change_set_invalid/);
});

test("parameter identity is order independent but rejects changed or duplicated values", () => {
  const { detailed, summary } = rotationChanges();
  detailed.Parameters = [{ ParameterKey: "One", ParameterValue: "a" },
    { ParameterKey: "Two", ParameterValue: "b" }];
  summary.Parameters = structuredClone(detailed.Parameters).reverse();
  const context = { ...reviewContext, expectedParameters: [...detailed.Parameters] };
  assert.equal(subject.reviewPrivateReleaseChangeSet(detailed, summary, context), "execute");
  summary.Parameters[0].ParameterValue = "changed";
  assert.throws(() => subject.reviewPrivateReleaseChangeSet(detailed, summary, context),
    /private_release_change_set_invalid/);
  summary.Parameters = [detailed.Parameters[0], detailed.Parameters[0]];
  assert.throws(() => subject.reviewPrivateReleaseChangeSet(detailed, summary, context),
    /private_release_change_set_invalid/);
});

test("review removes its unexecuted change set", async () => {
  const calls = [];
  const evidence = rotationChanges();
  const baseline = { stackId: STACK_ID, templateHash: "same" };
  const result = await subject.runGuardedRotation("review", {
    context: reviewContext,
    preflight: async () => { calls.push("preflight"); return baseline; },
    describe: async () => { calls.push("describe"); return [evidence.detailed, evidence.summary]; },
    cleanup: async () => { calls.push("cleanup"); },
    execute: async () => { calls.push("execute"); },
  });
  assert.equal(result.decision, "reviewed-no-execution");
  assert.match(result.reviewedDigest, /^[a-f0-9]{64}$/);
  assert.deepEqual(result.inventory.detailed.map(item => item.logicalId),
    [DISTRIBUTION_ID, FUNCTION_ID, SSR_ID]);
  assert.equal(result.inventory.summary.length, 9);
  assert.deepEqual(calls, ["preflight", "describe", "describe", "cleanup"]);
});

test("review rejection still deletes its change set before any execution", async () => {
  const calls = [];
  const evidence = rotationChanges();
  evidence.summary.Changes.push({ Type: "Resource", ResourceChange: direct("UnexpectedAABBCCDD",
    "AWS::Lambda::Function", "Code") });
  await assert.rejects(() => subject.runGuardedRotation("review", {
    context: reviewContext,
    preflight: async () => { calls.push("preflight"); return { stackId: STACK_ID }; },
    describe: async () => { calls.push("describe"); return [evidence.detailed, evidence.summary]; },
    cleanup: async () => { calls.push("cleanup"); },
    execute: async () => { calls.push("execute"); },
  }), /private_release_change_set_invalid/);
  assert.deepEqual(calls, ["preflight", "describe", "cleanup"]);
});

test("execute requires stable preflight and exact reviewed inventory", async () => {
  const calls = [];
  const evidence = rotationChanges();
  const baseline = { stackId: STACK_ID, templateHash: "same" };
  const operations = {
    context: reviewContext,
    preflight: async () => { calls.push("preflight"); return baseline; },
    describe: async () => { calls.push("describe"); return [evidence.detailed, evidence.summary]; },
    cleanup: async () => { calls.push("cleanup"); },
    execute: async () => { calls.push("execute"); },
    wait: async () => { calls.push("wait"); },
    postcheck: async () => { calls.push("postcheck"); },
  };
  operations.expectedReviewDigest = subject.changeSetEvidenceDigest(evidence.detailed, evidence.summary);
  assert.equal((await subject.runGuardedRotation("execute", operations)).decision, "executed");
  assert.deepEqual(calls, ["preflight", "describe", "describe", "preflight", "describe",
    "execute", "wait", "postcheck", "postcheck"]);
  calls.length = 0;
  let count = 0;
  await assert.rejects(() => subject.runGuardedRotation("execute", {
    ...operations,
    preflight: async () => { calls.push("preflight"); return ++count === 1 ? baseline : { ...baseline, templateHash: "changed" }; },
  }), /private_release_pre_execute_drift/);
  assert.deepEqual(calls, ["preflight", "describe", "describe", "preflight", "cleanup"]);
  calls.length = 0;
  await assert.rejects(() => subject.runGuardedRotation("execute", {
    ...operations, expectedReviewDigest: "0".repeat(64),
  }), /private_release_review_digest_changed/);
  assert.deepEqual(calls, ["preflight", "describe", "describe", "cleanup"]);
});

function runtimeState(template, sha = "A".repeat(43) + "=") {
  const viewerName = template.Resources[FUNCTION_ID].Properties.Name;
  const arn = `arn:aws:cloudfront::765932874577:function/${viewerName}`;
  const lambdaName = template.Resources[SSR_ID].Properties.FunctionName;
  const resources = Object.entries(template.Resources).map(([LogicalResourceId, resource]) => ({
    LogicalResourceId, ResourceType: resource.Type, ResourceStatus: "UPDATE_COMPLETE",
    PhysicalResourceId: LogicalResourceId === FUNCTION_ID ? arn
      : LogicalResourceId === SSR_ID ? lambdaName
        : LogicalResourceId === DISTRIBUTION_ID ? "DIST1234567" : "unchanged-bucket",
  }));
  const config = template.Resources[DISTRIBUTION_ID].Properties.DistributionConfig;
  const association = { Quantity: 1, Items: [{ EventType: "viewer-request", FunctionARN: arn }] };
  const shape = item => ({ ...item, FunctionAssociations: association });
  const alias = { DNSName: "d123.cloudfront.net.", HostedZoneId: "ZCLOUD", EvaluateTargetHealth: false };
  return { original: template, processed: structuredClone(template),
    stack: { StackName: STACK, StackId: STACK_ID, StackStatus: "UPDATE_COMPLETE", EnableTerminationProtection: false,
      RoleARN: "arn:aws:iam::765932874577:role/cdk-hnb659fds-cfn-exec-role-765932874577-us-east-1",
      Parameters: [], Outputs: [{ OutputKey: "FrontendReleaseId", OutputValue: "public-release" }] },
    resources, functionCode: template.Resources[FUNCTION_ID].Properties.FunctionCode,
    function: { ETag: "viewer-etag", FunctionSummary: { Name: viewerName, Status: "DEPLOYED",
      FunctionMetadata: { FunctionARN: arn } } },
    lambda: { FunctionName: lambdaName,
      FunctionArn: `arn:aws:lambda:us-east-1:765932874577:function:${lambdaName}`,
      State: "Active", LastUpdateStatus: "Successful", CodeSha256: sha,
      Environment: structuredClone(template.Resources[SSR_ID].Properties.Environment) },
    distribution: { ETag: "distribution-etag", DistributionConfig: {
      Aliases: { Quantity: 1, Items: ["admin-test.thehairnarrative.com"] },
      DefaultCacheBehavior: shape({ PathPattern: "default" }),
      CacheBehaviors: { Quantity: config.CacheBehaviors.length, Items: config.CacheBehaviors.map(shape) },
      Origins: { Quantity: config.Origins.length, Items: structuredClone(config.Origins) },
    } },
    dns: { ResourceRecordSets: ["A", "AAAA"].map(Type => ({ Name: "admin-test.thehairnarrative.com.",
      Type, AliasTarget: structuredClone(alias) })) },
  };
}

test("live preflight reports a safe failing stage without exposing AWS values", () => {
  const { live, desired } = templates();
  const cases = [
    ["stack", state => { state.stack.RoleARN = "private-sentinel"; }],
    ["lambda", state => { state.lambda.State = "private-sentinel"; }],
    ["dns", state => { state.dns.ResourceRecordSets[0].AliasTarget.DNSName = ""; }],
  ];
  for (const [stage, mutate] of cases) {
    const state = runtimeState(structuredClone(live));
    mutate(state);
    assert.throws(() => subject.validateRotationState(desired, state, selected,
      "public-release", "before"), error =>
      error.message === `private_release_live_state_invalid_${stage}`
        && !error.message.includes("private-sentinel"));
  }
});

test("live preflight preserves only the safe template projection stage", () => {
  const { live, desired } = templates();
  desired.Resources.Other.Properties.BucketName = "private-sentinel";
  assert.throws(() => subject.validateRotationState(desired, runtimeState(live), selected,
    "public-release", "before"), error =>
    error.message === "private_release_live_state_invalid_template_projection_static_rotation"
      && !error.message.includes("private-sentinel"));
});

test("live preflight accepts CloudFront's function association key order", () => {
  const { live, desired } = templates();
  const state = runtimeState(live);
  const config = state.distribution.DistributionConfig;
  for (const behavior of [config.DefaultCacheBehavior, ...config.CacheBehaviors.Items]) {
    const item = behavior.FunctionAssociations.Items[0];
    behavior.FunctionAssociations = { Quantity: 1,
      Items: [{ FunctionARN: item.FunctionARN, EventType: "viewer-request" }] };
  }
  assert.doesNotThrow(() => subject.validateRotationState(desired, state, selected,
    "public-release", "before"));
  config.CacheBehaviors.Items[0].FunctionAssociations.Items[0].FunctionARN = "wrong-function";
  assert.throws(() => subject.validateRotationState(desired, state, selected,
    "public-release", "before"), /private_release_live_state_invalid_distribution/);
});

test("live and post state keep identities, DNS, public release and nonstatic distribution", () => {
  const { live, desired } = templates();
  const baseline = subject.validateRotationState(desired, runtimeState(live), selected, "public-release", "before");
  const updated = runtimeState(baseline.candidate, Buffer.from("b".repeat(64), "hex").toString("base64"));
  updated.function.ETag = "viewer-new";
  updated.distribution.ETag = "distribution-new";
  assert.equal(subject.validatePostRotationState(desired, updated, selected,
    "public-release", baseline, "b".repeat(64)).stackId, STACK_ID);
  updated.dns.ResourceRecordSets[0].AliasTarget.DNSName = "other.cloudfront.net.";
  assert.throws(() => subject.validatePostRotationState(desired, updated, selected,
    "public-release", baseline, "b".repeat(64)), /private_release_post_state_invalid/);
});

test("postcheck accepts the exact release with the already deployed locale fence and rejects drift", () => {
  const { live, desired } = templates();
  live.Resources[FUNCTION_ID].Properties.FunctionCode = code([
    ...pageRules.map(rule => JOURNAL_PAGES.includes(rule.path)
      ? { ...rule, allowArticleLocaleQuery: true } : rule), ...assetRules(oldPaths)], NEW_QUERY);
  const baseline = subject.validateRotationState(desired, runtimeState(live), selected, "public-release", "before");
  const updated = runtimeState(baseline.candidate, Buffer.from("b".repeat(64), "hex").toString("base64"));
  updated.function.ETag = "viewer-new";
  updated.distribution.ETag = "distribution-new";
  assert.equal(subject.validatePostRotationState(desired, updated, selected,
    "public-release", baseline, "b".repeat(64)).stackId, STACK_ID);
  const drifted = structuredClone(updated);
  drifted.original.Resources[FUNCTION_ID].Properties.FunctionCode += "\n// changed";
  drifted.processed = structuredClone(drifted.original);
  drifted.functionCode = drifted.original.Resources[FUNCTION_ID].Properties.FunctionCode;
  assert.throws(() => subject.validatePostRotationState(desired, drifted, selected,
    "public-release", baseline, "b".repeat(64)), /private_release_post_state_invalid/);
});

test("alias dependency is admitted only for the existing create-only admin record", () => {
  const resource = { Type: "Custom::ZoolandingFrontendAliasRecords", Properties: {
    Create: '{"action":"changeResourceRecordSets","parameters":{"ChangeBatch":{"Changes":['
      + '{"Action":"CREATE","ResourceRecordSet":{"Name":"admin-test.thehairnarrative.com.","Type":"A"}}]}}}' } };
  const template = { Resources: {
    FrontendAliasUpsertThehairnarrativeAdminTestThehairnarrativeComD6748622: resource,
  } };
  assert.equal(subject.verifyAliasCreateOnly(template), true);
  resource.Properties.Update = resource.Properties.Create;
  assert.throws(() => subject.verifyAliasCreateOnly(template), /private_release_alias_invalid/);
  delete resource.Properties.Update;
  resource.Properties.Create = resource.Properties.Create.replace("CREATE", "UPSERT");
  assert.throws(() => subject.verifyAliasCreateOnly(template), /private_release_alias_invalid/);
});

test("manual TEST workflow separates credential-free validation, review and execute", () => {
  const workflow = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows",
    "deploy-thn-admin-private-release-test.yml"), "utf8").replace(/\r\n/g, "\n");
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /options: \[review, execute, verify\]/);
  assert.match(workflow, /default: review/);
  assert.match(workflow, /expected_review_digest/);
  assert.match(workflow, /validatePinnedAppCoordinates/);
  assert.match(workflow, /--method prepare-change-set/);
  assert.match(workflow, /thn-admin-private-release-rotation\.js/);
  assert.match(workflow, /--app "\$RUNNER_TEMP\/thn-private-projected-cdk\.out"/);
  assert.ok(!workflow.split("\n  validate:\n", 2)[1].split("\n  deploy:\n", 1)[0].includes("id-token: write"));
  assert.ok(workflow.indexOf("Project release into an isolated copy")
    < workflow.indexOf("Prepare exact TEST change set without execution"));
});

test("projects template bytes to a distinct asset key and preserves the sealed assembly", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "thn-template-projection-"));
  try {
    const assemblyRoot = path.join(temporary, "release", "cdk.out", "assembly-ZoolandingTest");
    fs.mkdirSync(assemblyRoot, { recursive: true });
    const stackId = "Frontend";
    const templateFile = `${stackId}.template.json`;
    const original = { Resources: { Function: { Properties: { FunctionCode: "old" } } } };
    const candidate = { Resources: { Function: { Properties: { FunctionCode: "new" } } } };
    const originalBytes = Buffer.from(`${JSON.stringify(original, null, 2)}\n`);
    const hash = bytes => createHash("sha256").update(bytes).digest("hex");
    const originalHash = hash(originalBytes);
    const bucket = "cdk-hnb659fds-assets-765932874577-us-east-1";
    const stack = { type: "aws:cloudformation:stack", properties: {
      stackName: "ZoolandingTest-Zoolandingpage-test-Frontend", templateFile,
      additionalDependencies: [`${stackId}.assets`],
      stackTemplateAssetObjectUrl: `s3://${bucket}/${originalHash}.json`,
    } };
    const manifest = { artifacts: { [stackId]: stack } };
    const assets = { files: { [originalHash]: { source: { path: templateFile, packaging: "file" },
      destinations: { test: { bucketName: bucket, region: "us-east-1", objectKey: `${originalHash}.json` } },
    } } };
    fs.writeFileSync(path.join(assemblyRoot, templateFile), originalBytes);
    fs.writeFileSync(path.join(assemblyRoot, "manifest.json"), JSON.stringify(manifest));
    fs.writeFileSync(path.join(assemblyRoot, `${stackId}.assets.json`), JSON.stringify(assets));
    const artifact = { root: path.join(temporary, "release"), assemblyRoot, assembly: manifest, stack,
      metadata: { run_id: "123", run_attempt: "1", expected_aws_account_id: "765932874577",
        expected_aws_region: "us-east-1" } };
    const destination = path.join(temporary, "projected");
    const result = subject.writeProjectedAssembly(artifact, candidate, destination,
      { RUNNER_TEMP: temporary }, "query-fence");
    const projectedRoot = path.join(destination, "assembly-ZoolandingTest");
    const projectedBytes = fs.readFileSync(path.join(projectedRoot, templateFile));
    const projectedManifest = JSON.parse(fs.readFileSync(path.join(projectedRoot, "manifest.json")));
    const projectedAssets = JSON.parse(fs.readFileSync(path.join(projectedRoot, `${stackId}.assets.json`)));
    const projectedHash = hash(projectedBytes);
    assert.equal(result.projectedTemplateBytesSha256, projectedHash);
    assert.equal(projectedManifest.artifacts[stackId].properties.stackTemplateAssetObjectUrl,
      `s3://${bucket}/${result.projectedTemplateAssetKey}`);
    assert.equal(projectedAssets.files[projectedHash].destinations.test.objectKey,
      result.projectedTemplateAssetKey);
    assert.equal(projectedAssets.files[originalHash], undefined);
    assert.equal(fs.readFileSync(path.join(assemblyRoot, templateFile)).equals(originalBytes), true);
    assert.equal(JSON.parse(fs.readFileSync(path.join(assemblyRoot, "manifest.json"))).artifacts[stackId]
      .properties.stackTemplateAssetObjectUrl, `s3://${bucket}/${originalHash}.json`);
    assert.throws(() => subject.writeProjectedAssembly(artifact, candidate,
      path.join(temporary, "invalid"), { RUNNER_TEMP: temporary }, "other"),
    /private_release_template_invalid/);
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});

test("query fence workflow deploys the projected assembly", () => {
  const workflow = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows",
    "deploy-thn-admin-query-fence-test.yml"), "utf8");
  assert.match(workflow, /thn-admin-query-fence-patch\.js \\\s*project \.transport\/\.release/);
  assert.match(workflow, /--app "\$RUNNER_TEMP\/thn-query-fence-projected-cdk\.out"/);
  assert.ok(workflow.indexOf("Project template under an isolated content key")
    < workflow.indexOf("Prepare exact TEST change set without execution"));
});
