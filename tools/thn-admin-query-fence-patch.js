"use strict";
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { loadArtifact, createRoleClient, readPrivateLambdaConfiguration,
  validChangeSetArn } = require("./infra-test-aws");

const FUNCTION_ID = "FrontendViewerHostHeaderFunctionThehairnarrativeAdminTestD75B90C2";
const DISTRIBUTION_ID = "FrontendDistributionThehairnarrativeAdminTest5B029562";
const SSR_ID = "FrontendThnAdminSsrFunction874373CC";
const JOURNAL_PAGES = new Set(["/admin/journal", "/admin/journal/new",
  "/admin/journal/:articleId/edit", "/admin/journal/:articleId/preview"]);
// The deployed pre-patch handler accepts zero or one lang key. Match the whole
// historical body so a different live query policy cannot be treated as this patch.
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
const RULE_LINE = /^  var rules = (\[[^\n]*\]);$/gm;
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const same = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));
const digest = value => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(stable(value))).digest("hex");
const fail = code => { throw new Error(code); };

function verifyExactQueryFenceDiff(desired, live) {
  const reject = diffReason => {
    const error = new Error("query_fence_diff_invalid");
    error.diffReason = diffReason;
    throw error;
  };
  const before = live?.Resources?.[FUNCTION_ID];
  const after = desired?.Resources?.[FUNCTION_ID];
  if (before?.Type !== "AWS::CloudFront::Function" || after?.Type !== before.Type) reject("function_type");
  const beforeCode = before.Properties?.FunctionCode;
  const afterCode = after.Properties?.FunctionCode;
  if (typeof beforeCode !== "string" || typeof afterCode !== "string") reject("code_type");
  if (beforeCode === afterCode) reject("code_unchanged");
  if (beforeCode.includes("articleLocale")) reject("prepatch_contains_article_locale");
  if (!afterCode.includes(NEW_QUERY) || afterCode.split(NEW_QUERY).length !== 2) reject("new_query_shape");
  if (beforeCode.split(OLD_QUERY).length !== 2) reject("old_query_shape");
  const parse = code => {
    const matches = [...code.matchAll(RULE_LINE)];
    if (matches.length !== 1) reject("rules_line_shape");
    let rules;
    try { rules = JSON.parse(matches[0][1]); } catch { reject("rules_json"); }
    if (!Array.isArray(rules)) reject("rules_type");
    return { rules, line: matches[0][0] };
  };
  const old = parse(beforeCode), next = parse(afterCode);
  if (old.rules.length !== next.rules.length) reject("rules_count");
  const seen = new Set();
  const restoredRules = next.rules.map((rule, index) => {
    if (!rule || typeof rule !== "object" || Array.isArray(rule)
      || !same(rule.path, old.rules[index]?.path)) reject("rule_path");
    if (JOURNAL_PAGES.has(rule.path)) {
      if (seen.has(rule.path) || rule.allowArticleLocaleQuery !== true
        || Object.hasOwn(old.rules[index], "allowArticleLocaleQuery")) reject("journal_rule");
      seen.add(rule.path);
      const restored = { ...rule };
      delete restored.allowArticleLocaleQuery;
      return restored;
    }
    if (Object.hasOwn(rule, "allowArticleLocaleQuery")) reject("nonjournal_rule");
    return rule;
  });
  if (seen.size !== JOURNAL_PAGES.size || !same(restoredRules, old.rules)) reject("rules_delta");
  const restoredCode = afterCode.replace(next.line, old.line).replace(NEW_QUERY, OLD_QUERY);
  if (restoredCode !== beforeCode) reject("unapproved_code_delta");
  const normalized = structuredClone(desired);
  normalized.Resources[FUNCTION_ID].Properties.FunctionCode = beforeCode;
  if (!same(normalized, live)) reject("other_template_change");
  return true;
}

