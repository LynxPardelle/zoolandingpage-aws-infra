"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { TARGETS, POLICY_NAME, supplementalResources } = require("../tools/thn-test-permission-policy");
const { sha, canonical } = require("../tools/thn-test-prerequisites");
const file = path.join(__dirname, "../tools/thn-test-permissions.js");
const api = () => { assert.ok(fs.existsSync(file), "missing separately guarded permissions runner"); return require(file); };
const account = "123456789012", sourceSha = "a".repeat(40), stackName = "ZoolandingTest-Zoolandingpage-test-ServiceRepositoryBootstrap";
const stackId = `arn:aws:cloudformation:us-east-1:${account}:stack/${stackName}/example-stack`;
const logicals = Object.keys(TARGETS);
const bytes = value => Buffer.from(JSON.stringify(value, null, 2) + "\n");

function fixture() {
  const original = { AWSTemplateFormatVersion: "2010-09-09", Metadata: { unchanged: "kept" },
    Parameters: { Existing: { Type: "String", NoEcho: true } }, Outputs: { Existing: { Value: "kept" } },
    Resources: {
      ImageCaller: { Type: "AWS::IAM::Role", Properties: { RoleName: TARGETS[logicals[1]], AssumeRolePolicyDocument: { original: true } } },
      ImageExecutor: { Type: "AWS::IAM::Role", Properties: { RoleName: TARGETS[logicals[2]], AssumeRolePolicyDocument: { original: true } } },
      Existing: { Type: "AWS::IAM::Policy", Properties: { PolicyName: "Original", PolicyDocument: { original: true }, Roles: ["kept"] } },
    } };
  const prepared = structuredClone(original);
  Object.assign(prepared.Resources, supplementalResources());
  prepared.Resources[logicals[1]].DependsOn = ["ImageCaller"];
  prepared.Resources[logicals[2]].DependsOn = ["ImageExecutor"];
  const config = { account, sourceSha, runId: "1234", runAttempt: "1",
    anchors: { account: sha(account), stacks: { "operator-role": sha(stackId) } } };
  const ledger = { schemaVersion: 1, environment: "test", domain: "thehairnarrative.com", sourceSha,
    stackIdSha256: sha(stackId), originalTemplateSha256: sha(canonical(original)), processedTemplateSha256: sha(canonical(original)),
    composedTemplateSha256: sha(canonical(prepared)), composedProcessedTemplateSha256: sha(canonical(prepared)),
    policyResourcesSha256: sha(canonical(supplementalResources())),
    roleBaselinesSha256: Object.fromEntries(logicals.map(key => [key, "b".repeat(64)])) };
  const name = "thn-permissions-1234-1", id = `arn:aws:cloudformation:us-east-1:${account}:changeSet/${name}/example-change`;
  const description = { StackName: stackName, StackId: stackId, ChangeSetName: name, ChangeSetId: id,
    Status: "CREATE_COMPLETE", ExecutionStatus: "AVAILABLE", IncludeNestedStacks: false,
    Parameters: [{ ParameterKey: "Existing", ParameterValue: "****" }],
    Changes: logicals.map(LogicalResourceId => ({ Type: "Resource", ResourceChange: { Action: "Add",
      LogicalResourceId, ResourceType: "AWS::IAM::RolePolicy", Replacement: "False" } })) };
  const expected = { account, stackId, name, id, original: prepared, processed: prepared,
    previousParameters: [{ ParameterKey: "Existing", ParameterValue: "****" }] };
  return { original, prepared, config, ledger, description, expected };
}

