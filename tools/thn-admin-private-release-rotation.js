"use strict";

const { createHash } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const adminRelease = require("./thn-admin-release");
const queryFence = require("./thn-admin-query-fence-patch");
const changeSetReviewer = require("./review-test-infra-change-set");
const { loadArtifact, createRoleClient, validChangeSetArn } = require("./infra-test-aws");

const FUNCTION_ID = "FrontendViewerHostHeaderFunctionThehairnarrativeAdminTestD75B90C2";
const DISTRIBUTION_ID = "FrontendDistributionThehairnarrativeAdminTest5B029562";
const SSR_ID = "FrontendThnAdminSsrFunction874373CC";
const ALIAS_ID = "FrontendAliasUpsertThehairnarrativeAdminTestThehairnarrativeComD6748622";
const STACK = "ZoolandingTest-Zoolandingpage-test-Frontend";
const HOST = "admin-test.thehairnarrative.com";
const PINNED_APP = Object.freeze({ artifactId: "10939780047",
  sourceSha: "4f45ffc615d3864a167fdccd87535e244ef01971", runId: "36342080059", runAttempt: "1",
  deliverySha256: "cbdceb0c07ae525329a22db6456662465ad32e68bc1944d3de57778fc3f4d227",
  manifestSha256: "dab06e876322601c2a578233d106a19aa4524fbfa5afc88a76021b507d1d86d0" });
const RULE_LINE = /^  var rules = (\[[^\n]*\]);$/gm;
const fail = () => { throw new Error("private_release_template_invalid"); };
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const digest = value => createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
const sha256 = value => createHash("sha256").update(value).digest("hex");

function validateAppCoordinates(selection, coordinates) {
  try {
    const metadata = adminRelease.validateSelection(selection).metadata;
    if (!coordinates || !same(Object.keys(coordinates).sort(),
      ["artifactId", "sourceSha", "runId", "runAttempt", "deliverySha256", "manifestSha256"].sort())
      || !/^[1-9][0-9]*$/.test(coordinates.artifactId)
      || coordinates.sourceSha !== metadata.sourceCommit || coordinates.runId !== metadata.runId
      || coordinates.runAttempt !== metadata.runAttempt
      || coordinates.deliverySha256 !== metadata.deliverySha256
      || coordinates.manifestSha256 !== metadata.manifestSha256) throw new Error();
    return coordinates;
  } catch { throw new Error("private_release_coordinates_invalid"); }
}

function validatePinnedAppCoordinates(selection, coordinates) {
  validateAppCoordinates(selection, coordinates);
  if (!same(stable(coordinates), stable(PINNED_APP))) throw new Error("private_release_coordinates_invalid");
  return coordinates;
}

function rulesFrom(code) {
  if (typeof code !== "string") fail();
  const matches = [...code.matchAll(RULE_LINE)];
  if (matches.length !== 1) fail();
  let rules;
  try { rules = JSON.parse(matches[0][1]); } catch { fail(); }
  if (!Array.isArray(rules)) fail();
  return { rules, line: matches[0][0] };
}