function safeChangeInventory(changes) {
  return Array.isArray(changes) ? changes.slice(0, 100).map(item => {
    const resource = item?.ResourceChange;
    const safe = (value, pattern) => typeof value === "string" && pattern.test(value) ? value : "invalid";
    const detailValue = value => value == null ? null
      : safe(value, /^[A-Za-z0-9:._/-]{1,512}$/);
    return { logicalId: safe(resource?.LogicalResourceId, /^[A-Za-z0-9]{1,255}$/),
      type: safe(resource?.ResourceType, /^(AWS|Custom)::[A-Za-z0-9:]{1,128}$/),
      action: safe(resource?.Action, /^(Add|Modify|Remove|Import|Dynamic)$/),
      replacement: safe(resource?.Replacement, /^(True|False|Conditional)$/),
      details: Array.isArray(resource?.Details) ? resource.Details.slice(0, 20).map(detail => ({
        evaluation: detailValue(detail?.Evaluation), source: detailValue(detail?.ChangeSource),
        cause: detailValue(detail?.CausingEntity), attribute: detailValue(detail?.Target?.Attribute),
        name: detailValue(detail?.Target?.Name), path: detailValue(detail?.Target?.Path),
        recreation: detailValue(detail?.Target?.RequiresRecreation),
        valuesPresent: detail?.Target?.BeforeValue != null || detail?.Target?.AfterValue != null,
        valuesEqual: detail?.Target?.BeforeValue != null && detail?.Target?.AfterValue != null
          ? detail.Target.BeforeValue === detail.Target.AfterValue : null,
      })) : [] };
  }) : [];
}

function reviewQueryFenceChangeSet(detailed, summary, context) {
  const reject = reason => {
    const error = new Error("query_fence_change_set_invalid");
    error.changeSetReason = reason;
    error.changeInventory = [...safeChangeInventory(detailed?.Changes), ...safeChangeInventory(summary?.Changes)];
    throw error;
  };
  if (!context || !Array.isArray(context.parameters) || !detailed || !summary
    || detailed.NextToken || summary.NextToken) reject("context_or_pagination");
  const keys = ["StackId", "StackName", "ChangeSetId", "ChangeSetName"];
  if (keys.some(key => detailed[key] !== summary[key])
    || detailed.StackId !== context.stackId || detailed.ChangeSetId !== context.changeSetId
    || detailed.ChangeSetName !== context.changeSetName
    || detailed.StackName !== "ZoolandingTest-Zoolandingpage-test-Frontend") reject("identity");
  if (detailed.Status !== summary.Status || detailed.ExecutionStatus !== summary.ExecutionStatus
    || detailed.Status !== "CREATE_COMPLETE" || detailed.ExecutionStatus !== "AVAILABLE"
    || ![undefined, "UPDATE"].includes(detailed.ChangeSetType)
    || ![undefined, "UPDATE"].includes(summary.ChangeSetType)) reject("status");
  try {
    if (!same(parameterMap(detailed.Parameters), parameterMap(context.parameters))
      || !same(parameterMap(summary.Parameters), parameterMap(context.parameters))) reject("parameters");
  } catch (error) {
    if (error.changeSetReason) throw error;
    reject("parameters");
  }
  // CDK 2.1129.0 sets this preview flag even for a flat root stack. It does
  // not prove that a child stack exists. The live inventory rejects actual
  // nested stacks, and both change-set views must remain the same root.
  if (detailed.IncludeNestedStacks !== summary.IncludeNestedStacks) reject("nested_preview_disagreement");
  for (const description of [detailed, summary]) {
    if (![undefined, false, true].includes(description.IncludeNestedStacks) || description.ParentChangeSetId
      || description.RootChangeSetId || !Array.isArray(description.Changes)) reject("nested_or_changes_shape");
  }
  if (detailed.Changes.length !== 1 || ![1, 4].includes(summary.Changes.length)) reject("change_count");
  const checkDirect = (change, detailedView) => {
    const resource = change?.ResourceChange;
    const detail = resource?.Details?.[0];
    const target = detail?.Target;
    if (change?.Type !== "Resource" || resource?.LogicalResourceId !== FUNCTION_ID
      || resource.ResourceType !== "AWS::CloudFront::Function" || resource.Action !== "Modify"
      || resource.ChangeSetId != null
      || resource.Replacement !== "False" || !same(resource.Scope, ["Properties"])
      || resource.Details.length !== 1 || detail.Evaluation !== "Static"
      || detail.ChangeSource !== "DirectModification" || detail.CausingEntity != null
      || target?.Attribute !== "Properties" || target.Name !== "FunctionCode"
      || target.RequiresRecreation !== "Never"
      || (detailedView ? target.Path != null && target.Path !== "/Properties/FunctionCode"
        : target.Path != null || target.BeforeValue != null || target.AfterValue != null)
      || (detailedView && ((target.BeforeValue == null) !== (target.AfterValue == null)
        || (target.BeforeValue != null && target.BeforeValue === target.AfterValue)))) {
      reject(detailedView ? "direct_detailed" : "direct_summary");
    }
  };
  checkDirect(detailed.Changes[0], true);
  if (summary.Changes.length === 1) checkDirect(summary.Changes[0], false);
  else {
    const expected = new Map([
      ["FrontendAliasUpsertThehairnarrativeAdminTestThehairnarrativeComD6748622",
        ["Custom::ZoolandingFrontendAliasRecords", "Conditional", "Create",
          `${DISTRIBUTION_ID}.DomainName`, "Conditionally"]],
      ["FrontendDistributionDomainParameterThehairnarrativeAdminTest95A70218",
        ["AWS::SSM::Parameter", "False", "Value", `${DISTRIBUTION_ID}.DomainName`, "Never"]],
      [DISTRIBUTION_ID, ["AWS::CloudFront::Distribution", "False", "DistributionConfig",
        `${FUNCTION_ID}.FunctionARN`, "Never"]],
    ]);
    const seen = new Set();
    for (const change of summary.Changes) {
      const resource = change?.ResourceChange;
      if (resource?.LogicalResourceId === FUNCTION_ID) {
        if (seen.has(FUNCTION_ID)) reject("duplicate_function");
        checkDirect(change, false); seen.add(FUNCTION_ID); continue;
      }
      const profile = expected.get(resource?.LogicalResourceId);
      const item = resource?.Details?.[0];
      const target = item?.Target;
      if (change?.Type !== "Resource" || !profile || seen.has(resource.LogicalResourceId)
        || resource.ResourceType !== profile[0] || resource.Action !== "Modify"
        || resource.ChangeSetId != null
        || resource.Replacement !== profile[1] || !same(resource.Scope, ["Properties"])
        || resource.Details.length !== 1 || item.Evaluation !== "Dynamic"
        || item.ChangeSource !== "ResourceAttribute" || item.CausingEntity !== profile[3]
        || target?.Attribute !== "Properties" || target.Name !== profile[2]
        || target.RequiresRecreation !== profile[4] || target.Path != null
        || target.BeforeValue != null || target.AfterValue != null) reject("dependent_summary");
      seen.add(resource.LogicalResourceId);
    }
    if (seen.size !== 4) reject("dependent_count");
  }
  return true;
}

