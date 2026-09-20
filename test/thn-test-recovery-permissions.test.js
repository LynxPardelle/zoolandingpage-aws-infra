"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { sha, canonical } = require("../tools/thn-test-prerequisites");
const policy = require("../tools/thn-test-recovery-permission-policy");
const { fixture, original, runtimeFixture, correctedRuntimeFixture } = require("./fixtures/thn-recovery-bindings");
const file = path.join(__dirname, "../tools/thn-test-recovery-permissions.js");
const api = () => { assert.ok(fs.existsSync(file), "missing exact recovery permission revision runner"); return require(file); };
const hash = value => sha(canonical(value));
const resolved = (document, values, service, account) => ["image-version", "hub-version"].includes(service)
  ? require("../tools/thn-test-permissions").resolvedPolicy(document, account) : policy.resolve(document, values);
function setup(service = "config") {
  const { binding, config } = service === "api-runtime" ? runtimeFixture()
    : service === "api-runtime-corrected" ? correctedRuntimeFixture() : fixture(service), p = policy.TARGETS[service];
  config.sourceSha = "1".repeat(40); config.runId = "123"; config.runAttempt = "1";
  const stackName = "ZoolandingTest-Zoolandingpage-test-" + (service.startsWith("config") ? "Frontend" : "ServiceRepositoryBootstrap");
  const stackId = `arn:aws:cloudformation:us-east-1:${config.account}:stack/${stackName}/synthetic`;
  const authority = { account: config.account, region: "us-east-1", stackName, bucket: `cdk-synthetic-assets-${config.account}-us-east-1`,
    ...Object.fromEntries([["lookup", "lookup"], ["deploy", "deploy"], ["publisher", "file-publishing"], ["cfn", "cfn-exec"]]
      .map(([key, name]) => [key, `arn:aws:iam::${config.account}:role/cdk-synthetic-${name}-role-${config.account}-us-east-1`])) };
  config.authorityAnchors = { account: sha(config.account), stacks: { [p.owner]: sha(stackId) },
    ...Object.fromEntries(["bucket", "lookup", "deploy", "publisher", "cfn"].map(k => [k, sha(authority[k])])) };
  const role = { Role: { RoleName: p.role, Arn: `arn:aws:iam::${config.account}:role/${p.role}`, Path: "/",
    RoleId: "AROA" + "Q".repeat(16), AssumeRolePolicyDocument: { Statement: [] } }, inline: { Existing: { Statement: [] } }, attached: [] };
  const before = original(service);
  if (["image-version", "hub-version"].includes(service)) role.inline[p.policyName] = resolved(before.Resources[p.logical].Properties.PolicyDocument, {}, service, config.account);
  if (["api-runtime", "api-runtime-corrected", "config-runtime"].includes(service)) {
    before.Resources.PriorRecovery = { Type: "AWS::IAM::RolePolicy", Properties: {
      RoleName: p.role, PolicyName: policy.POLICY_NAME, PolicyDocument: { Statement: [] } } };
    role.inline[policy.POLICY_NAME] = { Statement: [] };
  }
  if (service === "api-runtime-corrected") {
    Object.assign(before.Parameters, policy.parameterDefinitions("api-runtime"));
    before.Resources.ThnApiRuntimeProvisioningPolicy = { Type: "AWS::IAM::RolePolicy", Properties: {
      RoleName: p.role, PolicyName: "ThnTestRuntimeProvisioningV1", PolicyDocument: { Statement: [] } } };
    role.inline.ThnTestRuntimeProvisioningV1 = { Statement: [] };
  }
  const after = policy.composeTemplate(before, service);
  const ledger = { schemaVersion: 1, service, environment: "test", domain: "thehairnarrative.com", sourceSha: config.sourceSha,
    ownerStackSha256: sha(stackId), serviceStackSha256: sha(binding.stackId), bindingSha256: hash(binding),
    originalSha256: hash(before), processedSha256: hash(before), composedSha256: hash(after), composedProcessedSha256: hash(after),
    roleSha256: hash(role), resolvedPolicySha256: hash(resolved(policy.policyResource(service).Properties.PolicyDocument,
      policy.validateBindings(binding, config), service, config.account)) };
  config.expectedLedgerSha256 = hash(ledger);
  return { binding, config, authority, stackId, before, after, ledger, role };
}

test("revision validates independently reviewed hashes and exactly one owning Add", () => {
  const module = api(), value = setup();
  assert.deepEqual(module.validateLedger(value.ledger, value.config), value.ledger);
  const expected = module.prepareRevision(value.before, value.before, value.binding, value.ledger, value.config);
  assert.deepEqual(expected.original, value.after);
  assert.equal(expected.parameters.filter(p => p.UsePreviousValue).length, 1);
  assert.equal(expected.parameters.find(p => p.ParameterKey === "ExistingSecret").UsePreviousValue, true);
  assert.equal(expected.parameters.length, 6);
});

