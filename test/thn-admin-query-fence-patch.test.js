"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const subject = require("../tools/thn-admin-query-fence-patch");
const adminRelease = require("../tools/thn-admin-release");

const ID = "FrontendViewerHostHeaderFunctionThehairnarrativeAdminTestD75B90C2";
const DISTRIBUTION_ID = "FrontendDistributionThehairnarrativeAdminTest5B029562";
const PAGES = ["/admin/journal", "/admin/journal/new", "/admin/journal/:articleId/edit", "/admin/journal/:articleId/preview"];
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

test("fixture matches the current viewer function source exactly", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "lib", "stacks", "frontend-stack.js"), "utf8")
    .replace(/\r\n/g, "\n");
  assert.equal(source.split(NEW_QUERY).length, 2);
});

test("CLI publishes the query fence proof before starting preflight", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "tools", "thn-admin-query-fence-patch.js"), "utf8");
  const exportPosition = source.indexOf("module.exports = { verifyExactQueryFenceDiff");
  const startPosition = source.indexOf("if (require.main === module)");
  assert.ok(exportPosition >= 0 && startPosition >= 0 && exportPosition < startPosition,
    "the CLI must export the proof before thn-admin-release requires it during preflight");
});
const oldRules = [...PAGES.map(path => ({ path, methods: ["GET"], allowLanguageQuery: true })),
  { path: "/admin/journal/api", methods: ["POST"], allowLanguageQuery: false }];
const newRules = oldRules.map(rule => PAGES.includes(rule.path) ? { ...rule, allowArticleLocaleQuery: true } : rule);
const code = (rules, query) => `function handler(event) {\n  var expectedHost = "admin-test.thehairnarrative.com";\n  var rules = ${JSON.stringify(rules)};\n  function queryAllowed(rule, querystring) {\n${query}\n  }\n  return event.request;\n}`;
const live = () => ({ Resources: { [ID]: { Type: "AWS::CloudFront::Function", Properties: {
  Name: "admin-test", FunctionCode: code(oldRules, OLD_QUERY), AutoPublish: true } },
  [DISTRIBUTION_ID]: { Type: "AWS::CloudFront::Distribution", Properties: { Host: "admin-test.thehairnarrative.com" } } } });
const desired = () => {
  const template = live();
  template.Resources[ID].Properties.FunctionCode = code(newRules, NEW_QUERY);
  return template;
};

test("proof accepts exactly four Journal flags and the locale query check", () => {
  assert.equal(subject.verifyExactQueryFenceDiff(desired(), live()), true);
  assert.equal(adminRelease.determineAdminProofMode({}, desired(), live(), true), "query-fence");
});

test("proof rejects drift from the historical single-lang baseline", () => {
  const changed = live();
  changed.Resources[ID].Properties.FunctionCode = code(oldRules,
    OLD_QUERY.replace("queryKeys.length !== 1", "queryKeys.length > 1"));
  assert.throws(() => subject.verifyExactQueryFenceDiff(desired(), changed),
    /query_fence_diff_invalid/);
});

test("proof rejects any other code, route, or template change", () => {
  const mutations = [
    template => { template.Resources[DISTRIBUTION_ID].Properties.Host = "other"; },
    template => { template.Resources[ID].Properties.FunctionCode += "\n// drift"; },
    template => { template.Resources[ID].Properties.FunctionCode = code(newRules.map(rule => rule.path === PAGES[0]
      ? { ...rule, methods: ["POST"] } : rule), NEW_QUERY); },
    template => { template.Resources[ID].Properties.FunctionCode = code(newRules.map(rule => rule.path === "/admin/journal/api"
      ? { ...rule, allowArticleLocaleQuery: true } : rule), NEW_QUERY); },
    template => { template.Resources[ID].Properties.FunctionCode = code(newRules.slice(1), NEW_QUERY); },
  ];
  for (const mutate of mutations) {
    const candidate = desired(); mutate(candidate);
    assert.throws(() => subject.verifyExactQueryFenceDiff(candidate, live()), /query_fence_diff_invalid/);
  }
});

test("query fence diff identifies the failed gate without exposing template values", () => {
  const extraTemplate = live();
  extraTemplate.Resources[DISTRIBUTION_ID].Properties.Host = "private-value-not-for-logs";
  assert.throws(() => subject.verifyExactQueryFenceDiff(desired(), extraTemplate), error => {
    assert.equal(error.message, "query_fence_diff_invalid");
    assert.equal(error.diffReason, "other_template_change");
    assert.ok(!JSON.stringify(error).includes("private-value-not-for-logs"));
    return true;
  });
  const wrongCode = desired();
  wrongCode.Resources[ID].Properties.FunctionCode += "\n// private-value-not-for-logs";
  assert.throws(() => subject.verifyExactQueryFenceDiff(wrongCode, live()), error => {
    assert.equal(error.diffReason, "unapproved_code_delta");
    assert.ok(!JSON.stringify(error).includes("private-value-not-for-logs"));
    return true;
  });
});