function projectPrivateReleaseTemplate(desired, live, selection) {
  let stage = "selection";
  try {
    const selected = adminRelease.validateSelection(selection);
    stage = "ssr_coordinates";
    const oldSsr = live?.Resources?.[SSR_ID];
    const newSsr = desired?.Resources?.[SSR_ID];
    if (oldSsr?.Type !== "AWS::Lambda::Function" || newSsr?.Type !== oldSsr.Type) fail();
    const oldCode = oldSsr.Properties?.Code;
    const newCode = newSsr.Properties?.Code;
    const oldReleaseId = oldSsr.Properties?.Environment?.Variables?.ZLP_RELEASE_ID;
    const newReleaseId = newSsr.Properties?.Environment?.Variables?.ZLP_RELEASE_ID;
    if (typeof oldCode?.S3Key !== "string" || typeof oldReleaseId !== "string"
      || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(oldReleaseId) || oldReleaseId.includes("..")
      || oldCode.S3Key !== `frontend/angular-ssr/test/releases/${oldReleaseId}/server/ssr-handler.zip`
      || newCode?.S3Key !== `${selected.originPrefix}/server/ssr-handler.zip`
      || newReleaseId !== selected.metadata.releaseId || oldCode.S3Key === newCode.S3Key
      || oldReleaseId === newReleaseId) fail();
    const normalizedSsr = structuredClone(newSsr);
    normalizedSsr.Properties.Code.S3Key = oldCode.S3Key;
    normalizedSsr.Properties.Environment.Variables.ZLP_RELEASE_ID = oldReleaseId;
    stage = "ssr_scope";
    if (!same(stable(normalizedSsr), stable(oldSsr))) fail();

    stage = "viewer_rules";
    const oldViewerCode = live?.Resources?.[FUNCTION_ID]?.Properties?.FunctionCode;
    const newViewerCode = desired?.Resources?.[FUNCTION_ID]?.Properties?.FunctionCode;
    const oldViewer = rulesFrom(oldViewerCode);
    const newViewer = rulesFrom(newViewerCode);
    const isAsset = rule => adminRelease.isHashedStaticAssetPath(rule?.path);
    const oldNonAssets = oldViewer.rules.filter(rule => !isAsset(rule));
    const newNonAssets = newViewer.rules.filter(rule => !isAsset(rule));
    const oldAssets = oldViewer.rules.filter(isAsset);
    const newAssets = newViewer.rules.filter(isAsset);
    if (oldAssets.length === 0 || newAssets.length !== selected.manifest.staticAssetPaths.length
      || !same(newAssets.map(rule => rule.path), selected.manifest.staticAssetPaths)
      || !same(oldNonAssets.map(rule => rule.path), newNonAssets.map(rule => rule.path))) fail();

    let nonAssetIndex = 0;
    const candidateRules = newViewer.rules.map(rule => isAsset(rule)
      ? rule : oldNonAssets[nonAssetIndex++]);
    if (nonAssetIndex !== oldNonAssets.length) fail();
    const candidate = structuredClone(desired);
    candidate.Resources[FUNCTION_ID].Properties.FunctionCode = oldViewerCode.replace(oldViewer.line,
      `  var rules = ${JSON.stringify(candidateRules)};`);

    nonAssetIndex = 0;
    const queryRules = oldViewer.rules.map(rule => isAsset(rule)
      ? rule : newNonAssets[nonAssetIndex++]);
    if (nonAssetIndex !== newNonAssets.length) fail();
    const queryOnly = structuredClone(live);
    queryOnly.Resources[FUNCTION_ID].Properties.FunctionCode = newViewerCode.replace(newViewer.line,
      `  var rules = ${JSON.stringify(queryRules)};`);
    stage = "query_policy";
    queryFence.verifyExactQueryFenceDiff(queryOnly, live);

    stage = "static_rotation";
    const staticOnly = structuredClone(candidate);
    staticOnly.Resources[SSR_ID] = structuredClone(oldSsr);
    if (!adminRelease.verifyExactAdminStaticRotationDiff(staticOnly, live, selected)) fail();
    const candidateCode = candidate.Resources[FUNCTION_ID].Properties.FunctionCode;
    const candidateBehaviors = candidate.Resources[DISTRIBUTION_ID].Properties.DistributionConfig.CacheBehaviors;
    stage = "quotas";
    if (Buffer.byteLength(candidateCode, "utf8") > 10240 || candidateBehaviors.length + 1 > 75) fail();
    return candidate;
  } catch {
    const error = new Error(`private_release_template_invalid_${stage}`);
    error.projectionStage = stage;
    throw error;
  }
}

function reviewPrivateReleaseChangeSet(detailed, summary, options) {
  try {
    if (!detailed || !summary || !options || options.aliasCreateOnly !== true
      || options.dnsUnchanged !== true || !Array.isArray(options.expectedParameters)
      || !same(stable(parameterMap(detailed.Parameters)), stable(parameterMap(options.expectedParameters)))
      || !same(stable(parameterMap(summary.Parameters)), stable(parameterMap(options.expectedParameters)))) fail();
    const withoutLambda = description => {
      if (!Array.isArray(description.Changes)) fail();
      const lambda = description.Changes.filter(change => change?.ResourceChange?.LogicalResourceId === SSR_ID);
      if (lambda.length !== 1) fail();
      const resource = lambda[0].ResourceChange;
      if (lambda[0].Type !== "Resource" || resource.ResourceType !== "AWS::Lambda::Function"
        || resource.Action !== "Modify" || resource.Replacement !== "False"
        || !same(resource.Scope, ["Properties"]) || !Array.isArray(resource.Details)
        || resource.Details.length !== 2) fail();
      const names = resource.Details.map(detail => {
        const target = detail?.Target;
        if (detail.Evaluation !== "Static" || detail.ChangeSource !== "DirectModification"
          || detail.CausingEntity != null || target?.Attribute !== "Properties"
          || target.RequiresRecreation !== "Never" || !["Code", "Environment"].includes(target.Name)
          || (target.Path != null && target.Path !== `/Properties/${target.Name}`)) fail();
        return target.Name;
      });
      if (!same(names.sort(), ["Code", "Environment"])) fail();
      return { ...description, Changes: description.Changes.filter(change => change !== lambda[0]) };
    };
    const staticDetailed = withoutLambda(detailed);
    const staticSummary = withoutLambda(summary);
    return changeSetReviewer.reviewCompleteChangeSet(staticDetailed, staticSummary,
      { ...options, adminStaticRotationProof: true, adminOriginOnlyProof: false });
  } catch (cause) {
    const error = new Error("private_release_change_set_invalid");
    error.changeInventory = { detailed: safeChangeInventory(detailed), summary: safeChangeInventory(summary) };
    if (/^[a-z_]{3,80}$/.test(cause?.message || "")) error.reviewReason = cause.message;
    throw error;
  }
}