test("native review rejects no-op, removal, replacement, wrong role and unmasked private parameters", () => {
  const module = api(), v = setup();
  const prepared = module.prepareRevision(v.before, v.before, v.binding, v.ledger, v.config);
  const name = `thn-recovery-permissions-config-${v.config.runId}-${v.config.runAttempt}`;
  const id = `arn:aws:cloudformation:us-east-1:${v.config.account}:changeSet/${name}/synthetic`;
  const expected = { ...v, ...prepared, name, id, previousParameters: [{ ParameterKey: "ExistingSecret", ParameterValue: "****" }] };
  const description = { StackName: v.authority.stackName, StackId: v.stackId, ChangeSetName: name, ChangeSetId: id,
    RoleARN: v.authority.cfn, Status: "CREATE_COMPLETE", ExecutionStatus: "AVAILABLE", Changes: [
      { Type: "Resource", ResourceChange: { Action: "Add", ResourceType: "AWS::IAM::RolePolicy", LogicalResourceId: policy.TARGETS.config.logical } }],
    Parameters: prepared.parameters.map(p => ({ ParameterKey: p.ParameterKey, ParameterValue: "****" })) };
  assert.doesNotThrow(() => module.reviewChangeSet(description, prepared.original, prepared.processed, expected));
  for (const mutate of [d => d.Changes = [], d => d.Changes[0].ResourceChange.Action = "Remove",
    d => d.Changes[0].ResourceChange.Replacement = "True", d => d.RoleARN += "foreign",
    d => d.Parameters[1].ParameterValue = "unmasked-private", d => d.StackId += "foreign",
    d => d.NextToken = "more"] ) {
    const changed = structuredClone(description); mutate(changed);
    assert.throws(() => module.reviewChangeSet(changed, prepared.original, prepared.processed, expected), /recovery_permission/);
  }
});

test("sealed transport excludes private binding values and rejects substitution before credentials", () => {
  assert.equal(typeof api().writeTransport, "function");
  const v = setup(), os = require("node:os"), parent = fs.mkdtempSync(path.join(os.tmpdir(), "thn-revision-test-"));
  const directory = path.join(parent, "transport");
  try {
    const receipt = api().writeTransport(directory, v.ledger, v.authority, v.config);
    assert.equal(api().verifyTransport(directory, receipt.manifestSha256, v.config).ledger.service, "config");
    for (const entry of fs.readdirSync(directory)) {
      const text = fs.readFileSync(path.join(directory, entry), "utf8");
      assert.ok(!text.includes(v.binding.package.versionId) && !text.includes(v.binding.record.key));
    }
    fs.appendFileSync(path.join(directory, "thn-test-recovery-permission-policy.js"), "\n// substitute\n");
    assert.throws(() => api().verifyTransport(directory, receipt.manifestSha256, v.config), /recovery_permission/);
  } finally { fs.rmSync(parent, { recursive: true }); }
});

test("closed AWS transport rejects unrelated write and preserves the caller environment", () => {
  assert.equal(typeof api().createClients, "function");
  const v = setup(), env = { AWS_PROFILE: "synthetic" }, calls = [];
  const client = api().createClients(v.authority, v.binding, v.ledger, { ...v.config, env, authenticate: () => true,
    aws: (service, action, input, isolated) => {
      calls.push({ service, action, input, isolated });
      if (service === "sts") return { AssumedRoleUser: { Arn: `arn:aws:sts::${v.config.account}:assumed-role/${input.RoleArn.split("/").at(-1)}/${input.RoleSessionName}` },
        Credentials: { AccessKeyId: "ASIA" + "Q".repeat(16), SecretAccessKey: "S".repeat(40), SessionToken: "synthetic-token",
          Expiration: new Date(Date.now() + 3500000).toISOString() } };
      return {};
    } });
  client("lookup", "iam", "get-role", { RoleName: policy.TARGETS.config.role });
  assert.equal(calls[1].isolated.AWS_PROFILE, undefined);
  assert.deepEqual(env, { AWS_PROFILE: "synthetic" });
  for (const [kind, service, action, input] of [
    ["deploy", "iam", "put-role-policy", {}], ["deploy", "cloudformation", "delete-stack", { StackName: v.stackId }],
    ["lookup", "iam", "get-role", { RoleName: "unrelated" }],
    ["lookup", "cloudformation", "describe-stacks", { StackName: "production" }],
    ["deploy", "cloudformation", "create-change-set", { StackName: v.stackId, RoleARN: "foreign" }]]) {
    const before = calls.length;
    assert.throws(() => client(kind, service, action, input), /recovery_permission/);
    assert.equal(calls.length, before);
  }
});

module.exports = { setup };

function authEnableSetup() {
  const v = setup("auth-enable"), aws = revisionAWS(v), delegate = aws.aws;
  const selected = policy.TARGETS["auth-enable"], arn = `arn:aws:iam::${v.config.account}:policy/${selected.policyName}`;
  aws.aws = (...args) => {
    const [, action, input] = args;
    if (action === "get-policy") return {Policy: {Arn: arn, PolicyName: selected.policyName, Path: "/", DefaultVersionId: "v1", AttachmentCount: 1, PermissionsBoundaryUsageCount: 0}};
    if (action === "get-policy-version") return {PolicyVersion: {VersionId: "v1", IsDefaultVersion: true,
      Document: resolved(policy.policyResource("auth-enable").Properties.PolicyDocument, policy.validateBindings(v.binding, v.config), "auth-enable", v.config.account)}};
    if (action === "list-entities-for-policy") return {PolicyRoles: [{RoleName: selected.role, RoleId: aws.role.Role.RoleId}], PolicyUsers: [], PolicyGroups: [], IsTruncated: false};
    const r = delegate(...args);
    if (action === "describe-stacks" && input.StackName === v.binding.stackId) Object.assign(r.Stacks[0], {
      EnableTerminationProtection: true, Parameters: [{ParameterKey: "ProvisionThnAuthAdminV2State", ParameterValue: "true"},
        {ParameterKey: "EnableThnAuthAdminV2", ParameterValue: "false"}]});
    if (action === "describe-change-set") r.Changes[0].ResourceChange.ResourceType = "AWS::IAM::ManagedPolicy";
    if (action === "execute-change-set") delete aws.role.inline[selected.policyName];
    if (action === "list-attached-role-policies" && aws.executed) r.AttachedPolicies = [{PolicyName: selected.policyName, PolicyArn: arn}];
    if (action === "describe-stack-resource") Object.assign(r.StackResourceDetail, {ResourceType: "AWS::IAM::ManagedPolicy", PhysicalResourceId: arn});
    return r;
  };
  return {v, aws};
}