const changeSet = () => ({ StackId: "stack-id", StackName: "ZoolandingTest-Zoolandingpage-test-Frontend",
  ChangeSetId: "change-id", ChangeSetName: "release-1-1", Status: "CREATE_COMPLETE", ExecutionStatus: "AVAILABLE",
  Parameters: [], Changes: [{ Type: "Resource", ResourceChange: { LogicalResourceId: ID,
    ResourceType: "AWS::CloudFront::Function", Action: "Modify", Replacement: "False", Scope: ["Properties"],
    Details: [{ Target: { Attribute: "Properties", Name: "FunctionCode", RequiresRecreation: "Never" },
      Evaluation: "Static", ChangeSource: "DirectModification" }] } }] });

test("change set proof accepts one FunctionCode effect in both views", () => {
  const detailed = changeSet();
  const summary = structuredClone(detailed);
  assert.equal(subject.reviewQueryFenceChangeSet(detailed, summary, {
    stackId: "stack-id", changeSetId: "change-id", changeSetName: "release-1-1", parameters: [] }), true);
});

test("change set proof rejects dependent entries and incomplete descriptions", () => {
  const mutations = [
    (d, s) => { s.Changes.push({ Type: "Resource", ResourceChange: { LogicalResourceId: "AdminDistribution", Action: "Modify" } }); },
    (d, s) => { d.Changes[0].ResourceChange.Replacement = "True"; },
    (d, s) => { d.NextToken = "next"; },
    (d, s) => { s.Changes[0].ResourceChange.Details[0].Target.Name = "FunctionConfig"; },
    (d, s) => { s.Changes.push(structuredClone(s.Changes[0])); },
  ];
  for (const mutate of mutations) {
    const detailed = changeSet(), summary = structuredClone(detailed);
    mutate(detailed, summary);
    assert.throws(() => subject.reviewQueryFenceChangeSet(detailed, summary, {
      stackId: "stack-id", changeSetId: "change-id", changeSetName: "release-1-1", parameters: [] }), /query_fence_change_set_invalid/);
  }
});

test("blocked change-set inventory identifies only resource coordinates", () => {
  const detailed = changeSet(), summary = structuredClone(detailed);
  detailed.Changes.push({ Type: "Resource", ResourceChange: { LogicalResourceId: DISTRIBUTION_ID,
    ResourceType: "AWS::CloudFront::Distribution", Action: "Modify", Replacement: "False",
    BeforeValue: "do-not-log" } });
  assert.throws(() => subject.reviewQueryFenceChangeSet(detailed, summary, {
    stackId: "stack-id", changeSetId: "change-id", changeSetName: "release-1-1", parameters: [] }), error => {
    assert.equal(error.message, "query_fence_change_set_invalid");
    assert.ok(error.changeInventory.some(item => item.logicalId === DISTRIBUTION_ID));
    assert.ok(!JSON.stringify(error.changeInventory).includes("do-not-log"));
    return true;
  });
});

const liveState = () => {
  const current = live();
  const arn = "arn:aws:cloudfront::765932874577:function/admin-test";
  const stackId = "arn:aws:cloudformation:us-east-1:765932874577:stack/ZoolandingTest-Zoolandingpage-test-Frontend/fixture";
  const resources = [
    { LogicalResourceId: ID, ResourceType: "AWS::CloudFront::Function", PhysicalResourceId: arn, ResourceStatus: "UPDATE_COMPLETE" },
    { LogicalResourceId: DISTRIBUTION_ID, ResourceType: "AWS::CloudFront::Distribution", PhysicalResourceId: "ABCDEFG123", ResourceStatus: "UPDATE_COMPLETE" },
  ];
  return { original: current, processed: structuredClone(current),
    stack: { StackId: stackId, StackName: "ZoolandingTest-Zoolandingpage-test-Frontend",
      StackStatus: "UPDATE_COMPLETE", EnableTerminationProtection: false,
      RoleARN: "arn:aws:iam::765932874577:role/cdk-hnb659fds-cfn-exec-role-765932874577-us-east-1",
      Parameters: [{ ParameterKey: "THNEnabled", ParameterValue: "true" }],
      Outputs: [{ OutputKey: "FrontendReleaseId", OutputValue: "approved-release" }] },
    resources, function: { ETag: "etag-1", FunctionSummary: { Name: "admin-test", Status: "DEPLOYED",
      FunctionMetadata: { FunctionARN: arn }, FunctionConfig: { Runtime: "cloudfront-js-2.0" } } },
    functionCode: current.Resources[ID].Properties.FunctionCode,
    distribution: { ETag: "dist-etag", DistributionConfig: { Aliases: { Quantity: 1, Items: ["admin-test.thehairnarrative.com"] },
      DefaultCacheBehavior: { FunctionAssociations: { Quantity: 1,
        Items: [{ EventType: "viewer-request", FunctionARN: arn }] } }, CacheBehaviors: { Quantity: 0 } } } };
};