test("composition adds only the three fixed policies with existing Image-role dependencies", () => {
  const { original, prepared } = fixture(), before = canonical(original);
  assert.deepEqual(api().composeTemplate(original), prepared);
  assert.equal(canonical(original), before);
});
for (const kind of ["logical-collision", "same-name-policy", "missing-role", "duplicate-role", "transform"]) {
  test(`composition rejects ${kind}`, () => {
    const { original } = fixture();
    if (kind === "logical-collision") original.Resources[logicals[0]] = {};
    if (kind === "same-name-policy") original.Resources.Existing.Properties.PolicyName = POLICY_NAME;
    if (kind === "missing-role") delete original.Resources.ImageCaller;
    if (kind === "duplicate-role") original.Resources.Duplicate = structuredClone(original.Resources.ImageCaller);
    if (kind === "transform") original.Transform = "AWS::Serverless-2016-10-31";
    assert.throws(() => api().composeTemplate(original), /thn_permission_guard_failed/);
  });
}
test("ledger authenticates source, all templates, policy definitions and all three role baselines", () => {
  const { config, ledger } = fixture();
  assert.deepEqual(api().validateLedger(bytes(ledger), sha(bytes(ledger)), config), ledger);
});
for (const key of ["sourceSha", "environment", "domain", "stackIdSha256", "policyResourcesSha256", "roleBaselinesSha256", "extra"]) {
  test(`ledger rejects changed ${key}`, () => {
    const { config, ledger } = fixture();
    ledger[key] = key === "roleBaselinesSha256" ? {} : "unapproved";
    assert.throws(() => api().validateLedger(bytes(ledger), sha(bytes(ledger)), config), /thn_permission_guard_failed/);
  });
}
test("ledger rejects wrong external digest and noncanonical encoding", () => {
  const { config, ledger } = fixture();
  assert.throws(() => api().validateLedger(bytes(ledger), "c".repeat(64), config), /thn_permission_guard_failed/);
  const raw = Buffer.from(JSON.stringify(ledger));
  assert.throws(() => api().validateLedger(raw, sha(raw), config), /thn_permission_guard_failed/);
});
test("review accepts native three-Add responses without requiring a non-native RoleARN field", () => {
  const { description, expected } = fixture();
  assert.doesNotThrow(() => api().reviewChangeSet(description, expected.original, expected.processed, expected));
});
for (const kind of ["extra-add", "modify", "delete", "replacement", "nested", "wrong-type", "duplicate", "pagination", "template", "processed", "parameter", "stack", "create"]) {
  test(`review rejects ${kind}`, () => {
    const { description, expected } = fixture();
    let original = structuredClone(expected.original), processed = structuredClone(expected.processed);
    if (kind === "extra-add") description.Changes.push(structuredClone(description.Changes[0]));
    if (kind === "modify") description.Changes[0].ResourceChange.Action = "Modify";
    if (kind === "delete") description.Changes[0].ResourceChange.Action = "Remove";
    if (kind === "replacement") description.Changes[0].ResourceChange.Replacement = "True";
    if (kind === "nested") description.IncludeNestedStacks = true;
    if (kind === "wrong-type") description.Changes[0].ResourceChange.ResourceType = "AWS::IAM::Role";
    if (kind === "duplicate") description.Changes[1] = structuredClone(description.Changes[0]);
    if (kind === "pagination") description.NextToken = "more";
    if (kind === "template") original.Metadata.unchanged = "changed";
    if (kind === "processed") processed.Resources.Existing.Properties.PolicyDocument = {};
    if (kind === "parameter") description.Parameters[0].ParameterValue = "different";
    if (kind === "stack") description.StackId += "other";
    if (kind === "create") description.ChangeSetType = "CREATE";
    assert.throws(() => api().reviewChangeSet(description, original, processed, expected), /thn_permission_guard_failed/);
  });
}

test("role baseline includes stable identity, trust, original documents, tags and boundaries but not last-used timestamps", () => {
  const RoleName = TARGETS[logicals[0]], Role = { RoleName, Arn: `arn:aws:iam::${account}:role/${RoleName}`, RoleId: "AROAEXAMPLEROLEID12345",
    Path: "/", CreateDate: "2026-01-01T00:00:00Z", MaxSessionDuration: 3600, AssumeRolePolicyDocument: { Statement: [] }, Tags: [] };
  const input = { Role, inline: { Original: { Version: "2012-10-17", Statement: [] } }, attached: [] };
  const snapshot = api().roleSnapshot(input, RoleName, account);
  const changed = structuredClone(input);
  changed.Role.RoleLastUsed = { Region: "us-east-1", LastUsedDate: "2026-09-09T00:00:00Z" };
  assert.deepEqual(api().roleSnapshot(changed, RoleName, account), snapshot);
  changed.Role.RoleId = "AROAOTHERROLEID1234567";
  assert.notEqual(sha(canonical(api().roleSnapshot(changed, RoleName, account))), sha(canonical(snapshot)));
  changed.Role.PermissionsBoundary = { PermissionsBoundaryArn: "unapproved", PermissionsBoundaryType: "Policy" };
  assert.throws(() => api().roleSnapshot(changed, RoleName, account), /thn_permission_guard_failed/);
});