test("Auth enable applies one managed policy and preserves every original inline policy and role", async () => {
  const {v, aws} = authEnableSetup(), before = structuredClone(aws.role);
  const config = {...v.config, aws: aws.aws, authenticate: () => true, execute: false, delay: async () => {}, maxPolls: 3};
  assert.equal((await api().runRevision(v.ledger, v.binding, v.authority, config)).status, "verified");
  assert.deepEqual(aws.writes, []);
  assert.equal((await api().runRevision(v.ledger, v.binding, v.authority, {...config, execute: true})).status, "applied");
  assert.deepEqual(aws.role, before);
  assert.deepEqual(aws.template, v.after);
  assert.deepEqual(aws.writes, ["put-object", "create-change-set", "execute-change-set"]);
});

test("Auth enable rejects lifecycle drift, collateral changes, foreign attachment and broadened readback", async () => {
  for (const mutate of [
    (r,a) => {if (a === "describe-stacks" && r.Stacks[0].StackName === "zoolanding-auth-admin-test") r.Stacks[0].EnableTerminationProtection = false;},
    (r,a) => {if (a === "describe-stacks" && r.Stacks[0].Parameters?.[0]?.ParameterKey === "ProvisionThnAuthAdminV2State") r.Stacks[0].Parameters[0].ParameterValue = "false";},
    (r,a) => {if (a === "describe-change-set") r.Changes.push(structuredClone(r.Changes[0]));},
    (r,a) => {if (a === "list-attached-role-policies") r.AttachedPolicies.push({PolicyName: "foreign", PolicyArn: "foreign"});},
    (r,a) => {if (a === "get-policy-version") r.PolicyVersion.Document.Statement[0].Resource = "*";},
    (r,a) => {if (a === "list-entities-for-policy") r.PolicyUsers.push({UserName: "foreign"});},
  ]) {
    const {v, aws} = authEnableSetup(), delegate = aws.aws;
    aws.aws = (...args) => {const r = delegate(...args); mutate(r,args[1]); return r;};
    await assert.rejects(api().runRevision(v.ledger,v.binding,v.authority,{...v.config,aws:aws.aws,authenticate:()=>true,execute:true,delay:async()=>{},maxPolls:3}));
  }
});

test("Auth managed-policy reads cannot select another policy, version or mutate IAM", () => {
  const {v, aws} = authEnableSetup();
  const client = api().createClients(v.authority,v.binding,v.ledger,{...v.config,aws:aws.aws,authenticate:()=>true});
  const PolicyArn = `arn:aws:iam::${v.config.account}:policy/ThnTestAuthEnableV1`;
  assert.equal(client("lookup","iam","get-policy",{PolicyArn}).Policy.Arn, PolicyArn);
  for (const [action,input] of [["get-policy",{PolicyArn:PolicyArn+"foreign"}],
    ["get-policy-version",{PolicyArn,VersionId:"v4"}], ["attach-role-policy",{PolicyArn,RoleName:"foreign"}],
    ["list-entities-for-policy",{PolicyArn,EntityFilter:"Role"}]])
    assert.throws(()=>client("lookup","iam",action,input));
});

function authEnableModifySetup() {
  const v = setup("auth-enable"), selected = policy.TARGETS["auth-enable"];
  const authEnable = require("../tools/thn-test-auth-enable-permission-policy");
  const arn = authEnable.policyArn(v.config.account);
  v.before = policy.composeTemplate(v.before, "auth-enable");
  v.before.Resources[selected.logical] = authEnable.previousPolicyResource();
  v.after = policy.composeTemplate(v.before, "auth-enable");
  v.role.attached = [{PolicyName: selected.policyName, PolicyArn: arn}];
  Object.assign(v.ledger, {originalSha256: hash(v.before), processedSha256: hash(v.before),
    composedSha256: hash(v.after), composedProcessedSha256: hash(v.after), roleSha256: hash(v.role)});
  v.config.expectedLedgerSha256 = hash(v.ledger);
  const previous = resolved(authEnable.previousPolicyResource().Properties.PolicyDocument,
    policy.validateBindings(v.binding, v.config), "auth-enable", v.config.account);
  const next = resolved(authEnable.policyResource().Properties.PolicyDocument,
    policy.validateBindings(v.binding, v.config), "auth-enable", v.config.account);
  const aws = revisionAWS(v), delegate = aws.aws;
  aws.owner.Parameters = Object.keys(v.before.Parameters).map(ParameterKey => ({ParameterKey, ParameterValue: "****"}));
  aws.aws = (...args) => {
    const [, action, input] = args;
    if (action === "get-policy") return {Policy: {Arn: arn, PolicyName: selected.policyName, Path: "/",
      DefaultVersionId: aws.executed ? "v3" : "v2", AttachmentCount: 1, PermissionsBoundaryUsageCount: 0}};
    if (action === "get-policy-version") return {PolicyVersion: {VersionId: input.VersionId, IsDefaultVersion: true,
      Document: structuredClone(aws.executed ? next : previous)}};
    if (action === "list-entities-for-policy") return {PolicyRoles: [{RoleName: selected.role, RoleId: aws.role.Role.RoleId}],
      PolicyUsers: [], PolicyGroups: [], IsTruncated: false};
    const result = delegate(...args);
    if (action === "describe-stacks" && input.StackName === v.binding.stackId) Object.assign(result.Stacks[0], {
      StackStatus: "UPDATE_ROLLBACK_COMPLETE", EnableTerminationProtection: true,
      Parameters: [{ParameterKey: "ProvisionThnAuthAdminV2State", ParameterValue: "true"},
        {ParameterKey: "EnableThnAuthAdminV2", ParameterValue: "false"}]});
    if (action === "list-attached-role-policies") result.AttachedPolicies = structuredClone(v.role.attached);
    if (action === "describe-change-set") Object.assign(result.Changes[0].ResourceChange,
      {Action: "Modify", ResourceType: "AWS::IAM::ManagedPolicy", Replacement: "False", PhysicalResourceId: arn});
    if (action === "describe-stack-resource") Object.assign(result.StackResourceDetail,
      {ResourceType: "AWS::IAM::ManagedPolicy", PhysicalResourceId: arn, ResourceStatus: "UPDATE_COMPLETE"});
    if (action === "execute-change-set") delete aws.role.inline[selected.policyName];
    return result;
  };
  return {v, aws};
}