function parameterMap(parameters) {
  if (!Array.isArray(parameters)) fail("query_fence_change_set_invalid");
  const entries = parameters.map(item => [item.ParameterKey, item.ParameterValue]);
  if (entries.some(([key, value]) => typeof key !== "string" || key.length === 0
    || typeof value !== "string") || new Set(entries.map(([key]) => key)).size !== entries.length) {
    fail("query_fence_change_set_invalid");
  }
  return Object.fromEntries(entries);
}

function changeSetEvidenceDigest(detailed, summary) {
  if (!Array.isArray(detailed?.Changes) || !Array.isArray(summary?.Changes)) {
    fail("query_fence_change_set_invalid");
  }
  return digest({ detailed: detailed.Changes, summary: summary.Changes,
    parameters: detailed.Parameters, summaryParameters: summary.Parameters });
}

function templateDifferencePaths(expected, actual) {
  const paths = [];
  const safeKey = key => /^[A-Za-z0-9_:-]{1,128}$/.test(key) ? key : "[key]";
  const walk = (left, right, segments) => {
    if (paths.length >= 12 || same(left, right)) return;
    if (segments.length >= 7 || left == null || right == null
      || typeof left !== "object" || typeof right !== "object"
      || Array.isArray(left) !== Array.isArray(right)) {
      paths.push(segments.join(".") || "[root]"); return;
    }
    const keys = Array.isArray(left) && Array.isArray(right)
      ? [...new Set([...left.keys(), ...right.keys()])]
      : [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
    for (const key of keys) {
      walk(left[key], right[key], [...segments, safeKey(String(key))]);
      if (paths.length >= 12) break;
    }
  };
  walk(expected, actual, []);
  return paths;
}

function functionCodeDifference(expected, actual, liveSha256) {
  const asKind = value => typeof value === "string" ? "string"
    : value == null ? "missing" : typeof value === "object" ? "object" : "other";
  const result = { expectedKind: asKind(expected), actualKind: asKind(actual) };
  if (typeof expected !== "string" || typeof actual !== "string") return result;
  let offset = 0;
  while (offset < Math.min(expected.length, actual.length) && expected[offset] === actual[offset]) offset++;
  const normalize = value => value.replace(/\r\n/g, "\n");
  return { ...result, expectedLength: expected.length, actualLength: actual.length,
    expectedSha256: digest(expected), actualSha256: digest(actual),
    actualMatchesLive: /^[a-f0-9]{64}$/.test(liveSha256 || "") && digest(actual) === liveSha256,
    lineEndingsOnly: normalize(expected) === normalize(actual),
    trimOnly: expected.trimEnd() === actual.trimEnd(),
    actualHasNewQuery: actual.includes(NEW_QUERY), actualHasOldQuery: actual.includes(OLD_QUERY),
    firstDifferenceOffset: offset };
}

function validateLiveState(desired, state, selectedRelease, patched = false) {
  const reject = () => fail("query_fence_live_state_invalid");
  try {
    if (patched) { if (!same(desired, state?.original)) reject(); }
    else verifyExactQueryFenceDiff(desired, state?.original);
  } catch { reject(); }
  if (!same(state.original, state.processed)) reject();
  const stack = state.stack;
  const account = "765932874577";
  const stackName = "ZoolandingTest-Zoolandingpage-test-Frontend";
  if (stack?.StackName !== stackName || !new RegExp(`^arn:aws:cloudformation:us-east-1:${account}:stack/${stackName}/[A-Za-z0-9-]+$`).test(stack.StackId)
    || stack.StackStatus !== "UPDATE_COMPLETE" || stack.EnableTerminationProtection !== false
    || stack.RoleARN !== `arn:aws:iam::${account}:role/cdk-hnb659fds-cfn-exec-role-${account}-us-east-1`
    || !Array.isArray(stack.Parameters) || !Array.isArray(stack.Outputs)
    || stack.Outputs.filter(output => output.OutputKey === "FrontendReleaseId").length !== 1
    || stack.Outputs.find(output => output.OutputKey === "FrontendReleaseId").OutputValue !== selectedRelease) reject();
  if (!Array.isArray(state.resources) || state.resources.length < 2
    || state.resources.length !== Object.keys(state.original.Resources || {}).length
    || new Set(state.resources.map(resource => resource.LogicalResourceId)).size !== state.resources.length
    || state.resources.some(resource => resource.ResourceType === "AWS::CloudFormation::Stack"
      || resource.ResourceType !== state.original.Resources?.[resource.LogicalResourceId]?.Type
      || !["CREATE_COMPLETE", "UPDATE_COMPLETE"].includes(resource.ResourceStatus))) reject();
  const functionResource = state.resources.find(resource => resource.LogicalResourceId === FUNCTION_ID);
  const distributionResource = state.resources.find(resource => resource.LogicalResourceId === DISTRIBUTION_ID);
  const lambdaResource = state.resources.find(resource => resource.LogicalResourceId === SSR_ID);
  const name = state.original.Resources[FUNCTION_ID].Properties?.Name;
  const functionArn = state.function?.FunctionSummary?.FunctionMetadata?.FunctionARN;
  if (!functionResource || !distributionResource || typeof name !== "string" || name.length === 0
    || functionResource.PhysicalResourceId !== functionArn
    || !/^[A-Z0-9]+$/.test(distributionResource.PhysicalResourceId)
    || state.function?.FunctionSummary?.Name !== name
    || state.function?.FunctionSummary?.Status !== "DEPLOYED"
    || functionArn !== `arn:aws:cloudfront::${account}:function/${name}`
    || typeof state.function?.ETag !== "string" || state.function.ETag.length === 0
    || state.functionCode !== state.original.Resources[FUNCTION_ID].Properties.FunctionCode) reject();
  const distribution = state.distribution;
  const config = distribution?.DistributionConfig;
  if (typeof distribution?.ETag !== "string" || distribution.ETag.length === 0
    || !same(config?.Aliases, { Quantity: 1, Items: ["admin-test.thehairnarrative.com"] })) reject();
  const behaviors = [config.DefaultCacheBehavior, ...(config.CacheBehaviors?.Items || [])];
  if (behaviors.length === 0 || config.CacheBehaviors?.Quantity !== (config.CacheBehaviors?.Items || []).length
    || behaviors.some(behavior => !same(behavior?.FunctionAssociations,
      { Quantity: 1, Items: [{ EventType: "viewer-request", FunctionARN: functionArn }] }))) reject();
  const expectedLambda = state.original.Resources?.[SSR_ID]?.Properties;
  const lambda = state.lambda;
  if (!lambdaResource || !expectedLambda || lambdaResource.PhysicalResourceId !== expectedLambda.FunctionName
    || lambda?.FunctionName !== expectedLambda.FunctionName
    || lambda.FunctionArn !== `arn:aws:lambda:us-east-1:${account}:function:${expectedLambda.FunctionName}`
    || lambda.State !== "Active" || lambda.LastUpdateStatus !== "Successful"
    || !/^[A-Za-z0-9+/]{43}=$/.test(lambda.CodeSha256 || "")
    || lambda.Environment?.Error || !same(lambda.Environment?.Variables, expectedLambda.Environment?.Variables)) reject();
  const records = state.dns?.ResourceRecordSets;
  if (!Array.isArray(records) || records.length !== 2
    || !same(records.map(item => [item.Name, item.Type]), [
      ["admin-test.thehairnarrative.com.", "A"], ["admin-test.thehairnarrative.com.", "AAAA"]])
    || records.some(item => !/^d[a-z0-9]+\.cloudfront\.net\.$/.test(item.AliasTarget?.DNSName || "")
      || item.AliasTarget?.HostedZoneId !== "Z2FDTNDATAQYW2"
      || item.AliasTarget?.EvaluateTargetHealth !== false)
    || !same(records[0].AliasTarget, records[1].AliasTarget)) reject();
  return { stackId: stack.StackId, stackSha256: digest(stack), templateSha256: digest(state.original),
    inventory: structuredClone(state.resources), functionCodeSha256: digest(state.functionCode),
    functionEtag: state.function.ETag, functionArn, distributionId: distributionResource.PhysicalResourceId,
    distributionSha256: digest(distribution), distributionConfigSha256: digest(config),
    lambdaCodeSha256: lambda.CodeSha256, lambdaEnvSha256: digest(lambda.Environment.Variables),
    dnsSha256: digest(records), parameters: stack.Parameters,
    selectedRelease };
}

function validatePostState(desired, state, selectedRelease, baseline) {
  const reject = () => fail("query_fence_post_state_invalid");
  let current;
  try { current = validateLiveState(desired, state, selectedRelease, true); }
  catch { reject(); }
  const before = baseline?.inventory;
  const after = current.inventory;
  if (!Array.isArray(before) || before.length !== after.length) reject();
  const resourceIdentity = resource => {
    const copy = { ...resource };
    delete copy.LastUpdatedTimestamp;
    delete copy.ResourceStatus;
    delete copy.ResourceStatusReason;
    return copy;
  };
  const oldById = new Map(before.map(resource => [resource.LogicalResourceId, resource]));
  if (oldById.size !== before.length || after.some(resource => {
    const old = oldById.get(resource.LogicalResourceId);
    return !old || !same(resourceIdentity(resource), resourceIdentity(old));
  })) reject();
  if (current.stackId !== baseline?.stackId || current.functionArn !== baseline.functionArn
    || current.functionEtag === baseline.functionEtag
    || current.distributionConfigSha256 !== baseline.distributionConfigSha256
    || current.lambdaCodeSha256 !== baseline.lambdaCodeSha256
    || current.lambdaEnvSha256 !== baseline.lambdaEnvSha256
    || current.dnsSha256 !== baseline.dnsSha256
    || !same(current.parameters, baseline.parameters)
    || current.selectedRelease !== baseline.selectedRelease
    || current.functionCodeSha256 !== digest(desired.Resources[FUNCTION_ID].Properties.FunctionCode)) reject();
  return current;
}

function collectLiveState(desired, read, outputPath) {
  const reject = () => fail("query_fence_live_read_invalid");
  const stackName = "ZoolandingTest-Zoolandingpage-test-Frontend";
  const json = args => {
    let result;
    try { result = JSON.parse(read([...args, "--output", "json"])); }
    catch { reject(); }
    return result;
  };
  const template = stage => {
    const response = json(["cloudformation", "get-template", "--stack-name", stackName,
      "--template-stage", stage]);
    try { return typeof response.TemplateBody === "string" ? JSON.parse(response.TemplateBody) : response.TemplateBody; }
    catch { reject(); }
  };
  const original = template("Original"), processed = template("Processed");
  const stacks = json(["cloudformation", "describe-stacks", "--stack-name", stackName]).Stacks;
  const inventory = json(["cloudformation", "list-stack-resources", "--stack-name", stackName]);
  if (!Array.isArray(stacks) || stacks.length !== 1 || !Array.isArray(inventory.StackResourceSummaries)
    || inventory.NextToken) reject();
  const resources = inventory.StackResourceSummaries;
  const distributionId = resources.find(resource => resource.LogicalResourceId === DISTRIBUTION_ID)?.PhysicalResourceId;
  const functionName = desired?.Resources?.[FUNCTION_ID]?.Properties?.Name;
  if (typeof functionName !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(functionName)
    || typeof distributionId !== "string" || !/^[A-Z0-9]+$/.test(distributionId)) reject();
  let functionMetadata, functionCode;
  try {
    functionMetadata = json(["cloudfront", "describe-function", "--name", functionName, "--stage", "LIVE"]);
    const liveCode = JSON.parse(read(["cloudfront", "get-function", "--name", functionName,
      "--stage", "LIVE", "--output", "json", outputPath]));
    if (liveCode.ETag !== functionMetadata.ETag || liveCode.ContentType !== "application/octet-stream") reject();
    const bytes = fs.readFileSync(outputPath);
    if (bytes.length === 0 || bytes.length > 10240) reject();
    functionCode = bytes.toString("utf8");
    if (!Buffer.from(functionCode, "utf8").equals(bytes)) reject();
  } catch { reject(); }
  finally { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); }
  const distribution = json(["cloudfront", "get-distribution-config", "--id", distributionId]);
  return { original, processed, stack: stacks[0], resources, function: functionMetadata,
    functionCode, distribution };
}

