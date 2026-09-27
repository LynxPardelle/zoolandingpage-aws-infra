"use strict";
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { loadArtifact, createRoleClient, validChangeSetArn } = require("./infra-test-aws");

const FUNCTION_ID = "FrontendViewerHostHeaderFunctionThehairnarrativeAdminTestD75B90C2";
const DISTRIBUTION_ID = "FrontendDistributionThehairnarrativeAdminTest5B029562";
const JOURNAL_PAGES = new Set(["/admin/journal", "/admin/journal/new",
  "/admin/journal/:articleId/edit", "/admin/journal/:articleId/preview"]);
const OLD_QUERY = '      if (queryKey !== "lang" || !rule.allowLanguageQuery) {';
const NEW_QUERY = '      if ((queryKey !== "lang" || !rule.allowLanguageQuery)\n'
  + '        && (queryKey !== "articleLocale" || !rule.allowArticleLocaleQuery)) {';
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

function reviewQueryFenceChangeSet(detailed, summary, context) {
  const inventory = changes => Array.isArray(changes) ? changes.slice(0, 100).map(item => {
    const resource = item?.ResourceChange;
    const safe = (value, pattern) => typeof value === "string" && pattern.test(value) ? value : "invalid";
    return { logicalId: safe(resource?.LogicalResourceId, /^[A-Za-z0-9]{1,255}$/),
      type: safe(resource?.ResourceType, /^AWS::[A-Za-z0-9:]{1,128}$/),
      action: safe(resource?.Action, /^(Add|Modify|Remove|Import|Dynamic)$/),
      replacement: safe(resource?.Replacement, /^(True|False|Conditional)$/) };
  }) : [];
  const reject = () => {
    const error = new Error("query_fence_change_set_invalid");
    error.changeInventory = [...inventory(detailed?.Changes), ...inventory(summary?.Changes)];
    throw error;
  };
  if (!context || !Array.isArray(context.parameters) || !detailed || !summary
    || detailed.NextToken || summary.NextToken) reject();
  const keys = ["StackId", "StackName", "ChangeSetId", "ChangeSetName", "Status", "ExecutionStatus"];
  if (keys.some(key => detailed[key] !== summary[key])
    || detailed.StackId !== context.stackId || detailed.ChangeSetId !== context.changeSetId
    || detailed.ChangeSetName !== context.changeSetName
    || detailed.StackName !== "ZoolandingTest-Zoolandingpage-test-Frontend"
    || detailed.Status !== "CREATE_COMPLETE" || detailed.ExecutionStatus !== "AVAILABLE"
    || ![undefined, "UPDATE"].includes(detailed.ChangeSetType)
    || ![undefined, "UPDATE"].includes(summary.ChangeSetType)
    || !same(parameterMap(detailed.Parameters), parameterMap(context.parameters))
    || !same(parameterMap(summary.Parameters), parameterMap(context.parameters))) reject();
  for (const description of [detailed, summary]) {
    if (description.IncludeNestedStacks === true || description.ParentChangeSetId
      || description.RootChangeSetId || !Array.isArray(description.Changes)
      || description.Changes.length !== 1) reject();
    const change = description.Changes[0];
    const resource = change?.ResourceChange;
    const detail = resource?.Details?.[0];
    const target = detail?.Target;
    if (change?.Type !== "Resource" || resource.LogicalResourceId !== FUNCTION_ID
      || resource.ResourceType !== "AWS::CloudFront::Function" || resource.Action !== "Modify"
      || resource.Replacement !== "False" || !same(resource.Scope, ["Properties"])
      || resource.Details.length !== 1 || detail.Evaluation !== "Static"
      || detail.ChangeSource !== "DirectModification" || detail.CausingEntity != null
      || target?.Attribute !== "Properties" || target.Name !== "FunctionCode"
      || target.RequiresRecreation !== "Never"
      || (target.Path != null && target.Path !== "/Properties/FunctionCode")) reject();
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
    || state.resources.some(resource => resource.ResourceType !== state.original.Resources?.[resource.LogicalResourceId]?.Type
      || !["CREATE_COMPLETE", "UPDATE_COMPLETE"].includes(resource.ResourceStatus))) reject();
  const functionResource = state.resources.find(resource => resource.LogicalResourceId === FUNCTION_ID);
  const distributionResource = state.resources.find(resource => resource.LogicalResourceId === DISTRIBUTION_ID);
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
  return { stackId: stack.StackId, stackSha256: digest(stack), templateSha256: digest(state.original),
    inventory: structuredClone(state.resources), functionCodeSha256: digest(state.functionCode),
    functionEtag: state.function.ETag, functionArn, distributionId: distributionResource.PhysicalResourceId,
    distributionSha256: digest(distribution), parameters: stack.Parameters,
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
  const functionIdentity = resource => {
    const copy = { ...resource };
    delete copy.LastUpdatedTimestamp;
    delete copy.ResourceStatus;
    delete copy.ResourceStatusReason;
    return copy;
  };
  const oldById = new Map(before.map(resource => [resource.LogicalResourceId, resource]));
  if (oldById.size !== before.length || after.some(resource => {
    const old = oldById.get(resource.LogicalResourceId);
    return !old || !(resource.LogicalResourceId === FUNCTION_ID
      ? same(functionIdentity(resource), functionIdentity(old)) : same(resource, old));
  })) reject();
  if (current.stackId !== baseline?.stackId || current.functionArn !== baseline.functionArn
    || current.functionEtag === baseline.functionEtag
    || current.distributionSha256 !== baseline.distributionSha256
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
  const baseline = await operations.preflight();
  let executed = false;
  try {
    const first = await operations.describe();
    reviewQueryFenceChangeSet(...first, operations.context);
    const second = await operations.describe();
    reviewQueryFenceChangeSet(...second, operations.context);
    if (!same(first, second)) fail("query_fence_change_set_changed");
    if (mode === "review") return "reviewed-no-execution";
    const repeated = await operations.preflight();
    if (!same(repeated, baseline)) fail("query_fence_pre_execute_drift");
    const final = await operations.describe();
    reviewQueryFenceChangeSet(...final, operations.context);
    if (!same(final, first)) fail("query_fence_change_set_changed");
    await operations.execute();
    executed = true;
    await operations.wait();
    await operations.postcheck(baseline);
    await operations.postcheck(baseline);
    return "executed";
  } finally {
    if (!executed) await operations.cleanup();
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
    const read = createRoleClient(root, "lookup", { queryFence: { functionName, outputPath, changeSetArn } });
    return collectLiveState(desired, read, outputPath);
  } finally {
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    fs.rmdirSync(directory);
  }
}

function readChangeSet(root, desired, arn) {
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
      if (!same(template, desired)) fail("query_fence_change_set_template_invalid");
    }
    return [detailed, summary];
  } finally { fs.rmdirSync(directory); }
}