test("Auth managed-policy logging correction updates only v2 to v3 while Auth stays disabled", async () => {
  const {v, aws} = authEnableModifySetup(), before = structuredClone(aws.role);
  const config = {...v.config, aws: aws.aws, authenticate: () => true, execute: false, delay: async () => {}, maxPolls: 3};
  assert.equal((await api().runRevision(v.ledger, v.binding, v.authority, config)).status, "verified");
  assert.deepEqual(aws.writes, []);
  const result = await api().runRevision(v.ledger, v.binding, v.authority, {...config, execute: true});
  assert.equal(result.modifiedPolicies, 1);
  assert.deepEqual(aws.role, before);
  assert.deepEqual(aws.template, v.after);
  assert.deepEqual(aws.writes, ["put-object", "create-change-set", "execute-change-set"]);
});

test("Auth repair stops before writes on another attachment, policy version or service state", async () => {
  for (const mutate of [
    (r, a) => {if (a === "list-attached-role-policies") r.AttachedPolicies.push({PolicyName: "Foreign", PolicyArn: "foreign"});},
    (r, a) => {if (a === "get-policy") r.Policy.DefaultVersionId = "v1";},
    (r, a) => {if (a === "describe-stacks" && r.Stacks?.[0]?.StackName === "zoolanding-auth-admin-test") r.Stacks[0].Parameters[0].ParameterValue = "false";},
  ]) {
    const {v, aws} = authEnableModifySetup(), delegate = aws.aws;
    aws.aws = (...args) => {const result = delegate(...args); mutate(result, args[1], args[2]); return result;};
    await assert.rejects(api().runRevision(v.ledger, v.binding, v.authority,
      {...v.config, aws: aws.aws, authenticate: () => true, execute: true, delay: async () => {}, maxPolls: 3}));
    assert.deepEqual(aws.writes, []);
  }
});

function revisionAWS(v) {
  const roleName = policy.TARGETS[v.config.service].role, selected = policy.TARGETS[v.config.service];
  const kms = `arn:aws:kms:us-east-1:${v.config.account}:key/synthetic`, bucketPolicy = { Statement: [{ Effect: "Deny", Action: "s3:*", Resource: "synthetic" }] };
  v.config.authorityAnchors.kmsKey = sha(kms); v.config.authorityAnchors.bucketPolicy = hash(bucketPolicy);
  const state = { writes: [], owner: { StackName: v.authority.stackName, StackId: v.stackId,
    StackStatus: "UPDATE_COMPLETE", RoleARN: v.authority.cfn, EnableTerminationProtection: true,
    Parameters: Object.keys(v.before.Parameters).map(ParameterKey => ({ ParameterKey, ParameterValue: "****" })) },
    template: structuredClone(v.before), role: structuredClone(v.role), object: null, executed: false, hook: null };
  state.aws = (service, action, input, env, outputFile) => {
    if (service === "sts") return { AssumedRoleUser: { Arn: `arn:aws:sts::${v.config.account}:assumed-role/${input.RoleArn.split("/").at(-1)}/${input.RoleSessionName}` },
      Credentials: { AccessKeyId: "ASIA" + "Q".repeat(16), SecretAccessKey: "S".repeat(40), SessionToken: "synthetic-token",
        Expiration: new Date(Date.now() + 3500000).toISOString() } };
    if (action === "describe-stacks") return { Stacks: [input.StackName === v.binding.stackId
      ? { StackName: selected.service, StackId: v.binding.stackId, StackStatus: "UPDATE_COMPLETE", ...(v.config.service === "auth-provision"
        ? {EnableTerminationProtection: true, Parameters: [{ParameterKey: "EnableThnAuthAdminV2", ParameterValue: "false"}]} : {}) } : structuredClone(state.owner)] };
    if (action === "get-template") return { TemplateBody: structuredClone(input.ChangeSetName ? state.pending : state.template) };
    if (action === "get-role") return { Role: input.RoleName === roleName ? structuredClone(state.role.Role)
      : { Arn: v.authority.cfn, AssumeRolePolicyDocument: { Version: "2012-10-17", Statement: [
        { Effect: "Allow", Action: "sts:AssumeRole", Principal: { Service: "cloudformation.amazonaws.com" } }] } } };
    if (action === "list-role-policies") return { PolicyNames: Object.keys(state.role.inline) };
    if (action === "list-attached-role-policies") return { AttachedPolicies: [] };
    if (action === "get-role-policy") return { ...input, PolicyDocument: structuredClone(state.role.inline[input.PolicyName]) };
    if (action === "head-object") return { VersionId: input.VersionId, ContentLength: 100 };
    if (action === "get-bucket-acl") return { Owner: { ID: "owner" }, Grants: [{ Grantee: { ID: "owner", Type: "CanonicalUser" }, Permission: "FULL_CONTROL" }] };
    if (action === "get-bucket-policy") return { Policy: JSON.stringify(bucketPolicy) };
    if (action === "get-bucket-encryption") return { ServerSideEncryptionConfiguration: { Rules: [
      { ApplyServerSideEncryptionByDefault: { SSEAlgorithm: "aws:kms", KMSMasterKeyID: kms } }] } };
    if (action === "describe-key") return { KeyMetadata: { Arn: kms, KeyId: "synthetic", KeyManager: "AWS", Enabled: true, KeyState: "Enabled" } };
    if (action === "put-object") { state.writes.push(action); state.object = fs.readFileSync(input.Body); return {}; }
    if (action === "get-object") {
      fs.writeFileSync(outputFile, state.object);
      return { ServerSideEncryption: "aws:kms", SSEKMSKeyId: kms, ChecksumSHA256: Buffer.from(sha(state.object), "hex").toString("base64") };
    }
    if (action === "create-change-set") {
      state.writes.push(action); state.pending = JSON.parse(state.object); state.name = input.ChangeSetName;
      state.id = `arn:aws:cloudformation:us-east-1:${v.config.account}:changeSet/${state.name}/synthetic`;
      state.parameters = input.Parameters.map(p => ({ ParameterKey: p.ParameterKey, ParameterValue: "****" }));
      return { StackId: v.stackId, Id: state.id };
    }
    if (action === "describe-change-set") {
      const result = { StackName: v.authority.stackName, StackId: v.stackId, ChangeSetName: state.name, ChangeSetId: state.id,
        Status: "CREATE_COMPLETE", ExecutionStatus: state.executed ? "EXECUTE_COMPLETE" : "AVAILABLE",
        Parameters: state.parameters, Changes: [{ Type: "Resource", ResourceChange: { Action: "Add", ResourceType: "AWS::IAM::RolePolicy",
          LogicalResourceId: selected.logical } }] };
      if (state.hook) state.hook(result);
      return result;
    }
    if (action === "execute-change-set") {
      state.writes.push(action); state.executed = true; state.template = state.pending; state.owner.Parameters = state.parameters;
      state.role.inline[policy.policyName(v.config.service)] = resolved(policy.policyResource(v.config.service).Properties.PolicyDocument,
        policy.validateBindings(v.binding, v.config), v.config.service, v.config.account);
      return {};
    }
    if (action === "describe-stack-resource") return { StackResourceDetail: input.StackName === v.binding.stackId
      ? { StackId: v.binding.stackId, StackName: selected.service, LogicalResourceId: input.LogicalResourceId,
        ResourceType: v.config.service === "api-runtime" ? "AWS::ApiGateway::RestApi" : "AWS::Lambda::Function", ResourceStatus: "UPDATE_COMPLETE",
        PhysicalResourceId: v.config.service === "api-runtime" ? v.binding.runtime.apiId : v.binding.functions[input.LogicalResourceId].split(":").at(-1) }
      : { StackId: v.stackId, StackName: v.authority.stackName, LogicalResourceId: selected.logical,
        ResourceType: "AWS::IAM::RolePolicy", ResourceStatus: "CREATE_COMPLETE", PhysicalResourceId: "synthetic-policy" } };
    assert.fail(`unexpected synthetic transport ${service}:${action}`);
  };
  return state;
}