function parameterMap(parameters) {
  if (!Array.isArray(parameters)) fail();
  const entries = parameters.map(item => [item?.ParameterKey, item?.ParameterValue]);
  if (entries.some(([key, value]) => typeof key !== "string" || !key || typeof value !== "string")
    || new Set(entries.map(([key]) => key)).size !== entries.length) fail();
  return Object.fromEntries(entries);
}

function safeChangeInventory(description) {
  const safe = value => typeof value === "string" && /^[A-Za-z0-9:_-]{1,255}$/.test(value) ? value : "invalid";
  return Array.isArray(description?.Changes) ? description.Changes.slice(0, 100).map(item => ({
    logicalId: safe(item?.ResourceChange?.LogicalResourceId),
    type: safe(item?.ResourceChange?.ResourceType),
    action: safe(item?.ResourceChange?.Action),
    replacement: safe(item?.ResourceChange?.Replacement),
    properties: Array.isArray(item?.ResourceChange?.Details)
      ? item.ResourceChange.Details.slice(0, 20).map(detail => safe(detail?.Target?.Name)) : [],
  })) : [];
}

function changeSetEvidenceDigest(detailed, summary) {
  if (!detailed || !summary || !Array.isArray(detailed.Changes) || !Array.isArray(summary.Changes)) fail();
  return digest({ detailed: detailed.Changes, summary: summary.Changes,
    parameters: detailed.Parameters, summaryParameters: summary.Parameters });
}

function loadSelection(artifact, env = process.env) {
  try {
    const file = path.join(artifact.root, "thn-admin-selection.json");
    const bytes = fs.readFileSync(file);
    const selected = JSON.parse(bytes);
    if (!bytes.equals(Buffer.from(`${JSON.stringify(selected, null, 2)}\n`))
      || !same(selected, adminRelease.selectThnAdminRelease(env))) fail();
    const coordinates = JSON.parse(env.EXPECTED_APP_COORDINATES_JSON);
    validatePinnedAppCoordinates(selected, coordinates);
    if (artifact.metadata.thn_admin_origin_enabled !== "true"
      || artifact.metadata.thn_admin_route53_enabled !== "true"
      || artifact.metadata.source_sha !== env.GITHUB_SHA
      || artifact.metadata.frontend_release_id !== env.FRONTEND_TEST_RELEASE_ID) fail();
    return selected;
  } catch { throw new Error("private_release_selection_invalid"); }
}

function templateFromArtifact(artifact) {
  try {
    return JSON.parse(fs.readFileSync(path.join(artifact.assemblyRoot,
      artifact.stack.properties.templateFile), "utf8"));
  } catch { throw new Error("private_release_assembly_invalid"); }
}

function collectRotationState(artifact, desired, env = process.env) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "thn-private-release-"));
  const outputPath = path.join(folder, "viewer.js");
  try {
    const functionName = desired?.Resources?.[FUNCTION_ID]?.Properties?.Name;
    const lambdaName = desired?.Resources?.[SSR_ID]?.Properties?.FunctionName;
    const zoneId = env.FRONTEND_TEST_THN_ADMIN_HOSTED_ZONE_ID;
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(functionName)
      || !/^[A-Za-z0-9_-]{1,64}$/.test(lambdaName)) fail();
    const options = { queryFence: { functionName, outputPath },
      privateRotation: { lambdaName, hostedZoneId: zoneId } };
    const read = createRoleClient(artifact.root, "lookup", options);
    const state = queryFence.collectLiveState(desired, read, outputPath);
    state.lambda = JSON.parse(read(["lambda", "get-function-configuration", "--function-name", lambdaName, "--output", "json"]));
    state.dns = JSON.parse(read(["route53", "list-resource-record-sets", "--hosted-zone-id", zoneId,
      "--start-record-name", `${HOST}.`, "--start-record-type", "A", "--max-items", "2",
      "--no-paginate", "--output", "json"]));
    return state;
  } finally {
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    fs.rmdirSync(folder);
  }
}