async function runGuardedRelease(mode, operations) {
  if (!["review", "execute"].includes(mode)) fail("query_fence_mode_invalid");
  let executionAttempted = false;
  try {
    const baseline = await operations.preflight();
    const first = await operations.describe();
    reviewQueryFenceChangeSet(...first, operations.context);
    const second = await operations.describe();
    reviewQueryFenceChangeSet(...second, operations.context);
    if (!same(first, second)) fail("query_fence_change_set_changed");
    const reviewedDigest = changeSetEvidenceDigest(...first);
    const inventory = { detailed: safeChangeInventory(first[0].Changes),
      summary: safeChangeInventory(first[1].Changes) };
    if (mode === "review") return { decision: "reviewed-no-execution", reviewedDigest, inventory };
    if (!/^[a-f0-9]{64}$/.test(operations.expectedReviewDigest)
      || reviewedDigest !== operations.expectedReviewDigest) fail("query_fence_review_digest_changed");
    const repeated = await operations.preflight();
    if (!same(repeated, baseline)) fail("query_fence_pre_execute_drift");
    const final = await operations.describe();
    reviewQueryFenceChangeSet(...final, operations.context);
    if (!same(final, first)) fail("query_fence_change_set_changed");
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

function releaseTemplate(artifact) {
  const file = artifact.stack.properties.templateFile;
  if (!/^[A-Za-z0-9_-]+\.template\.json$/.test(file)) fail("query_fence_assembly_invalid");
  return JSON.parse(fs.readFileSync(path.join(artifact.assemblyRoot, file), "utf8"));
}

function readLive(root, desired, changeSetArn) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "thn-query-fence-"));
  const outputPath = path.join(directory, "live-function.js");
  try {
    const functionName = desired.Resources[FUNCTION_ID].Properties.Name;
    const zoneId = process.env.FRONTEND_TEST_THN_ADMIN_HOSTED_ZONE_ID;
    if (!/^Z[A-Z0-9]{1,32}$/.test(zoneId || "")) fail("query_fence_live_read_invalid");
    const lambdaName = desired.Resources?.[SSR_ID]?.Properties?.FunctionName;
    const read = createRoleClient(root, "lookup", { queryFence: { functionName, outputPath, changeSetArn },
      privateRotation: { lambdaName, hostedZoneId: zoneId } });
    const state = collectLiveState(desired, read, outputPath);
    state.lambda = readPrivateLambdaConfiguration();
    state.dns = JSON.parse(read(["route53", "list-resource-record-sets", "--hosted-zone-id", zoneId,
      "--start-record-name", "admin-test.thehairnarrative.com.", "--start-record-type", "A",
      "--max-items", "2", "--no-paginate", "--output", "json"]));
    return state;
  } finally {
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    fs.rmdirSync(directory);
  }
}