function taggingSetup() {
  const v = setup("auth-provision"), selected = policy.TARGETS[v.config.service];
  v.before = structuredClone(v.after);
  delete v.before.Parameters.ThnAuthProvisionPoolCreateTagArn;
  v.before.Resources[selected.logical].Properties.PolicyDocument.Statement.find(s => s.Action === "cognito-idp:TagResource").Resource = {Ref: "ThnAuthProvisionPoolArnScope"};
  v.role.inline[selected.policyName] = policy.resolve(v.before.Resources[selected.logical].Properties.PolicyDocument, policy.validateBindings(v.binding, v.config));
  v.after = policy.composeTemplate(v.before, v.config.service);
  Object.assign(v.ledger, {originalSha256: hash(v.before), processedSha256: hash(v.before), composedSha256: hash(v.after),
    composedProcessedSha256: hash(v.after), roleSha256: hash(v.role)});
  v.config.expectedLedgerSha256 = hash(v.ledger);
  const aws = revisionAWS(v), delegate = aws.aws;
  aws.owner.Parameters = Object.keys(v.before.Parameters).map(ParameterKey => ({ParameterKey, ParameterValue: "****"}));
  aws.aws = (...args) => {
    const [, action, input] = args;
    if (action === "create-change-set") {
      assert.equal(input.Parameters.length, new Set(input.Parameters.map(p => p.ParameterKey)).size);
      for (const p of input.Parameters) assert.deepEqual(p, p.ParameterKey === "ThnAuthProvisionPoolCreateTagArn"
        ? {ParameterKey: p.ParameterKey, ParameterValue: `arn:aws:cognito-idp:us-east-1:${v.config.account}:userpool/*`}
        : {ParameterKey: p.ParameterKey, UsePreviousValue: true});
    }
    const result = delegate(...args);
    if (action === "describe-change-set") Object.assign(result.Changes[0].ResourceChange,
      {Action: "Modify", Replacement: "False", PhysicalResourceId: "synthetic-policy"});
    if (action === "describe-stack-resource") result.StackResourceDetail.ResourceStatus = "UPDATE_COMPLETE";
    return result;
  };
  return {v, aws};
}

function hubSetup() {
  const v = setup("hub-version"), aws = revisionAWS(v), delegate = aws.aws;
  aws.aws = (...args) => {
    const [, action, input] = args;
    if (action === "get-template" && input.StackName === v.binding.stackId) return {TemplateBody: {Resources: {Shared: {Type: "AWS::Lambda::Function"}}}};
    const result = delegate(...args);
    if (action === "describe-stacks" && input.StackName === v.binding.stackId) Object.assign(result.Stacks[0], {
      StackStatus: "UPDATE_COMPLETE", EnableTerminationProtection: true,
      Parameters: [{ParameterKey: "EnvironmentName", ParameterValue: "test"}]});
    if (action === "describe-change-set") Object.assign(result.Changes[0].ResourceChange,
      {Action: "Modify", Replacement: "False", PhysicalResourceId: "synthetic-policy"});
    if (action === "describe-stack-resource") result.StackResourceDetail.ResourceStatus = "UPDATE_COMPLETE";
    return result;
  };
  return {v, aws};
}