function validateRotationState(desired, state, selection, publicRelease, mode, expectedCandidate) {
  let stage = "selection";
  try {
    const selected = adminRelease.validateSelection(selection);
    stage = "template_identity";
    if (!same(stable(state?.original), stable(state?.processed))) fail();
    stage = "template_projection";
    const candidate = mode === "before"
      ? projectPrivateReleaseTemplate(desired, state.original, selected)
      : (queryFence.verifyExactQueryFenceDiff(desired, state.original), state.original);
    stage = "candidate_identity";
    if (expectedCandidate && !same(stable(candidate), stable(expectedCandidate))) fail();
    stage = "stack";
    const stack = state.stack;
    if (stack?.StackName !== STACK || !new RegExp(`^arn:aws:cloudformation:us-east-1:765932874577:stack/${STACK}/[A-Za-z0-9-]+$`).test(stack.StackId)
      || stack.StackStatus !== "UPDATE_COMPLETE" || stack.EnableTerminationProtection !== false
      || stack.RoleARN !== "arn:aws:iam::765932874577:role/cdk-hnb659fds-cfn-exec-role-765932874577-us-east-1"
      || !Array.isArray(stack.Parameters) || !Array.isArray(stack.Outputs)
      || stack.Outputs.filter(item => item.OutputKey === "FrontendReleaseId").length !== 1
      || stack.Outputs.find(item => item.OutputKey === "FrontendReleaseId").OutputValue !== publicRelease) fail();
    stage = "resource_inventory";
    const resources = state.resources;
    if (!Array.isArray(resources) || resources.length !== Object.keys(state.original.Resources || {}).length
      || new Set(resources.map(item => item.LogicalResourceId)).size !== resources.length
      || resources.some(item => item.ResourceType !== state.original.Resources[item.LogicalResourceId]?.Type
        || !["CREATE_COMPLETE", "UPDATE_COMPLETE"].includes(item.ResourceStatus))) fail();
    const resource = id => resources.find(item => item.LogicalResourceId === id);
    const viewer = state.function;
    const viewerName = state.original.Resources[FUNCTION_ID].Properties.Name;
    const viewerArn = `arn:aws:cloudfront::765932874577:function/${viewerName}`;
    stage = "viewer";
    if (resource(FUNCTION_ID)?.PhysicalResourceId !== viewerArn
      || viewer?.FunctionSummary?.Name !== viewerName || viewer.FunctionSummary.Status !== "DEPLOYED"
      || viewer.FunctionSummary.FunctionMetadata?.FunctionARN !== viewerArn
      || !viewer.ETag || state.functionCode !== state.original.Resources[FUNCTION_ID].Properties.FunctionCode) fail();
    const lambda = state.lambda;
    const expectedLambda = state.original.Resources[SSR_ID].Properties;
    stage = "lambda";
    if (resource(SSR_ID)?.PhysicalResourceId !== expectedLambda.FunctionName
      || lambda?.FunctionName !== expectedLambda.FunctionName
      || lambda.FunctionArn !== `arn:aws:lambda:us-east-1:765932874577:function:${expectedLambda.FunctionName}`
      || lambda.State !== "Active" || lambda.LastUpdateStatus !== "Successful"
      || !/^[A-Za-z0-9+/]{43}=$/.test(lambda.CodeSha256)
      || !same(stable(lambda.Environment?.Variables), stable(expectedLambda.Environment?.Variables))) fail();
    const config = state.distribution?.DistributionConfig;
    const distributionId = resource(DISTRIBUTION_ID)?.PhysicalResourceId;
    stage = "distribution";
    if (!/^[A-Z0-9]+$/.test(distributionId || "") || !state.distribution.ETag
      || !same(config?.Aliases, { Quantity: 1, Items: [HOST] })) fail();
    const behaviors = [config.DefaultCacheBehavior, ...(config.CacheBehaviors?.Items || [])];
    if (config.CacheBehaviors?.Quantity !== (config.CacheBehaviors?.Items || []).length
      || behaviors.some(item => !same(item?.FunctionAssociations,
        { Quantity: 1, Items: [{ EventType: "viewer-request", FunctionARN: viewerArn }] }))) fail();
    const staticOrigin = state.original.Resources[DISTRIBUTION_ID].Properties.DistributionConfig.Origins
      .find(item => item.OriginPath?.startsWith("/frontend/angular-ssr/test/releases/"));
    const origin = config.Origins?.Items?.find(item => item.Id === staticOrigin?.Id);
    const expectedStatic = state.original.Resources[DISTRIBUTION_ID].Properties.DistributionConfig.CacheBehaviors
      .filter(item => adminRelease.isHashedStaticAssetPath(`/${item.PathPattern}`)).map(item => item.PathPattern);
    const actualStatic = (config.CacheBehaviors?.Items || []).filter(item =>
      adminRelease.isHashedStaticAssetPath(`/${item.PathPattern}`)).map(item => item.PathPattern);
    stage = "static_origin";
    if (!origin || origin.OriginPath !== staticOrigin.OriginPath || !same(actualStatic, expectedStatic)) fail();
    stage = "dns";
    const records = state.dns?.ResourceRecordSets;
    if (!Array.isArray(records) || records.length !== 2
      || !same(records.map(item => [item.Name, item.Type]), [[`${HOST}.`, "A"], [`${HOST}.`, "AAAA"]])
      || records.some(item => !item.AliasTarget?.DNSName || !item.AliasTarget.HostedZoneId
        || item.AliasTarget.EvaluateTargetHealth !== false)
      || !same(records[0].AliasTarget, records[1].AliasTarget)) fail();
    return { stackId: stack.StackId, templateSha256: digest(state.original), candidateSha256: digest(candidate),
      candidate, resources: structuredClone(resources), parameters: structuredClone(stack.Parameters),
      viewerEtag: viewer.ETag, lambdaCodeSha256: lambda.CodeSha256,
      distributionId, distributionConfig: structuredClone(config), distributionEtag: state.distribution.ETag,
      dns: structuredClone(records), publicRelease };
  } catch (cause) {
    const projectionStage = stage === "template_projection" && ["selection", "ssr_coordinates", "ssr_scope",
      "viewer_rules", "query_policy", "static_rotation", "quotas"].includes(cause?.projectionStage)
      ? `_${cause.projectionStage}` : "";
    throw new Error(`private_release_live_state_invalid_${stage}${projectionStage}`);
  }
}