function authorityFixture() {
  const data = fixture(), authority = { account, region: "us-east-1", stackName };
  for (const [key, type] of [["lookup", "lookup"], ["deploy", "deploy"], ["publisher", "file-publishing"], ["cfn", "cfn-exec"]]) {
    authority[key] = `arn:aws:iam::${account}:role/cdk-example-${type}-role-${account}-us-east-1`;
    data.config.anchors[key] = sha(authority[key]);
  }
  authority.bucket = `cdk-example-assets-${account}-us-east-1`;
  data.config.anchors.bucket = sha(authority.bucket);
  return { ...data, authority };
}

test("transport authenticates exact inventory and coordinates without cloud credentials", () => {
  assert.equal(typeof api().writeTransport, "function");
  const { config, ledger, authority } = authorityFixture(), parent = fs.mkdtempSync(path.join(os.tmpdir(), "thn-policy-test-"));
  const directory = path.join(parent, "transport");
  try {
    const result = api().writeTransport(directory, bytes(ledger), sha(bytes(ledger)), authority, config);
    assert.equal(api().verifyTransport(directory, result.manifestSha256, config).ledger.sourceSha, config.sourceSha);
    assert.ok(!fs.readFileSync(path.join(directory, "authority.json"), "utf8").includes("secret"));
    assert.throws(() => api().writeTransport(directory, bytes(ledger), sha(bytes(ledger)), authority, config), /thn_permission_guard_failed/);
  } finally { fs.rmSync(parent, { recursive: true }); }
});
for (const mutation of ["file", "extra-file", "source", "attempt", "manifest"]) {
  test(`transport rejects changed ${mutation}`, () => {
    assert.equal(typeof api().writeTransport, "function");
    const { config, ledger, authority } = authorityFixture(), parent = fs.mkdtempSync(path.join(os.tmpdir(), "thn-policy-test-"));
    const directory = path.join(parent, "transport");
    try {
      const result = api().writeTransport(directory, bytes(ledger), sha(bytes(ledger)), authority, config);
      if (mutation === "file") fs.appendFileSync(path.join(directory, "thn-test-permission-policy.js"), "\n// changed\n");
      if (mutation === "extra-file") fs.writeFileSync(path.join(directory, "extra"), "changed");
      if (mutation === "source") config.sourceSha = "e".repeat(40);
      if (mutation === "attempt") config.runAttempt = "2";
      if (mutation === "manifest") result.manifestSha256 = "e".repeat(64);
      assert.throws(() => api().verifyTransport(directory, result.manifestSha256, config), /thn_permission_guard_failed/);
    } finally { fs.rmSync(parent, { recursive: true }); }
  });
}

test("sessions use only existing sealed identities without changing original credential environment", () => {
  assert.equal(typeof api().createClients, "function");
  const { config, authority } = authorityFixture(), env = { AWS_PROFILE: "test-example" }, calls = [];
  let authenticated = 0;
  const client = api().createClients(authority, { ...config, env, authenticate: () => authenticated++, aws: (service, operation, input, childEnv) => {
    calls.push({ service, operation, input, childEnv: { ...childEnv } });
    if (service === "sts") return { AssumedRoleUser: { Arn: `arn:aws:sts::${account}:assumed-role/${input.RoleArn.split("/").at(-1)}/${input.RoleSessionName}` },
      Credentials: { AccessKeyId: "ASIA" + "Q".repeat(16), SecretAccessKey: "S".repeat(40), SessionToken: "test-token",
        Expiration: new Date(Date.now() + 3500000).toISOString() } };
    return {};
  } });
  client("lookup", "iam", "get-role", { RoleName: TARGETS[logicals[0]] });
  assert.equal(calls[0].input.RoleArn, authority.lookup);
  assert.equal(calls[1].childEnv.AWS_PROFILE, undefined);
  assert.equal(env.AWS_PROFILE, "test-example");
  assert.equal(env.AWS_ACCESS_KEY_ID, undefined);
  assert.ok(authenticated > 0);
});
for (const [kind, service, operation, input] of [
  ["lookup", "iam", "put-role-policy", { RoleName: TARGETS[logicals[0]] }],
  ["lookup", "iam", "get-role", { RoleName: "unapproved" }],
  ["deploy", "cloudformation", "delete-stack", { StackName: stackId }],
  ["deploy", "cloudformation", "update-termination-protection", { StackName: stackId, EnableTerminationProtection: false }],
  ["deploy", "cloudformation", "get-template", { StackName: "other-stack" }],
  ["publisher", "s3api", "put-object", { Bucket: "other-bucket", ExpectedBucketOwner: account, Key: "bad" }],
]) {
  test(`client rejects out-of-bound ${service}:${operation} before AWS`, () => {
    assert.equal(typeof api().createClients, "function");
    const { config, authority } = authorityFixture();
    let calls = 0;
    const client = api().createClients(authority, { ...config, authenticate: () => {}, aws: () => { calls++; } });
    assert.throws(() => client(kind, service, operation, input), /thn_permission_guard_failed/);
    assert.equal(calls, 0);
  });
}