test("Hub version workflow verifies then modifies only its existing supplement", async () => {
  const {v, aws} = hubSetup(), before = structuredClone(aws.role);
  const config = {...v.config, aws: aws.aws, authenticate: () => true, execute: false, delay: async () => {}, maxPolls: 3};
  assert.equal((await api().runRevision(v.ledger, v.binding, v.authority, config)).status, "verified");
  assert.deepEqual(aws.writes, []);
  const result = await api().runRevision(v.ledger, v.binding, v.authority, {...config, execute: true});
  assert.equal(result.modifiedPolicies, 1); assert.equal(result.addedPolicies, 0);
  assert.deepEqual(aws.role.Role, before.Role); assert.deepEqual(aws.role.inline.Existing, before.inline.Existing);
  assert.deepEqual(aws.template, v.after);
});

test("Hub permission revision rejects enabled, provisioned, adopted or drifted stacks", async () => {
  for (const mutate of [s => s.EnableTerminationProtection = false, s => s.RoleARN = "unapproved",
    s => s.StackStatus = "CREATE_FAILED", s => s.Parameters.push({ParameterKey: "EnableThnContentHubV2", ParameterValue: "true"}),
    s => s.Parameters.push({ParameterKey: "ProvisionThnContentHubV2State", ParameterValue: "true"})]) {
    const {v, aws} = hubSetup(), delegate = aws.aws;
    const transport = (...args) => {const r = delegate(...args);
      if (args[1] === "describe-stacks" && args[2].StackName === v.binding.stackId) mutate(r.Stacks[0]); return r;};
    await assert.rejects(api().runRevision(v.ledger, v.binding, v.authority, {...v.config, aws: transport,
      authenticate: () => true, execute: true, delay: async () => {}, maxPolls: 3}));
    assert.deepEqual(aws.writes, []);
  }
});

function imageSetup() {
  const v = setup("image-version"), aws = revisionAWS(v), delegate = aws.aws;
  aws.aws = (...args) => {
    const [, action, input] = args;
    if (action === "create-change-set") assert.deepEqual(input.Parameters, [{ParameterKey: "ExistingSecret", UsePreviousValue: true}]);
    const result = delegate(...args);
    if (action === "describe-stacks" && input.StackName === v.binding.stackId) Object.assign(result.Stacks[0], {
      StackStatus: "CREATE_FAILED", RoleARN: `arn:aws:iam::${v.config.account}:role/${policy.TARGETS["image-version"].role}`,
      EnableTerminationProtection: true, Parameters: [
        {ParameterKey: "EnableThnPrivateUploadV2", ParameterValue: "false"},
        {ParameterKey: "ProvisionThnPrivateUploadV2State", ParameterValue: "true"},
        {ParameterKey: "ThnPrivateUploadV2TerminationProtectionGate", ParameterValue: "CONFIRMED_ENABLED"}]});
    if (action === "describe-change-set") Object.assign(result.Changes[0].ResourceChange,
      {Action: "Modify", Replacement: "False", PhysicalResourceId: "synthetic-policy"});
    if (action === "describe-stack-resource") result.StackResourceDetail.ResourceStatus = "UPDATE_COMPLETE";
    return result;
  };
  return {v, aws};
}
test("Image version workflow verifies and updates only its existing supplement with no new parameters", async () => {
  const {v, aws} = imageSetup(), before = structuredClone(aws.role);
  const config = {...v.config, aws: aws.aws, authenticate: () => true, execute: false, delay: async () => {}, maxPolls: 3};
  assert.equal((await api().runRevision(v.ledger, v.binding, v.authority, config)).status, "verified");
  assert.deepEqual(aws.writes, []);
  const result = await api().runRevision(v.ledger, v.binding, v.authority, {...config, execute: true});
  assert.equal(result.modifiedPolicies, 1); assert.equal(result.addedPolicies, 0);
  assert.deepEqual(aws.role.Role, before.Role); assert.deepEqual(aws.role.inline.Existing, before.inline.Existing);
  assert.deepEqual(aws.template, v.after);
});
test("Image revision rejects active, unprotected, foreign-executor or wrong-state service before writes", async () => {
  for (const mutate of [s => s.EnableTerminationProtection = false, s => s.RoleARN += "other",
    s => s.StackStatus = "UPDATE_COMPLETE", s => s.Parameters[0].ParameterValue = "true",
    s => s.Parameters[1].ParameterValue = "false"]) {
    const {v, aws} = imageSetup(), transport = (...args) => {
      const result = aws.aws(...args);
      if (args[1] === "describe-stacks" && args[2].StackName === v.binding.stackId) mutate(result.Stacks[0]);
      return result;
    };
    await assert.rejects(api().runRevision(v.ledger, v.binding, v.authority, {...v.config, aws: transport,
      authenticate: () => true, execute: true, delay: async () => {}, maxPolls: 3}));
    assert.deepEqual(aws.writes, []);
  }
});
test("Auth tagging revision verifies then modifies only its existing policy with previous NoEcho values", async () => {
  const {v, aws} = taggingSetup(), before = structuredClone(aws.role);
  const config = {...v.config, aws: aws.aws, authenticate: () => true, execute: false, delay: async () => {}, maxPolls: 3};
  assert.equal((await api().runRevision(v.ledger, v.binding, v.authority, config)).status, "verified");
  assert.deepEqual(aws.writes, []);
  const result = await api().runRevision(v.ledger, v.binding, v.authority, {...config, execute: true});
  assert.equal(result.status, "applied"); assert.equal(result.addedPolicies, 0); assert.equal(result.modifiedPolicies, 1);
  assert.deepEqual(aws.role.Role, before.Role); assert.deepEqual(aws.role.inline.Existing, before.inline.Existing);
  assert.deepEqual(Object.keys(aws.role.inline).sort(), Object.keys(before.inline).sort());
  assert.deepEqual(aws.template, v.after);
});
test("Auth tagging Modify rejects replacement, wrong identity, unrelated changes and stale actual policy", async () => {
  for (const mutate of [
    (r, a) => {if (a === "describe-change-set") r.Changes[0].ResourceChange.Replacement = "True";},
    (r, a) => {if (a === "describe-change-set") r.Changes[0].ResourceChange.PhysicalResourceId = "foreign";},
    (r, a) => {if (a === "describe-change-set") r.Changes.push(structuredClone(r.Changes[0]));},
    (r, a) => {if (a === "get-role-policy" && r.PolicyName === "ThnTestClosedProvisioningV1") delete r.PolicyDocument.Statement[1].Condition;},
  ]) {
    const {v, aws} = taggingSetup(), delegate = aws.aws;
    aws.aws = (...args) => {const r = delegate(...args); mutate(r, args[1]); return r;};
    await assert.rejects(api().runRevision(v.ledger, v.binding, v.authority,
      {...v.config, aws: aws.aws, authenticate: () => true, execute: true, delay: async () => {}, maxPolls: 3}), /recovery_permission/);
    assert.ok(!aws.writes.includes("execute-change-set"));
  }
});