function readChangeSet(root, desired, arn, liveFunctionCodeSha256) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "thn-query-fence-review-"));
  const outputPath = path.join(directory, "unused.js");
  try {
    const read = createRoleClient(root, "lookup", { queryFence: {
      functionName: desired.Resources[FUNCTION_ID].Properties.Name, outputPath, changeSetArn: arn } });
    const stackName = "ZoolandingTest-Zoolandingpage-test-Frontend";
    const request = ["cloudformation", "describe-change-set", "--stack-name", stackName,
      "--change-set-name", arn, "--no-paginate"];
    const detailed = JSON.parse(read([...request, "--include-property-values", "--output", "json"]));
    const summary = JSON.parse(read([...request, "--output", "json"]));
    for (const stage of ["Original", "Processed"]) {
      const result = JSON.parse(read(["cloudformation", "get-template", "--stack-name", stackName,
        "--change-set-name", arn, "--template-stage", stage, "--output", "json"]));
      const template = typeof result.TemplateBody === "string" ? JSON.parse(result.TemplateBody) : result.TemplateBody;
      if (!same(template, desired)) {
        const error = new Error("query_fence_change_set_template_invalid");
        error.templateStage = stage;
        error.templatePaths = templateDifferencePaths(desired, template);
        if (error.templatePaths.includes(`Resources.${FUNCTION_ID}.Properties.FunctionCode`)) {
          error.functionCodeDiagnostic = functionCodeDifference(
            desired.Resources?.[FUNCTION_ID]?.Properties?.FunctionCode,
            template?.Resources?.[FUNCTION_ID]?.Properties?.FunctionCode,
            liveFunctionCodeSha256);
        }
        throw error;
      }
    }
    return [detailed, summary];
  } finally { fs.rmdirSync(directory); }
}