test("entrypoint rejects unapproved source or invocation before reading artifacts or cloud access", async () => {
  assert.equal(typeof api().main, "function");
  for (const env of [{}, { GITHUB_ACTIONS: "true", GITHUB_REF: "refs/heads/main" },
    { GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/test",
      GITHUB_REPOSITORY: "LynxPardelle/zoolandingpage-aws-infra", APPROVE_EXACT_PERMISSIONS: "false" }]) {
    await assert.rejects(api().main(["run", "missing-artifact"], env), /thn_permission_guard_failed/);
  }
});

for (const [service, operation, input] of [
  ["cloudformation", "create-change-set", { StackName: stackId, ChangeSetName: "thn-permissions-1234-1", ChangeSetType: "UPDATE",
    ClientToken: "thn-permissions-1234-1", IncludeNestedStacks: false, Capabilities: ["CAPABILITY_NAMED_IAM"], Parameters: [],
    NotificationARNs: ["unapproved"] }],
  ["cloudformation", "execute-change-set", { StackName: stackName, ChangeSetName: `arn:aws:cloudformation:us-east-1:${account}:changeSet/thn-permissions-1234-1/example-change`,
    ClientRequestToken: "thn-permissions-1234-1" }],
  ["cloudformation", "execute-change-set", { StackName: stackId, ChangeSetName: `arn:aws:cloudformation:us-east-1:${account}:changeSet/thn-permissions-1234-1/example-change`,
    ClientRequestToken: "thn-permissions-1234-1", DisableRollback: true }],
]) {
  test(`closed client refuses additional side effects or name-only execution: ${operation} ${Object.keys(input).at(-1)}`, () => {
    const { config, authority } = authorityFixture();
    if (operation === "create-change-set") {
      input.RoleARN = authority.cfn;
      input.TemplateURL = `https://${authority.bucket}.s3.us-east-1.amazonaws.com/thn-permissions/1234/1/${sourceSha}/${"b".repeat(64)}.json`;
    }
    let calls = 0;
    const client = api().createClients(authority, { ...config, authenticate: () => {}, aws: () => { calls++; } });
    assert.throws(() => client("deploy", service, operation, input), /thn_permission_guard_failed/);
    assert.equal(calls, 0);
  });
}

test("native-shaped runner protects, prepares, reviews and verifies only three additive policies", async () => {
  assert.equal(typeof api().runPermissions, "function");
  const { runnerFixture } = require("./fixtures/thn-permission-runner");
  const data = runnerFixture(authorityFixture(), api());
  const result = await api().runPermissions(data.ledger, data.authority, data.config);
  assert.equal(result.status, "verified");
  assert.equal(result.addedPolicies, 3);
  const writes = data.calls.filter(call => ["update-termination-protection", "put-object", "create-change-set", "execute-change-set"].includes(call.action));
  assert.deepEqual(writes.map(call => call.action), ["update-termination-protection", "put-object", "create-change-set", "execute-change-set"]);
  assert.ok(!data.calls.some(call => call.service === "iam" && call.action.startsWith("put")));
  const create = writes.find(call => call.action === "create-change-set").input;
  assert.equal(create.ChangeSetType, "UPDATE");
  assert.deepEqual(create.Parameters, [{ ParameterKey: "Existing", UsePreviousValue: true }]);
});
for (const scenario of ["extra-add", "role-drift", "corrupt-object", "final-policy"]) {
  test(`runner stops on ${scenario} without claiming verification`, async () => {
    assert.equal(typeof api().runPermissions, "function");
    const { runnerFixture } = require("./fixtures/thn-permission-runner");
    const data = runnerFixture(authorityFixture(), api(), scenario);
    await assert.rejects(api().runPermissions(data.ledger, data.authority, data.config), /thn_permission_guard_failed/);
    assert.equal(data.calls.filter(call => call.action === "execute-change-set").length, scenario === "final-policy" ? 1 : 0);
  });
}