for (const service of ["config", "api", "api-runtime", "api-runtime-corrected", "config-runtime", "auth-provision"]) {
  test(`${service}: real revision orchestration adds one policy and preserves prior trust and masked values`, async () => {
    assert.equal(typeof api().runRevision, "function");
    const v = setup(service), aws = revisionAWS(v), before = structuredClone(aws.role);
    const config = { ...v.config, aws: aws.aws, authenticate: () => true, execute: false, delay: async () => {}, maxPolls: 3 };
    const verified = await api().runRevision(v.ledger, v.binding, v.authority, config);
    assert.equal(verified.status, "verified"); assert.deepEqual(aws.writes, []);
    const applied = await api().runRevision(v.ledger, v.binding, v.authority, { ...config, execute: true });
    assert.equal(applied.status, "applied"); assert.equal(applied.addedPolicies, 1);
    assert.deepEqual(aws.role.Role, before.Role); assert.deepEqual(aws.role.inline.Existing, before.inline.Existing);
    for (const [name, document] of Object.entries(before.inline)) assert.deepEqual(aws.role.inline[name], document);
    assert.deepEqual(aws.template, v.after); assert.equal(aws.owner.RoleARN, v.authority.cfn);
    if (v.binding.record) assert.ok(!JSON.stringify(applied).includes(v.binding.record.versionId));
    assert.deepEqual(aws.writes, ["put-object", "create-change-set", "execute-change-set"]);
  });
}

test("Auth revision rejects active, unprotected or ambiguous lifecycle flags before writes", async () => {
  for (const mutate of [s => s.EnableTerminationProtection = false,
    s => s.Parameters[0].ParameterValue = "true", s => s.Parameters = [],
    s => s.Parameters.push({ParameterKey: "EnableThnAuthAdminV2", ParameterValue: "false"}),
    s => s.Parameters.push({ParameterKey: "ProvisionThnAuthAdminV2State", ParameterValue: "true"})]) {
    const v = setup("auth-provision"), aws = revisionAWS(v);
    const transport = (...args) => {if (args[1] === "get-template" && args[2].StackName === v.binding.stackId)
      return {TemplateBody: {Resources: {}, Parameters: {EnableThnAuthAdminV2: {Type:"String"}}}};
      const result = aws.aws(...args);
      if (args[1] === "describe-stacks" && args[2].StackName === v.binding.stackId) mutate(result.Stacks[0]); return result;};
    await assert.rejects(api().runRevision(v.ledger, v.binding, v.authority, {...v.config, aws: transport,
      authenticate: () => true, execute: true, delay: async () => {}, maxPolls: 3}));
    assert.deepEqual(aws.writes, []);
  }
});

test("Auth transport has no recovery object authority and detects substituted policy source", () => {
  const v = setup("auth-provision"), aws = revisionAWS(v), os = require("node:os");
  const client = api().createClients(v.authority, v.binding, v.ledger, {...v.config, aws: aws.aws, authenticate: () => true});
  assert.throws(() => client("lookup", "s3api", "head-object", {Bucket: "synthetic", Key: "x", VersionId: "1", ExpectedBucketOwner: v.config.account}));
  assert.deepEqual(aws.writes, []);
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "thn-auth-permission-test-")), directory = path.join(parent, "transport");
  try {
    const receipt = api().writeTransport(directory, v.ledger, v.authority, v.config);
    assert.equal(api().verifyTransport(directory, receipt.manifestSha256, v.config).ledger.service, "auth-provision");
    fs.appendFileSync(path.join(directory, "thn-test-auth-provision-permission-policy.js"), "\n// substituted\n");
    assert.throws(() => api().verifyTransport(directory, receipt.manifestSha256, v.config));
  } finally {fs.rmSync(parent, {recursive: true});}
});