async function main(argv = process.argv.slice(2)) {
  const [mode, root, name] = argv;
  if (!root || !["preflight", "project", "review", "execute", "verify"].includes(mode)
    || argv.length !== (["project", "review", "execute"].includes(mode) ? 3 : 2)) fail("query_fence_arguments_invalid");
  const artifact = loadArtifact(root);
  if (artifact.metadata.thn_admin_origin_enabled !== "true"
    || artifact.metadata.thn_admin_route53_enabled !== "true"
    || !/^[a-f0-9]{40}$/.test(artifact.metadata.source_sha)
    || artifact.metadata.source_sha !== process.env.GITHUB_SHA) fail("query_fence_release_identity_invalid");
  try { require("./thn-admin-private-release-rotation").loadSelection(artifact, process.env); }
  catch { fail("query_fence_selection_invalid"); }
  const selected = path.join(artifact.root, "thn-admin-selection.json");
  if (!fs.existsSync(selected)) fail("query_fence_selection_missing");
  const release = require("./thn-admin-release");
  const proofMode = await release.main([mode === "verify" ? "verify" : "verify-query-fence", selected]);
  if (proofMode !== (mode === "verify" ? "none" : "query-fence")) fail("query_fence_release_selection_invalid");
  const desired = releaseTemplate(artifact);
  const selectedRelease = artifact.metadata.frontend_release_id;
  const preflight = async () => {
    const first = validateLiveState(desired, readLive(root, desired), selectedRelease);
    const second = validateLiveState(desired, readLive(root, desired), selectedRelease);
    if (!same(first, second)) fail("query_fence_preflight_drift");
    return first;
  };
  if (mode === "preflight") {
    const snapshot = await preflight();
    return { decision: "preflight-ok", template_sha256: snapshot.templateSha256,
      function_code_sha256: snapshot.functionCodeSha256 };
  }
  if (mode === "project") {
    await preflight();
    return { decision: "projected-no-execution",
      ...require("./thn-admin-private-release-rotation").writeProjectedAssembly(
        artifact, desired, name, process.env, "query-fence") };
  }
  if (mode === "verify") {
    const first = validateLiveState(desired, readLive(root, desired), selectedRelease, true);
    const second = validateLiveState(desired, readLive(root, desired), selectedRelease, true);
    if (!same(first, second)) fail("query_fence_verify_drift");
    await probeRoutes();
    return { decision: "verified-no-execution", template_sha256: second.templateSha256,
      function_code_sha256: second.functionCodeSha256 };
  }
  if (!/^release-[1-9][0-9]*-[1-9][0-9]*$/.test(name)
    || name !== `release-${artifact.metadata.run_id}-${artifact.metadata.run_attempt}`) fail("query_fence_change_set_name_invalid");
  if (mode === "execute" && !/^[a-f0-9]{64}$/.test(process.env.EXPECTED_REVIEW_DIGEST)) {
    fail("query_fence_review_digest_changed");
  }
  const baseline = await preflight();
  const stackName = "ZoolandingTest-Zoolandingpage-test-Frontend";
  const initialRead = createRoleClient(root, "lookup");
  const initial = JSON.parse(initialRead(["cloudformation", "describe-change-set", "--stack-name", stackName,
    "--change-set-name", name, "--no-paginate", "--output", "json"]));
  const arn = initial.ChangeSetId;
  if (!validChangeSetArn(arn, "765932874577", name) || initial.StackId !== baseline.stackId
    || initial.StackName !== stackName || initial.ChangeSetName !== name) fail("query_fence_change_set_identity_invalid");
  const context = { stackId: baseline.stackId, changeSetId: arn, changeSetName: name,
    parameters: baseline.parameters };
  const deploy = createRoleClient(root, "deploy", { queryFence: {
    changeSetArn: arn, functionName: desired.Resources[FUNCTION_ID].Properties.Name,
    outputPath: path.join(os.tmpdir(), "thn-query-fence-unused.js") } });
  const operations = {
    context,
    expectedReviewDigest: process.env.EXPECTED_REVIEW_DIGEST,
    preflight,
    describe: async () => readChangeSet(root, desired, arn, baseline.functionCodeSha256),
    cleanup: async () => deploy(["cloudformation", "delete-change-set", "--stack-name", stackName,
      "--change-set-name", arn]),
    execute: async () => deploy(["cloudformation", "execute-change-set", "--stack-name", stackName,
      "--change-set-name", arn]),
    wait: async () => deploy(["cloudformation", "wait", "stack-update-complete", "--stack-name", stackName]),
    postcheck: async original => {
      const read = createRoleClient(root, "lookup");
      read(["cloudfront", "wait", "distribution-deployed", "--id", original.distributionId]);
      validatePostState(desired, readLive(root, desired), selectedRelease, original);
      await probeRoutes();
    },
  };
  const result = await runGuardedRelease(mode, operations);
  return { ...result, change_set_arn: arn, source_sha: artifact.metadata.source_sha,
    function_code_sha256: digest(desired.Resources[FUNCTION_ID].Properties.FunctionCode) };
}