function validatePostRotationState(desired, state, selection, publicRelease, baseline, expectedCodeSha256) {
  try {
    const result = validateRotationState(desired, state, selection, publicRelease, "after", baseline.candidate);
    const before = new Map(baseline.resources.map(item => [item.LogicalResourceId, item]));
    if (result.stackId !== baseline.stackId || !same(result.parameters, baseline.parameters)
      || !same(result.dns, baseline.dns) || result.viewerEtag === baseline.viewerEtag
      || result.lambdaCodeSha256 === baseline.lambdaCodeSha256
      || result.lambdaCodeSha256 !== Buffer.from(expectedCodeSha256, "hex").toString("base64")
      || result.distributionEtag === baseline.distributionEtag
      || result.resources.some(item => {
        const old = before.get(item.LogicalResourceId);
        if (!old || old.PhysicalResourceId !== item.PhysicalResourceId || old.ResourceType !== item.ResourceType) return true;
        const normalized = structuredClone(item), previous = structuredClone(old);
        for (const key of ["LastUpdatedTimestamp", "ResourceStatus", "ResourceStatusReason"]) {
          delete normalized[key]; delete previous[key];
        }
        return !same(stable(normalized), stable(previous));
      })) fail();
    const normalizedConfig = structuredClone(result.distributionConfig);
    const oldConfig = structuredClone(baseline.distributionConfig);
    const isAsset = item => adminRelease.isHashedStaticAssetPath(`/${item?.PathPattern}`);
    for (const config of [normalizedConfig, oldConfig]) {
      config.CacheBehaviors.Items = config.CacheBehaviors.Items.filter(item => !isAsset(item));
      const staticOrigin = config.Origins.Items.find(item => item.OriginPath?.startsWith("/frontend/angular-ssr/test/releases/"));
      if (!staticOrigin) fail();
      staticOrigin.OriginPath = "__private_release__";
    }
    if (!same(stable(normalizedConfig), stable(oldConfig))) fail();
    return result;
  } catch { throw new Error("private_release_post_state_invalid"); }
}

function verifyAliasCreateOnly(template) {
  const alias = template?.Resources?.[ALIAS_ID];
  const properties = alias?.Properties;
  const payload = JSON.stringify(properties);
  if (alias?.Type !== "Custom::ZoolandingFrontendAliasRecords" || !properties
    || Object.hasOwn(properties, "Update") || !payload.includes("admin-test.thehairnarrative.com.")
    || !payload.includes('\\"Action\\":\\"CREATE\\"')
    || payload.includes('\\"Action\\":\\"UPSERT\\"')) throw new Error("private_release_alias_invalid");
  return true;
}