test("live snapshot binds template, runtime code, function association and selected release", () => {
  const state = liveState();
  const result = subject.validateLiveState(desired(), state, "approved-release");
  assert.match(result.functionCodeSha256, /^[a-f0-9]{64}$/);
  assert.equal(result.stackId, state.stack.StackId);
});

test("live snapshot rejects code drift, distribution drift and incomplete inventory", () => {
  const mutations = [
    s => { s.functionCode += "\n// different LIVE code"; },
    s => { s.distribution.DistributionConfig.Aliases.Items = ["other.example"]; },
    s => { s.distribution.DistributionConfig.DefaultCacheBehavior.FunctionAssociations.Items[0].FunctionARN = "other"; },
    s => { s.resources.pop(); },
    s => { s.function.FunctionSummary.Status = "UNPUBLISHED"; },
    s => { delete s.stack.EnableTerminationProtection; },
    s => { s.stack.Outputs[0].OutputValue = "other"; },
  ];
  for (const mutate of mutations) {
    const state = liveState(); mutate(state);
    assert.throws(() => subject.validateLiveState(desired(), state, "approved-release"), /query_fence_live_state_invalid/);
  }
  const extra = { Type: "AWS::S3::Bucket", Properties: { BucketName: "unchanged" } };
  const state = liveState();
  const candidate = desired();
  state.original.Resources.UnrelatedBucket = structuredClone(extra);
  state.processed.Resources.UnrelatedBucket = structuredClone(extra);
  candidate.Resources.UnrelatedBucket = structuredClone(extra);
  assert.throws(() => subject.validateLiveState(candidate, state, "approved-release"), /query_fence_live_state_invalid/);
});

test("review deletes its change set without executing", async () => {
  const calls = [];
  const snapshot = { stackId: "stack-id", marker: "stable" };
  const result = await subject.runGuardedRelease("review", {
    preflight: async () => { calls.push("preflight"); return snapshot; },
    describe: async () => { calls.push("describe"); return [changeSet(), changeSet()]; },
    cleanup: async () => { calls.push("cleanup"); },
    execute: async () => { calls.push("execute"); },
    context: { stackId: "stack-id", changeSetId: "change-id", changeSetName: "release-1-1", parameters: [] },
  });
  assert.equal(result, "reviewed-no-execution");
  assert.deepEqual(calls, ["preflight", "describe", "describe", "cleanup"]);
});

test("execute rechecks unchanged state and exact change set before mutation", async () => {
  const calls = [];
  const snapshot = { stackId: "stack-id", marker: "stable" };
  const result = await subject.runGuardedRelease("execute", {
    preflight: async () => { calls.push("preflight"); return snapshot; },
    describe: async () => { calls.push("describe"); return [changeSet(), changeSet()]; },
    cleanup: async () => { calls.push("cleanup"); },
    execute: async () => { calls.push("execute"); },
    wait: async () => { calls.push("wait"); },
    postcheck: async () => { calls.push("postcheck"); },
    context: { stackId: "stack-id", changeSetId: "change-id", changeSetName: "release-1-1", parameters: [] },
  });
  assert.equal(result, "executed");
  assert.deepEqual(calls, ["preflight", "describe", "describe", "preflight", "describe", "execute", "wait", "postcheck", "postcheck"]);
});

test("dynamic dependent entry blocks execution and cleans up", async () => {
  const calls = [];
  await assert.rejects(() => subject.runGuardedRelease("execute", {
    preflight: async () => ({ stackId: "stack-id", marker: "stable" }),
    describe: async () => { const summary = changeSet(); summary.Changes.push({ Type: "Resource",
      ResourceChange: { LogicalResourceId: DISTRIBUTION_ID, ResourceType: "AWS::CloudFront::Distribution", Action: "Modify" } });
      return [changeSet(), summary]; },
    cleanup: async () => { calls.push("cleanup"); },
    execute: async () => { calls.push("execute"); },
    context: { stackId: "stack-id", changeSetId: "change-id", changeSetName: "release-1-1", parameters: [] },
  }), /query_fence_change_set_invalid/);
  assert.deepEqual(calls, ["cleanup"]);
});