async function probeRoutes(fetcher = fetch, { attempts = 12, delayMs = 10000 } = {}) {
  const host = "https://admin-test.thehairnarrative.com";
  const id = "a4fc82e0eceecd75b150b6983796558739891fa85";
  const valid = ["/admin/journal", "/admin/journal/new", `/admin/journal/${id}/edit`,
    `/admin/journal/${id}/preview`].flatMap(route => [
    `${host}${route}?lang=es&articleLocale=en`, `${host}${route}?articleLocale=en&lang=es`,
  ]);
  const denied = [`${host}/admin/journal?lang=es&articleLocale=fr`,
    `${host}/admin/journal?lang=es&articleLocale=en&articleLocale=es`,
    `${host}/admin/journal?lang=es&articleLocale=en&unexpected=1`,
    `${host}/admin/journal/access?articleLocale=en`];
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 12
    || !Number.isInteger(delayMs) || delayMs < 0 || delayMs > 10000) fail("query_fence_route_probe_invalid");
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const results = await Promise.all([...valid, ...denied].map(async url => {
        const response = await fetcher(url, { redirect: "manual", signal: AbortSignal.timeout(10000) });
        return response.status;
      }));
      if (results.slice(0, valid.length).every(status => [200, 301, 302, 303, 307, 308].includes(status))
        && results.slice(valid.length).every(status => status === 404)) return true;
    } catch { /* retry while CloudFront propagates */ }
    if (attempt < attempts - 1) await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  fail("query_fence_route_probe_failed");
}