test("runner recognizes a completed native rollback immediately instead of polling toward a false success", async () => {
  const { runnerFixture } = require("./fixtures/thn-permission-runner");
  const data = runnerFixture(authorityFixture(), api(), "rollback");
  await assert.rejects(api().runPermissions(data.ledger, data.authority, data.config), /thn_permission_guard_failed/);
  const afterExecute = data.calls.slice(data.calls.findIndex(call => call.action === "execute-change-set") + 1);
  assert.equal(afterExecute.filter(call => call.action === "describe-stacks").length, 1);
});

test("runner waits through stale AVAILABLE after execution without issuing another execution", async () => {
  const { runnerFixture } = require("./fixtures/thn-permission-runner");
  const data = runnerFixture(authorityFixture(), api(), "stale-available");
  const result = await api().runPermissions(data.ledger, data.authority, data.config);
  assert.equal(result.status, "verified");
  const afterExecute = data.calls.slice(data.calls.findIndex(call => call.action === "execute-change-set") + 1);
  assert.equal(afterExecute.filter(call => call.action === "describe-change-set").length, 2);
  assert.equal(data.calls.filter(call => call.action === "execute-change-set").length, 1);
  assert.equal(result.originalRolesPreserved, true);
});

test("runner never treats permanently AVAILABLE as completed and stops at the poll bound", async () => {
  const { runnerFixture } = require("./fixtures/thn-permission-runner");
  const data = runnerFixture(authorityFixture(), api(), "stuck-available");
  await assert.rejects(api().runPermissions(data.ledger, data.authority, data.config), /thn_permission_guard_failed/);
  const afterExecute = data.calls.slice(data.calls.findIndex(call => call.action === "execute-change-set") + 1);
  assert.equal(afterExecute.filter(call => call.action === "describe-change-set").length, data.config.maxPolls);
  assert.equal(data.calls.filter(call => call.action === "execute-change-set").length, 1);
});

for (const scenario of ["execution-EXECUTE_FAILED", "execution-OBSOLETE", "execution-UNAVAILABLE", "execution-UNKNOWN", "change-set-failed", "execution-identity"]) {
  test(`execution polling fails closed immediately on ${scenario}`, async () => {
    const { runnerFixture } = require("./fixtures/thn-permission-runner");
    const data = runnerFixture(authorityFixture(), api(), scenario);
    await assert.rejects(api().runPermissions(data.ledger, data.authority, data.config), /thn_permission_guard_failed/);
    const afterExecute = data.calls.slice(data.calls.findIndex(call => call.action === "execute-change-set") + 1);
    assert.equal(afterExecute.filter(call => call.action === "describe-change-set").length, 1);
    assert.equal(data.calls.filter(call => call.action === "execute-change-set").length, 1);
  });
}

test("permissions workflow is separate, TEST-only and authenticates artifact before OIDC", () => {
  const file = path.join(__dirname, "../.github/workflows/thn-test-permissions.yml");
  assert.ok(fs.existsSync(file), "missing separate TEST permissions workflow");
  const workflow = fs.readFileSync(file, "utf8");
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /\n  push:/);
  assert.match(workflow, /environment: test/);
  assert.match(workflow, /test "\$GITHUB_REF" = refs\/heads\/test/);
  assert.match(workflow, /test "\$second_parent" = "\$\(git rev-parse refs\/remotes\/origin\/dev\)"/);
  assert.match(workflow, /group: zoolandingpage-aws-infra-test-frontend/);
  assert.match(workflow, /artifact-ids:.*needs\.validate\.outputs\.artifact_id/);
  const execute = workflow.split("\n  execute:")[1];
  assert.ok(execute);
  assert.doesNotMatch(execute, /actions\/checkout|npm |cdk synth/);
  assert.ok(execute.indexOf("sha256sum --check --strict") < execute.indexOf("node .transport/thn-test-permissions.js verify"));
  assert.ok(execute.indexOf("node .transport/thn-test-permissions.js verify") < execute.indexOf("aws-actions/configure-aws-credentials"));
  assert.match(execute, /node .transport\/thn-test-permissions.js run .transport/);
  assert.doesNotMatch(workflow, /THN_TEST_OPERATOR_PRINCIPAL_ARN|\n  pull_request_target:|cloudformation delete|iam put-role/);
});