test("postcheck accepts only deployed code with preserved stack and distribution", () => {
  const before = subject.validateLiveState(desired(), liveState(), "approved-release");
  const afterState = liveState();
  afterState.original = desired();
  afterState.processed = desired();
  afterState.functionCode = desired().Resources[ID].Properties.FunctionCode;
  afterState.function.ETag = "etag-2";
  afterState.resources[0].LastUpdatedTimestamp = "2026-09-26T12:30:00Z";
  assert.equal(subject.validatePostState(desired(), afterState, "approved-release", before).functionEtag, "etag-2");
  afterState.resources[1].PhysicalResourceId = "OTHER123";
  assert.throws(() => subject.validatePostState(desired(), afterState, "approved-release", before), /query_fence_post_state_invalid/);
  afterState.resources[1].PhysicalResourceId = "ABCDEFG123";
  afterState.distribution.ETag = "unexpected";
  assert.throws(() => subject.validatePostState(desired(), afterState, "approved-release", before), /query_fence_post_state_invalid/);
});

test("live collector reads both template stages and the LIVE function code", t => {
  const state = liveState();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "query-fence-test-"));
  const outputPath = path.join(directory, "function.js");
  t.after(() => { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); fs.rmdirSync(directory); });
  const calls = [];
  const read = args => {
    const operation = args.slice(0, 2).join(" ");
    calls.push(operation);
    if (operation === "cloudformation get-template") return JSON.stringify({ TemplateBody: args.includes("Processed") ? state.processed : state.original });
    if (operation === "cloudformation describe-stacks") return JSON.stringify({ Stacks: [state.stack] });
    if (operation === "cloudformation list-stack-resources") return JSON.stringify({ StackResourceSummaries: state.resources });
    if (operation === "cloudfront get-distribution-config") return JSON.stringify(state.distribution);
    if (operation === "cloudfront describe-function") return JSON.stringify(state.function);
    if (operation === "cloudfront get-function") {
      fs.writeFileSync(outputPath, state.functionCode);
      return JSON.stringify({ ETag: state.function.ETag, ContentType: "application/octet-stream" });
    }
    throw new Error("unexpected AWS read");
  };
  const collected = subject.collectLiveState(desired(), read, outputPath);
  assert.deepEqual(collected, state);
  assert.deepEqual(calls, ["cloudformation get-template", "cloudformation get-template",
    "cloudformation describe-stacks", "cloudformation list-stack-resources",
    "cloudfront describe-function", "cloudfront get-function", "cloudfront get-distribution-config"]);
});

test("manual query fence workflow defaults to review and separates validation from OIDC", () => {
  const workflow = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows",
    "deploy-thn-admin-query-fence-test.yml"), "utf8").replace(/\r\n/g, "\n");
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /options: \[review, execute, verify\]/);
  assert.match(workflow, /default: review/);
  assert.match(workflow, /expected_source_sha/);
  assert.match(workflow, /--method prepare-change-set/);
  assert.match(workflow, /- name: Preflight read-only proof\n\s+if: inputs\.execution != 'verify'/);
  assert.match(workflow, /^\s+THN_ADMIN_ORIGIN_ENABLED: \$\{\{ vars\.FRONTEND_TEST_THN_ADMIN_ORIGIN_ENABLED \|\| 'false' \}\}/m);
  assert.match(workflow, /thn-admin-query-fence-patch\.js/);
  assert.ok(!workflow.split("\n  validate:\n", 2)[1].split("\n  deploy:\n", 1)[0].includes("id-token: write"));
});

test("HTTP probe accepts four article pages and denies invalid locale queries", async () => {
  const requests = [];
  const fetcher = async url => {
    requests.push(url);
    return { status: url.includes("articleLocale=fr") || url.includes("unexpected=1")
      || url.includes("articleLocale=en&articleLocale=es") || url.includes("/admin/journal/access") ? 404 : 302 };
  };
  assert.equal(await subject.probeRoutes(fetcher, { attempts: 1, delayMs: 0 }), true);
  assert.equal(requests.length, 8);
  await assert.rejects(() => subject.probeRoutes(async () => ({ status: 200 }),
    { attempts: 1, delayMs: 0 }), /query_fence_route_probe_failed/);
});