module.exports = { verifyExactQueryFenceDiff, reviewQueryFenceChangeSet, validateLiveState, validatePostState,
  collectLiveState, probeRoutes, main,
  runGuardedRelease, changeSetEvidenceDigest, templateDifferencePaths, functionCodeDifference,
  FUNCTION_ID, DISTRIBUTION_ID };

if (require.main === module) {
  main().then(result => { process.stdout.write(`${JSON.stringify(result)}\n`); })
    .catch(error => {
      const safeCode = /^query_fence_[a-z_]+$/.test(error?.message)
        ? error.message : "query_fence_release_failed";
      process.stderr.write(`${JSON.stringify({ error: safeCode,
        ...(safeCode === "query_fence_change_set_invalid"
          && /^[a-z_]{1,64}$/.test(error?.changeSetReason || "")
          ? { change_set_reason: error.changeSetReason } : {}),
        ...(safeCode === "query_fence_diff_invalid" && /^[a-z_]{1,64}$/.test(error?.diffReason || "")
          ? { diff_reason: error.diffReason } : {}),
        ...(Array.isArray(error?.changeInventory) ? { change_inventory: error.changeInventory } : {}),
        ...(["Original", "Processed"].includes(error?.templateStage)
          && Array.isArray(error?.templatePaths) ? {
            template_stage: error.templateStage, template_paths: error.templatePaths,
          } : {}),
        ...(error?.functionCodeDiagnostic ? { function_code_diagnostic: error.functionCodeDiagnostic } : {}) })}\n`);
      process.exitCode = 1;
    });
}