test("Auth first provisioning accepts absent flags only in a verified legacy template", async () => {
  for (const legacy of [true, false]) {
    const v = setup("auth-provision"), aws = revisionAWS(v);
    const transport = (...args) => {
      if (args[1] === "get-template" && args[2].StackName === v.binding.stackId) return {TemplateBody:
        legacy ? {Resources: {Existing: {Type: "AWS::Lambda::Function"}}} : {Resources: {ThnAuthAdminV2UserPool: {Type: "AWS::Cognito::UserPool"}}}};
      const result = aws.aws(...args);
      if (args[1] === "describe-stacks" && args[2].StackName === v.binding.stackId) result.Stacks[0].Parameters = [];
      return result;
    };
    const run = () => api().runRevision(v.ledger, v.binding, v.authority, {...v.config, aws:transport,
      authenticate:()=>true, execute:true, delay:async()=>{}, maxPolls:3});
    if (legacy) assert.equal((await run()).status, "applied");
    else {await assert.rejects(run); assert.deepEqual(aws.writes, []);}
  }
});

test("Auth legacy template probe reads only the exact native processed template", () => {
  const v = setup("auth-provision"), aws = revisionAWS(v);
  const client = api().createClients(v.authority, v.binding, v.ledger, {...v.config, aws:aws.aws, authenticate:()=>true});
  for (const input of [{StackName:v.binding.stackId + "other", TemplateStage:"Processed"},
    {StackName:v.binding.stackId, TemplateStage:"Original"},
    {StackName:v.binding.stackId, TemplateStage:"Processed", ChangeSetName:"foreign"}]) {
    assert.throws(() => client("lookup", "cloudformation", "get-template", input));
  }
  assert.deepEqual(aws.writes, []);
});

test("Config runtime rejects function identity mismatch before any permission write", async () => {
  const v = setup("config-runtime"), aws = revisionAWS(v);
  const transport = (...args) => {
    const result = aws.aws(...args);
    if (args[1] === "describe-stack-resource" && args[2].StackName === v.binding.stackId) result.StackResourceDetail.PhysicalResourceId += "other";
    return result;
  };
  await assert.rejects(api().runRevision(v.ledger, v.binding, v.authority, {
    ...v.config, aws: transport, authenticate: () => true, execute: true, delay: async () => {}, maxPolls: 3}));
  assert.deepEqual(aws.writes, []);
});

test("runtime revision rejects an API physical-ID mismatch without a write", async () => {
  const v = setup("api-runtime"), aws = revisionAWS(v);
  const transport = (...args) => {
    const result = aws.aws(...args);
    if (args[1] === "describe-stack-resource" && args[2].StackName === v.binding.stackId) {
      result.StackResourceDetail.PhysicalResourceId = "different123";
    }
    return result;
  };
  await assert.rejects(api().runRevision(v.ledger, v.binding, v.authority, {
    ...v.config, aws: transport, authenticate: () => true, execute: true, delay: async () => {}, maxPolls: 3 }), /recovery_permission/);
  assert.deepEqual(aws.writes, []);
});

test("runtime transport seals the policy implementation and accepts only the existing API read", () => {
  const v = setup("api-runtime"), aws = revisionAWS(v), os = require("node:os");
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "thn-runtime-revision-test-")), directory = path.join(parent, "transport");
  try {
    const receipt = api().writeTransport(directory, v.ledger, v.authority, v.config);
    assert.equal(api().verifyTransport(directory, receipt.manifestSha256, v.config).ledger.service, "api-runtime");
    fs.appendFileSync(path.join(directory, "thn-test-api-runtime-permission-policy.js"), "\n// changed\n");
    assert.throws(() => api().verifyTransport(directory, receipt.manifestSha256, v.config), /recovery_permission/);
  } finally { fs.rmSync(parent, { recursive: true }); }
  const client = api().createClients(v.authority, v.binding, v.ledger, { ...v.config, aws: aws.aws, authenticate: () => true });
  client("lookup", "cloudformation", "describe-stack-resource", { StackName: v.binding.stackId, LogicalResourceId: "ApiProxyApi" });
  assert.throws(() => client("lookup", "cloudformation", "describe-stack-resource", {
    StackName: v.binding.stackId, LogicalResourceId: "ApiProxyFunction" }), /recovery_permission/);
});

test("review-time role drift rejects execution and does not silently expand permissions", async () => {
  assert.equal(typeof api().runRevision, "function");
  const v = setup(), aws = revisionAWS(v);
  aws.hook = () => { aws.role.Role.AssumeRolePolicyDocument.Statement.push({ Effect: "Allow", Action: "unapproved" }); };
  await assert.rejects(api().runRevision(v.ledger, v.binding, v.authority, {
    ...v.config, aws: aws.aws, authenticate: () => true, execute: true, delay: async () => {}, maxPolls: 3 }), /recovery_permission/);
  assert.ok(!aws.writes.includes("execute-change-set"));
});

test("separate manual workflow defaults to verification and authenticates sealed source before credentials", () => {
  const file = path.join(__dirname, "../.github/workflows/thn-test-recovery-permissions.yml");
  assert.ok(fs.existsSync(file), "missing independent recovery revision workflow");
  const workflow = fs.readFileSync(file, "utf8"), run = workflow.split("\n  execute:")[1];
  assert.ok(workflow.includes("default: verify"));
  assert.ok(workflow.includes("group: zoolandingpage-aws-infra-test-frontend"));
  assert.ok(run && !/actions\/checkout|npm |cdk synth/.test(run));
  assert.ok(run.indexOf("sha256sum --check --strict") < run.indexOf("node .transport/thn-test-recovery-permissions.js verify"));
  assert.ok(run.indexOf("node .transport/thn-test-recovery-permissions.js verify") < run.indexOf("aws-actions/configure-aws-credentials"));
  assert.ok(!/node tools\/thn-test-permissions\.js|iam put-role|pull_request_target/.test(workflow));
});

test("CLI rejects non-TEST selection before any provider operation", async () => {
  assert.equal(typeof api().main, "function");
  await assert.rejects(api().main(["run", "/untrusted"], {
    GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/production", PRIVATE_INPUT: "DO-NOT-EMIT" }),
  error => error.message === "thn_recovery_permission_guard_failed");
});