async function verifyPublished(artifact, selection) {
  const selected = adminRelease.validateSelection(selection);
  const read = createRoleClient(artifact.root, "lookup");
  const stacks = JSON.parse(read(["cloudformation", "describe-stacks", "--stack-name", STACK, "--output", "json"])).Stacks;
  const outputs = stacks?.length === 1 ? stacks[0].Outputs || [] : [];
  const bucket = outputs.filter(item => item.OutputKey === "FrontendArtifactBucketName");
  const expectedBucket = "zoolandingpage-test-frontend-artifacts-765932874577";
  if (bucket.length !== 1 || bucket[0].OutputValue !== expectedBucket) fail();
  const objects = new Map();
  await adminRelease.verifyPublishedAdminRelease(selected, async key => {
    const bytes = read(["s3", "cp", `s3://${expectedBucket}/${key}`, "-", "--only-show-errors"]);
    objects.set(path.posix.basename(key), bytes);
    return bytes;
  });
  const delivery = JSON.parse(objects.get("delivery.json"));
  const zip = delivery.files.find(item => item.path === "ssr-handler.zip");
  if (!zip || !/^[a-f0-9]{64}$/.test(zip.sha256)) fail();
  return zip.sha256;
}

function verifyCertificate(artifact, desired, live) {
  const readTemplate = file => JSON.parse(fs.readFileSync(path.join(artifact.assemblyRoot, file), "utf8"));
  const selectedArn = adminRelease.adminCertificateFromAssembly(artifact.assembly, readTemplate);
  const read = createRoleClient(artifact.root, "lookup");
  const detail = JSON.parse(read(["cloudformation", "describe-stack-resource", "--stack-name", STACK,
    "--logical-resource-id", "ThnAdminTestCertificate", "--output", "json"])).StackResourceDetail;
  const arn = adminRelease.verifyCertificatePreservation(desired, live, artifact.metadata, detail, selectedArn);
  adminRelease.verifyAdminCertificate(JSON.parse(read(["acm", "describe-certificate", "--certificate-arn", arn,
    "--output", "json"])), { arn, arnSha256: artifact.metadata.thn_admin_certificate_sha256,
    accountId: "765932874577" });
  return sha256(arn);
}

async function readPreflight(artifact, desired, selection, mode, expectedCandidate) {
  const state = collectRotationState(artifact, desired);
  const snapshot = validateRotationState(desired, state, selection,
    artifact.metadata.frontend_release_id, mode, expectedCandidate);
  verifyAliasCreateOnly(state.original);
  verifyAliasCreateOnly(snapshot.candidate);
  snapshot.certificateSha256 = verifyCertificate(artifact, snapshot.candidate, state.original);
  snapshot.serverZipSha256 = await verifyPublished(artifact, selection);
  if (mode === "after" && state.lambda.CodeSha256 !== Buffer.from(snapshot.serverZipSha256, "hex").toString("base64"))
    throw new Error("private_release_lambda_code_invalid");
  return snapshot;
}

function readChangeSet(artifact, candidate, arn) {
  const read = createRoleClient(artifact.root, "lookup", { queryFence: {
    functionName: candidate.Resources[FUNCTION_ID].Properties.Name,
    outputPath: path.join(os.tmpdir(), "thn-private-release-unused.js"), changeSetArn: arn } });
  const request = ["cloudformation", "describe-change-set", "--stack-name", STACK,
    "--change-set-name", arn, "--no-paginate"];
  const detailed = JSON.parse(read([...request, "--include-property-values", "--output", "json"]));
  const summary = JSON.parse(read([...request, "--output", "json"]));
  for (const stage of ["Original", "Processed"]) {
    const response = JSON.parse(read(["cloudformation", "get-template", "--stack-name", STACK,
      "--change-set-name", arn, "--template-stage", stage, "--output", "json"]));
    const template = typeof response.TemplateBody === "string" ? JSON.parse(response.TemplateBody) : response.TemplateBody;
    if (!same(stable(template), stable(candidate))) throw new Error("private_release_change_set_template_invalid");
  }
  return [detailed, summary];
}