async function main(argv = process.argv.slice(2)) {
  const [mode, root, name] = argv;
  if (!root || !["preflight", "review", "execute", "verify"].includes(mode)
    || argv.length !== (["review", "execute"].includes(mode) ? 3 : 2)) fail("query_fence_arguments_invalid");
  const artifact = loadArtifact(root);
  if (artifact.metadata.thn_admin_origin_enabled !== "true"
    || artifact.metadata.thn_admin_route53_enabled !== "true"
    || !/^[a-f0-9]{40}$/.test(artifact.metadata.source_sha)
    || artifact.metadata.source_sha !== process.env.GITHUB_SHA) fail("query_fence_release_identity_invalid");
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
    preflight,
    describe: async () => readChangeSet(root, desired, arn),
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
  const decision = await runGuardedRelease(mode, operations);
  return { decision, change_set_arn: arn, source_sha: artifact.metadata.source_sha,
    function_code_sha256: digest(desired.Resources[FUNCTION_ID].Properties.FunctionCode) };
}

async function probeRoutes(fetcher = fetch, { attempts = 12, delayMs = 10000 } = {}) {
  const host = "https://admin-test.thehairnarrative.com";
  const id = "a4fc82e0eceecd75b150b6983796558739891fa85";
  const valid = ["/admin/journal", "/admin/journal/new", `/admin/journal/${id}/edit`,
    `/admin/journal/${id}/preview`].map(route => `${host}${route}?lang=es&articleLocale=en`);
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
  runGuardedRelease, FUNCTION_ID, DISTRIBUTION_ID };

if (require.main === module) {
  main().then(result => { process.stdout.write(`${JSON.stringify(result)}\n`); })
    .catch(error => {
      const safeCode = /^query_fence_[a-z_]+$/.test(error?.message)
        ? error.message : "query_fence_release_failed";
      process.stderr.write(`${JSON.stringify({ error: safeCode,
        ...(safeCode === "query_fence_diff_invalid" && /^[a-z_]{1,64}$/.test(error?.diffReason || "")
          ? { diff_reason: error.diffReason } : {}),
        ...(Array.isArray(error?.changeInventory) ? { change_inventory: error.changeInventory } : {}) })}\n`);
      process.exitCode = 1;
    });
}