function writeProjectedAssembly(artifact, candidate, destination, env = process.env) {
  const source = path.join(artifact.root, "cdk.out");
  const resolved = path.resolve(destination);
  const temporary = path.resolve(env.RUNNER_TEMP || "");
  if (!env.RUNNER_TEMP || path.dirname(resolved) !== temporary || fs.existsSync(resolved))
    throw new Error("private_release_projection_path_invalid");
  const relative = path.relative(source, path.join(artifact.assemblyRoot, artifact.stack.properties.templateFile));
  if (relative.startsWith("..") || path.isAbsolute(relative)) fail();
  fs.cpSync(source, resolved, { recursive: true, force: false, errorOnExist: true });
  const target = path.join(resolved, relative);
  fs.writeFileSync(target, `${JSON.stringify(candidate, null, 2)}\n`);
  if (!same(stable(JSON.parse(fs.readFileSync(target, "utf8"))), stable(candidate))) fail();
  return { projectedTemplateSha256: digest(candidate), projectedAssembly: resolved,
    projectedTemplate: target };
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const [mode, root, third] = argv;
  const count = mode === "project" || mode === "review" || mode === "execute" ? 3 : 2;
  if (!["project", "review", "execute", "verify"].includes(mode) || argv.length !== count)
    throw new Error("private_release_arguments_invalid");
  const artifact = loadArtifact(root, env);
  const selection = loadSelection(artifact, env);
  adminRelease.verifyAdminAssemblyQuotas(artifact.assembly, file =>
    JSON.parse(fs.readFileSync(path.join(artifact.assemblyRoot, file), "utf8")));
  const desired = templateFromArtifact(artifact);
  if (mode === "verify") {
    const first = await readPreflight(artifact, desired, selection, "after");
    const second = await readPreflight(artifact, desired, selection, "after");
    if (!same(stable(first), stable(second))) throw new Error("private_release_verify_drift");
    return { decision: "verified-no-execution", template_sha256: second.templateSha256,
      lambda_code_sha256: second.lambdaCodeSha256 };
  }
  if (mode === "project") {
    const first = await readPreflight(artifact, desired, selection, "before");
    const second = await readPreflight(artifact, desired, selection, "before");
    if (!same(stable(first), stable(second))) throw new Error("private_release_preflight_drift");
    return { decision: "projected-no-execution",
      ...writeProjectedAssembly(artifact, second.candidate, third, env) };
  }
  const name = third;
  if (!/^release-[1-9][0-9]*-[1-9][0-9]*$/.test(name)
    || name !== `release-${artifact.metadata.run_id}-${artifact.metadata.run_attempt}`)
    throw new Error("private_release_change_set_name_invalid");
  const lookup = createRoleClient(artifact.root, "lookup");
  const initial = JSON.parse(lookup(["cloudformation", "describe-change-set", "--stack-name", STACK,
    "--change-set-name", name, "--no-paginate", "--output", "json"]));
  const arn = initial.ChangeSetId;
  if (!validChangeSetArn(arn, "765932874577", name) || initial.StackName !== STACK
    || !new RegExp(`^arn:aws:cloudformation:us-east-1:765932874577:stack/${STACK}/[A-Za-z0-9-]+$`).test(initial.StackId)
    || initial.ChangeSetName !== name)
    throw new Error("private_release_change_set_identity_invalid");
  const roleOptions = { queryFence: { changeSetArn: arn,
    functionName: desired.Resources[FUNCTION_ID].Properties.Name,
    outputPath: path.join(os.tmpdir(), "thn-private-release-unused.js") } };
  const deploy = createRoleClient(artifact.root, "deploy", roleOptions);
  const expectedReviewDigest = mode === "execute" ? env.EXPECTED_REVIEW_DIGEST : undefined;
  let handedToGuard = false;
  try {
    const first = await readPreflight(artifact, desired, selection, "before");
    const second = await readPreflight(artifact, desired, selection, "before");
    if (!same(stable(first), stable(second))) throw new Error("private_release_preflight_drift");
    if (initial.StackId !== second.stackId) throw new Error("private_release_change_set_identity_invalid");
    const projected = JSON.parse(fs.readFileSync(env.PROJECTED_FRONTEND_TEMPLATE, "utf8"));
    if (!same(stable(projected), stable(second.candidate))) throw new Error("private_release_projection_changed");
    const operations = {
      expectedReviewDigest,
      context: { expectedStackName: STACK, expectedChangeSetName: name, expectedChangeSetArn: arn,
        expectedChangeSetType: "UPDATE", expectedAccountId: "765932874577", expectedRegion: "us-east-1",
        adminInfrastructureApproved: true, adminRouteAssociationApproved: true,
        aliasCreateOnly: true, dnsUnchanged: true, expectedParameters: second.parameters },
      preflight: async () => {
        const current = await readPreflight(artifact, desired, selection, "before", second.candidate);
        if (!same(stable(current.candidate), stable(projected))) throw new Error("private_release_projection_changed");
        return current;
      },
      describe: async () => readChangeSet(artifact, second.candidate, arn),
      cleanup: async () => deploy(["cloudformation", "delete-change-set", "--stack-name", STACK, "--change-set-name", arn]),
      execute: async () => deploy(["cloudformation", "execute-change-set", "--stack-name", STACK, "--change-set-name", arn]),
      wait: async () => deploy(["cloudformation", "wait", "stack-update-complete", "--stack-name", STACK]),
      postcheck: async baseline => {
        const read = createRoleClient(artifact.root, "lookup");
        read(["cloudfront", "wait", "distribution-deployed", "--id", baseline.distributionId]);
        const state = collectRotationState(artifact, desired);
        const result = validatePostRotationState(desired, state, selection,
          artifact.metadata.frontend_release_id, baseline, baseline.serverZipSha256);
        verifyCertificate(artifact, result.candidate, state.original);
        await verifyPublished(artifact, selection);
      },
    };
    handedToGuard = true;
    const result = await runGuardedRotation(mode, operations);
    return { ...result, change_set_arn: arn, projected_template_sha256: second.candidateSha256,
      app_artifact_id: JSON.parse(env.EXPECTED_APP_COORDINATES_JSON).artifactId };
  } catch (error) {
    if (!handedToGuard) {
      try { deploy(["cloudformation", "delete-change-set", "--stack-name", STACK, "--change-set-name", arn]); }
      catch { throw new Error("private_release_cleanup_failed"); }
    }
    throw error;
  }
}

async function runGuardedRotation(mode, operations) {
  if (!["review", "execute"].includes(mode)) throw new Error("private_release_mode_invalid");
  let executionAttempted = false;
  try {
    const baseline = await operations.preflight();
    const first = await operations.describe();
    reviewPrivateReleaseChangeSet(...first, operations.context);
    const second = await operations.describe();
    reviewPrivateReleaseChangeSet(...second, operations.context);
    if (!same(stable(first), stable(second))) throw new Error("private_release_change_set_changed");
    const reviewedDigest = changeSetEvidenceDigest(...first);
    const inventory = { detailed: safeChangeInventory(first[0]), summary: safeChangeInventory(first[1]) };
    if (mode === "review") return { decision: "reviewed-no-execution", reviewedDigest, inventory };
    if (!/^[a-f0-9]{64}$/.test(operations.expectedReviewDigest)
      || reviewedDigest !== operations.expectedReviewDigest)
      throw new Error("private_release_review_digest_changed");
    const repeated = await operations.preflight();
    if (!same(stable(repeated), stable(baseline))) throw new Error("private_release_pre_execute_drift");
    const final = await operations.describe();
    reviewPrivateReleaseChangeSet(...final, operations.context);
    if (!same(stable(first), stable(final))) throw new Error("private_release_change_set_changed");
    executionAttempted = true;
    await operations.execute();
    await operations.wait();
    await operations.postcheck(baseline);
    await operations.postcheck(baseline);
    return { decision: "executed", reviewedDigest, inventory };
  } finally {
    if (!executionAttempted) await operations.cleanup();
  }
}

module.exports = { validateAppCoordinates, validatePinnedAppCoordinates, projectPrivateReleaseTemplate,
  reviewPrivateReleaseChangeSet, runGuardedRotation,
  changeSetEvidenceDigest, validateRotationState, validatePostRotationState, verifyAliasCreateOnly,
  loadSelection, templateFromArtifact, collectRotationState, readChangeSet, writeProjectedAssembly, main,
  FUNCTION_ID, DISTRIBUTION_ID, SSR_ID };

if (require.main === module) {
  main().then(value => { process.stdout.write(`${JSON.stringify(value)}\n`); })
    .catch(error => {
      const safeCode = /^private_release_[a-z_]+$/.test(error?.message)
        ? error.message : "private_release_operation_failed";
      process.stderr.write(`${JSON.stringify({ error: safeCode,
        ...(safeCode === "private_release_operation_failed"
          && /^(thn_admin|test_infra|query_fence)_[a-z_]+$/.test(error?.message || "")
          ? { cause_code: error.message } : {}),
        ...(safeCode === "private_release_change_set_invalid"
          ? { review_reason: error.reviewReason, change_inventory: error.changeInventory } : {}) })}\n`);
      process.exitCode = 1;
    });
}
