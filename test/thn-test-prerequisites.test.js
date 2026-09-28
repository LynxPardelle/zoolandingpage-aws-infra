"use strict";
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const toolPath = path.join(__dirname, "../tools/thn-test-prerequisites.js");
const tool = fs.existsSync(toolPath) ? require(toolPath) : {};
const hash = value => createHash("sha256").update(value).digest("hex");
const ACCOUNT = "000000000000", SOURCE = "a".repeat(40), PRINCIPAL = `arn:aws:iam::${ACCOUNT}:user/fixture-operator`, ZONE = "ZFIXTURE";
const anchors = { account: hash(ACCOUNT), principal: hash(PRINCIPAL), zone: hash(ZONE),
  stacks: { certificate: hash("certificate stack"), "operator-role": hash("operator stack") } };
const config = { account: ACCOUNT, sourceSha: SOURCE, principal: PRINCIPAL, zoneId: ZONE, anchors };
function baseline() { return { Description: "unchanged", Parameters: { Existing: { Type: "String" } },
  Metadata: { Existing: { untouched: true } }, Outputs: { Original: { Value: "unchanged" } },
  Resources: { ExistingRole: { Type: "AWS::IAM::Role", Properties: { AssumeRolePolicyDocument: { Statement: [] } }, Metadata: { exact: true } } } }; }
function ledger(operation = "certificate") { return { schemaVersion: 1, environment: "test", domain: "thehairnarrative.com", operation,
  sourceSha: SOURCE, stackIdSha256: anchors.stacks[operation], originalTemplateSha256: hash("original"),
  processedTemplateSha256: hash("processed"), composedTemplateSha256: hash("composed"),
  principalSha256: operation === "operator-role" ? anchors.principal : null,
  hostedZoneSha256: operation === "certificate" ? anchors.zone : null,
  dnsBaselineSha256: operation === "certificate" ? hash("dns") : null }; }
function parse(value, options = config) {
  assert.equal(typeof tool.validateLedger, "function", "closed prerequisite ledger is required");
  const raw = Buffer.from(JSON.stringify(value, null, 2) + "\n");
  return tool.validateLedger(raw, hash(raw), options);
}

test("prerequisite ledger is externally sealed, closed, TEST/source/stack-bound and contains no secret values", () => {
  assert.equal(parse(ledger()).operation, "certificate");
  assert.equal(parse(ledger("operator-role")).operation, "operator-role");
  for (const patch of [{ environment: "production" }, { sourceSha: "b".repeat(40) }, { operation: "cleanup" },
    { stackIdSha256: hash("wrong stack") }, { extra: true }, { dnsBaselineSha256: null },
    { originalTemplateSha256: [hash("original")] }, { principalSha256: PRINCIPAL }]) {
    assert.throws(() => parse({ ...ledger(), ...patch }), /thn_prerequisite/);
  }
  const raw = Buffer.from(JSON.stringify(ledger(), null, 2) + "\n");
  assert.throws(() => tool.validateLedger(raw, hash("different"), config), /thn_prerequisite/);
  assert.throws(() => parse(ledger(), { ...config, zoneId: "ZOTHER" }), /thn_prerequisite/);
  for (const principal of [undefined, `arn:aws:iam::${ACCOUNT}:root`, `arn:aws:iam::${ACCOUNT}:role/fixture-operator`, PRINCIPAL + "-other"]) {
    assert.throws(() => parse(ledger("operator-role"), { ...config, principal }), /thn_prerequisite/);
  }
});

test("native certificate composition preserves every original field and adds exactly one retained exact-host certificate", () => {
  assert.equal(typeof tool.composeTemplate, "function", "single-Add composer is required");
  const original = baseline(), copy = structuredClone(original);
  const result = tool.composeTemplate(original, "certificate", config);
  assert.deepEqual(original, copy);
  const added = result.Resources.ThnAdminTestCertificate;
  assert.equal(added.Type, "AWS::CertificateManager::Certificate");
  assert.equal(added.DeletionPolicy, "Retain");
  assert.equal(added.UpdateReplacePolicy, "Retain");
  assert.deepEqual(added.Properties, { DomainName: "admin-test.thehairnarrative.com", ValidationMethod: "DNS",
    DomainValidationOptions: [{ DomainName: "admin-test.thehairnarrative.com", HostedZoneId: ZONE }], CertificateExport: "DISABLED" });
  delete result.Resources.ThnAdminTestCertificate;
  assert.deepEqual(result, original);
  assert.throws(() => tool.composeTemplate({ ...original, Resources: { ...original.Resources, ThnAdminTestCertificate: added } }, "certificate", config), /thn_prerequisite/);
});

test("operator composition adds one permissionless retained role and one NoEcho parameter, never the private principal", () => {
  const original = baseline(), result = tool.composeTemplate(original, "operator-role", config);
  const role = result.Resources.ThnTestHumanOperatorRole;
  assert.equal(role.Type, "AWS::IAM::Role");
  assert.equal(role.DeletionPolicy, "Retain");
  assert.equal(role.UpdateReplacePolicy, "Retain");
  assert.deepEqual(role.Properties.AssumeRolePolicyDocument, { Version: "2012-10-17", Statement: [{ Effect: "Allow",
    Principal: { AWS: { Ref: "ThnTestHumanOperatorPrincipalArn" } }, Action: "sts:AssumeRole" }] });
  assert.deepEqual(result.Parameters.ThnTestHumanOperatorPrincipalArn, { Type: "String", NoEcho: true });
  assert.equal(role.Properties.RoleName, "zoolanding-thn-registry-test-operator");
  assert.equal(role.Properties.Policies, undefined);
  assert.equal(role.Properties.ManagedPolicyArns, undefined);
  assert.ok(!JSON.stringify(result).includes(PRINCIPAL));
  delete result.Resources.ThnTestHumanOperatorRole;
  delete result.Parameters.ThnTestHumanOperatorPrincipalArn;
  assert.deepEqual(result, original);
});

test("composition rejects active admin routes, transforms, parameter collisions and unknown operations", () => {
  for (const original of [{ ...baseline(), Transform: "Unknown" },
    { ...baseline(), Parameters: { ThnTestHumanOperatorPrincipalArn: { Type: "String" } } },
    { ...baseline(), Resources: { Admin: { Type: "AWS::CloudFront::Distribution", Properties: {
      DistributionConfig: { Aliases: ["admin-test.thehairnarrative.com"] } } } } }]) {
    assert.throws(() => tool.composeTemplate(original, "operator-role", config), /thn_prerequisite/);
  }
  assert.throws(() => tool.composeTemplate(baseline(), "anything", config), /thn_prerequisite/);
});

test("DNS closeout accepts only the exact newly returned validation CNAME, preserving mail and all earlier records", () => {
  assert.equal(typeof tool.verifyDnsDelta, "function", "bounded DNS diff is required");
  const before = [{ Name: "thehairnarrative.com.", Type: "MX", TTL: 300, ResourceRecords: [{ Value: "0 fixture.invalid." }] }];
  const cname = { Name: "_fixture.admin-test.thehairnarrative.com.", Type: "CNAME", Value: "_fixture.acm-validations.aws." };
  const record = { Name: cname.Name, Type: "CNAME", TTL: 300, ResourceRecords: [{ Value: cname.Value }] };
  assert.doesNotThrow(() => tool.verifyDnsDelta(before, [...before, record], cname));
  assert.doesNotThrow(() => tool.verifyDnsDelta([...before, record], [...before, record], cname));
  for (const after of [before, [record], [...before, { ...record, ResourceRecords: [{ Value: "other.invalid." }] }],
    [...before, record, { ...record, Name: "_extra.thehairnarrative.com." }],
    [{ ...before[0], TTL: 60 }, record]]) {
    assert.throws(() => tool.verifyDnsDelta(before, after, cname), /thn_prerequisite/);
  }
  assert.throws(() => tool.verifyDnsDelta(before, [...before, record], { ...cname, Name: "_fixture.other.example." }), /thn_prerequisite/);
});

test("change-set review permits only the exact retained Add and exact authenticated Original/Processed templates", () => {
  assert.equal(typeof tool.reviewPrerequisiteChangeSet, "function", "isolated change-set reviewer is required");
  const original = baseline(), prepared = tool.composeTemplate(original, "certificate", config);
  const stackId = `arn:aws:cloudformation:us-east-1:${ACCOUNT}:stack/ZoolandingTest-Zoolandingpage-test-Frontend/fixture`;
  const name = "thn-prerequisite-certificate-1-1", id = `arn:aws:cloudformation:us-east-1:${ACCOUNT}:changeSet/${name}/fixture`;
  const description = { StackName: "ZoolandingTest-Zoolandingpage-test-Frontend", StackId: stackId, ChangeSetName: name,
    ChangeSetId: id, Status: "CREATE_COMPLETE", ExecutionStatus: "AVAILABLE",
    Parameters: [{ ParameterKey: "Existing", ParameterValue: "unchanged" }],
    Changes: [{ Type: "Resource", ResourceChange: { Action: "Add", LogicalResourceId: "ThnAdminTestCertificate",
      ResourceType: "AWS::CertificateManager::Certificate" } }] };
  const expected = { operation: "certificate", account: ACCOUNT, stackId, name, id, cfnRole: "fixture-execution-role",
    original: prepared, processed: prepared, parameterKeys: ["Existing"], previousParameters: description.Parameters };
  assert.doesNotThrow(() => tool.reviewPrerequisiteChangeSet(description, prepared, prepared, expected));
  for (const patch of [{ StackId: stackId + "other" }, { ChangeSetType: "CREATE" },
    { Status: "FAILED" }, { ExecutionStatus: "EXECUTE_COMPLETE" }, { Changes: [] },
    { Changes: [...description.Changes, ...description.Changes] },
    { Changes: [{ Type: "Resource", ResourceChange: { ...description.Changes[0].ResourceChange, Action: "Modify" } }] },
    { Parameters: [...description.Parameters, { ParameterKey: "Other" }] },
    { Parameters: [{ ParameterKey: "Existing", ParameterValue: "changed" }] },
    { Parameters: [{ ParameterKey: "Existing", ParameterValue: "unchanged", UsePreviousValue: false }] }]) {
    assert.throws(() => tool.reviewPrerequisiteChangeSet({ ...description, ...patch }, prepared, prepared, expected), /thn_prerequisite/);
  }
  const tampered = structuredClone(prepared); tampered.Resources.ExistingRole.Metadata.exact = false;
  assert.throws(() => tool.reviewPrerequisiteChangeSet(description, tampered, prepared, expected), /thn_prerequisite/);
  assert.throws(() => tool.reviewPrerequisiteChangeSet(description, prepared, tampered, expected), /thn_prerequisite/);
});

test("NoEcho readback proves only the native mask; exact human value is pinned in the request and final trust", () => {
  const original = baseline(), prepared = tool.composeTemplate(original, "operator-role", config);
  const name = "thn-prerequisite-operator-role-1-1", stackId = `arn:aws:cloudformation:us-east-1:${ACCOUNT}:stack/${tool.OPERATIONS["operator-role"].stack}/fixture`;
  const id = `arn:aws:cloudformation:us-east-1:${ACCOUNT}:changeSet/${name}/fixture`;
  const previousParameters = [{ ParameterKey: "Existing", ParameterValue: "unchanged" }];
  const description = { StackName: tool.OPERATIONS["operator-role"].stack, StackId: stackId, ChangeSetName: name, ChangeSetId: id,
    Status: "CREATE_COMPLETE", ExecutionStatus: "AVAILABLE", Parameters: [...previousParameters, { ParameterKey: "ThnTestHumanOperatorPrincipalArn", ParameterValue: "****" }],
    Changes: [{ Type: "Resource", ResourceChange: { Action: "Add", LogicalResourceId: "ThnTestHumanOperatorRole", ResourceType: "AWS::IAM::Role" } }] };
  const expected = { operation: "operator-role", account: ACCOUNT, stackId, name, id, original: prepared, processed: prepared,
    parameterKeys: Object.keys(prepared.Parameters).sort(), previousParameters };
  assert.doesNotThrow(() => tool.reviewPrerequisiteChangeSet(description, prepared, prepared, expected));
  for (const patch of [{ ParameterValue: PRINCIPAL }, { ParameterValue: "other" }, { ParameterValue: undefined }, { UsePreviousValue: true }, { ResolvedValue: "private" }]) {
    const changed = structuredClone(description); Object.assign(changed.Parameters[1], patch);
    assert.throws(() => tool.reviewPrerequisiteChangeSet(changed, prepared, prepared, expected), /thn_prerequisite/);
  }
});

function authorityFixture(operation = "certificate") {
  const authority = { account: ACCOUNT, region: "us-east-1", stackName: tool.OPERATIONS?.[operation]?.stack,
    lookup: `arn:aws:iam::${ACCOUNT}:role/cdk-fixture-lookup-role-${ACCOUNT}-us-east-1`,
    deploy: `arn:aws:iam::${ACCOUNT}:role/cdk-fixture-deploy-role-${ACCOUNT}-us-east-1`,
    publisher: `arn:aws:iam::${ACCOUNT}:role/cdk-fixture-file-publishing-role-${ACCOUNT}-us-east-1`,
    cfn: `arn:aws:iam::${ACCOUNT}:role/cdk-fixture-cfn-exec-role-${ACCOUNT}-us-east-1`,
    bucket: `cdk-fixture-assets-${ACCOUNT}-us-east-1` };
  return { authority, config: { ...config, runId: "1", runAttempt: "1", anchors: { ...anchors,
    ...Object.fromEntries(["lookup", "deploy", "publisher", "cfn", "bucket"].map(key => [key, hash(authority[key])])) } } };
}

test("authority comes from pinned CDK identities, never a free swapped role, account, region, stack or bucket", () => {
  assert.equal(typeof tool.validateAuthority, "function", "existing CDK authority guard is required");
  const f = authorityFixture();
  assert.doesNotThrow(() => tool.validateAuthority(f.authority, "certificate", f.config));
  for (const patch of [{ lookup: f.authority.deploy }, { publisher: f.authority.lookup }, { cfn: f.authority.deploy },
    { account: "999999999999" }, { region: "us-west-2" }, { stackName: "OtherStack" }, { bucket: "other-bucket" }, { extra: true }]) {
    assert.throws(() => tool.validateAuthority({ ...f.authority, ...patch }, "certificate", f.config), /thn_prerequisite/);
  }
});

test("isolated STS credentials reauthenticate the artifact and never mutate parent credentials or leak denied trust errors", () => {
  assert.equal(typeof tool.createClients, "function", "isolated existing-role clients are required");
  const f = authorityFixture(), parent = { AWS_ACCESS_KEY_ID: "parent", AWS_PROFILE: "parent-profile" }, before = { ...parent };
  let checks = 0;
  const calls = [];
  const clients = tool.createClients(f.authority, "certificate", { ...f.config, env: parent, authenticate: () => { checks++; },
    aws: (service, operation, input, env) => {
      calls.push({ service, operation, input, env });
      if (service === "sts") return { AssumedRoleUser: { Arn: `arn:aws:sts::${ACCOUNT}:assumed-role/${input.RoleArn.split("/").at(-1)}/${input.RoleSessionName}` },
        Credentials: { AccessKeyId: "ASIA" + "A".repeat(16), SecretAccessKey: "s".repeat(40), SessionToken: input.RoleArn, Expiration: new Date(Date.now() + 3590000).toISOString() } };
      return { ok: true };
    } });
  clients("lookup", "cloudformation", "describe-stacks", { StackName: f.authority.stackName });
  assert.ok(checks >= 1);
  assert.deepEqual(parent, before);
  assert.equal(calls[1].env.AWS_PROFILE, undefined);
  assert.notEqual(calls[1].env.AWS_ACCESS_KEY_ID, parent.AWS_ACCESS_KEY_ID);
  assert.throws(() => clients("lookup", "route53", "change-resource-record-sets", {}), /thn_prerequisite/);
  assert.throws(() => clients("lookup", "cloudformation", "delete-stack", {}), /thn_prerequisite/);
  const denied = tool.createClients(f.authority, "certificate", { ...f.config, env: parent, authenticate: () => {},
    aws: () => { throw new Error(PRINCIPAL + " secret token"); } });
  assert.throws(() => denied("lookup", "cloudformation", "describe-stacks", { StackName: f.authority.stackName }),
    error => error.message === "thn_prerequisite_guard_failed");
});

test("immutable transport contains only hashes, source, pinned CDK context and verifiers; never templates or human ARN", t => {
  assert.equal(typeof tool.writeTransport, "function", "bounded public-safe transport is required");
  assert.equal(typeof tool.verifyTransport, "function", "independent transport verifier is required");
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "thn-prerequisite-transport-")), directory = path.join(parent, "release");
  t.after(() => { assert.equal(path.dirname(parent), os.tmpdir()); fs.rmSync(parent, { recursive: true }); });
  const f = authorityFixture("operator-role"), raw = Buffer.from(JSON.stringify(ledger("operator-role"), null, 2) + "\n");
  const result = tool.writeTransport(directory, raw, hash(raw), f.authority, f.config);
  assert.match(result.manifestSha256, /^[a-f0-9]{64}$/);
  assert.equal(tool.verifyTransport(directory, result.manifestSha256, f.config).ledger.operation, "operator-role");
  for (const file of fs.readdirSync(directory)) {
    assert.ok(!fs.readFileSync(path.join(directory, file), "utf8").includes(PRINCIPAL));
    assert.ok(!file.includes("template"));
  }
  assert.throws(() => tool.verifyTransport(directory, hash("unapproved"), f.config), /thn_prerequisite/);
  assert.throws(() => tool.verifyTransport(directory, result.manifestSha256, { ...f.config, runAttempt: "2" }), /thn_prerequisite/);
  fs.writeFileSync(path.join(directory, "unapproved.json"), "{}");
  assert.throws(() => tool.verifyTransport(directory, result.manifestSha256, f.config), /thn_prerequisite/);
  fs.unlinkSync(path.join(directory, "unapproved.json"));
  fs.appendFileSync(path.join(directory, "authority.json"), " ");
  assert.throws(() => tool.verifyTransport(directory, result.manifestSha256, f.config), /thn_prerequisite/);
});

function runtimeFixture(operation = "certificate", fault = "") {
  const f = authorityFixture(operation), original = baseline(), prepared = tool.composeTemplate(original, operation, f.config);
  const stackId = `arn:aws:cloudformation:us-east-1:${ACCOUNT}:stack/${f.authority.stackName}/fixture`;
  const certificateArn = `arn:aws:acm:us-east-1:${ACCOUNT}:certificate/fixture`;
  const kmsArn = `arn:aws:kms:us-east-1:${ACCOUNT}:key/fixture`, policy = { Statement: [{ Effect: "Deny", Action: "s3:*" }] };
  const dns = [{ Name: "thehairnarrative.com.", Type: "MX", TTL: 300, ResourceRecords: [{ Value: "0 fixture.invalid." }] }];
  if (fault === "dns-pagination") dns.push({ Name: "thehairnarrative.com.", Type: "TXT", TTL: 300, ResourceRecords: [{ Value: '"fixture"' }] });
  const cname = { Name: "_fixture.admin-test.thehairnarrative.com.", Type: "CNAME", Value: "_fixture.acm-validations.aws." };
  const record = { Name: cname.Name, Type: "CNAME", TTL: 300, ResourceRecords: [{ Value: cname.Value }] };
  const value = { ...ledger(operation), stackIdSha256: hash(stackId), originalTemplateSha256: hash(tool.canonical(original)),
    processedTemplateSha256: hash(tool.canonical(original)), composedTemplateSha256: hash(tool.canonical(prepared)),
    dnsBaselineSha256: operation === "certificate" ? hash(tool.canonical(tool.normalizedDns(dns))) : null };
  const name = `thn-prerequisite-${operation}-1-1`, id = `arn:aws:cloudformation:us-east-1:${ACCOUNT}:changeSet/${name}/fixture`;
  const calls = [], state = { protected: false, executed: false, uploaded: false, originalReads: 0, body: null };
  const runtimeConfig = { ...f.config, ledgerSha256: hash(Buffer.from(JSON.stringify(value, null, 2) + "\n")), maxPolls: 2, delay: async () => {},
    anchors: { ...f.config.anchors, kmsKey: hash(kmsArn), bucketPolicy: hash(tool.canonical(policy)),
      stacks: { ...f.config.anchors.stacks, [operation]: hash(stackId) } },
    authenticate: () => { if (fault === "tampered-artifact" && state.uploaded) throw new Error("private tamper"); },
    aws: (service, action, input, env, outputFile) => {
      calls.push({ service, action, input, env });
      if (service === "sts") return { AssumedRoleUser: { Arn: `arn:aws:sts::${ACCOUNT}:assumed-role/${input.RoleArn.split("/").at(-1)}/${input.RoleSessionName}` },
        Credentials: { AccessKeyId: "ASIA" + "A".repeat(16), SecretAccessKey: "s".repeat(40), SessionToken: input.RoleArn, Expiration: new Date(Date.now() + 3590000).toISOString() } };
      if (action === "describe-stacks") return { Stacks: [{ StackName: f.authority.stackName, StackId: fault === "wrong-stack" ? stackId + "other" : stackId,
        StackStatus: "UPDATE_COMPLETE", EnableTerminationProtection: state.protected, RoleARN: f.authority.cfn,
        Parameters: [{ ParameterKey: "Existing", ParameterValue: fault === "parameter-drift" && state.originalReads > 0 ? "changed" : "unchanged" }] }] };
      if (action === "get-template") {
        if (!input.ChangeSetName && input.TemplateStage === "Original") state.originalReads++;
        return { TemplateBody: fault === "baseline-drift" && state.originalReads > 1 ? { ...original, Description: "drift" } : input.ChangeSetName ? prepared : original };
      }
      if (action === "get-hosted-zone") return { HostedZone: { Id: "/hostedzone/" + ZONE, Name: "thehairnarrative.com.", Config: { PrivateZone: false } } };
      if (action === "list-resource-record-sets") {
        const all = state.executed ? [...dns, record] : dns;
        if (fault === "dns-pagination") return input.StartRecordName
          ? { ResourceRecordSets: all.slice(1), IsTruncated: false }
          : { ResourceRecordSets: all.slice(0, 1), IsTruncated: true, NextRecordName: all[1].Name, NextRecordType: all[1].Type };
        return { ResourceRecordSets: all, IsTruncated: false };
      }
      if (action === "get-bucket-acl") return { Owner: { ID: "fixture-owner" }, Grants: [{ Grantee: { ID: "fixture-owner", Type: "CanonicalUser" }, Permission: "FULL_CONTROL" }] };
      if (action === "get-bucket-policy") return { Policy: JSON.stringify(policy) };
      if (action === "get-bucket-encryption") return { ServerSideEncryptionConfiguration: { Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: "aws:kms" } }] } };
      if (action === "describe-key") return { KeyMetadata: { Arn: kmsArn, KeyManager: "AWS", Enabled: true, KeyState: "Enabled" } };
      if (action === "update-termination-protection") { state.protected = fault !== "protection-denied"; return {}; }
      if (action === "put-object") {
        state.body = fs.readFileSync(input.Body); state.uploaded = true;
        assert.ok(!state.body.includes(Buffer.from(PRINCIPAL)));
        assert.equal(input.IfNoneMatch, "*"); assert.equal(input.ServerSideEncryption, "aws:kms");
        return {};
      }
      if (action === "get-object") {
        if (fault === "deploy-object-denied" && env.AWS_SESSION_TOKEN === f.authority.deploy) throw new Error("private denied read");
        fs.writeFileSync(outputFile, fault === "uploaded-tamper" ? Buffer.from("tampered") : state.body);
        return { ServerSideEncryption: "aws:kms", SSEKMSKeyId: kmsArn, ChecksumSHA256: Buffer.from(value.composedTemplateSha256, "hex").toString("base64") };
      }
      if (action === "create-change-set") {
        assert.equal(input.RoleARN, f.authority.cfn);
        assert.deepEqual(input.Parameters.find(p => p.ParameterKey === "Existing"), { ParameterKey: "Existing", UsePreviousValue: true });
        if (operation === "operator-role") assert.equal(input.Parameters.find(p => p.ParameterKey === "ThnTestHumanOperatorPrincipalArn").ParameterValue, PRINCIPAL);
        return { Id: id, StackId: stackId };
      }
      if (action === "describe-change-set") return { StackName: f.authority.stackName, StackId: stackId, ChangeSetName: name, ChangeSetId: id,
        Status: fault === "timeout" ? "CREATE_IN_PROGRESS" : "CREATE_COMPLETE", ExecutionStatus: state.executed ? "EXECUTE_COMPLETE" : "AVAILABLE",
        Parameters: Object.keys(prepared.Parameters || {}).sort().map(ParameterKey => ({ ParameterKey,
          ParameterValue: ParameterKey === "Existing" ? (fault === "parameter-drift" ? "changed" : "unchanged") : "****" })),
        Changes: [{ Type: "Resource", ResourceChange: { Action: fault === "wrong-change" ? "Modify" : "Add", LogicalResourceId: tool.OPERATIONS[operation].logical,
          ResourceType: tool.OPERATIONS[operation].type } }] };
      if (action === "execute-change-set") { state.executed = true; return {}; }
      if (action === "describe-stack-resource") return { StackResourceDetail: { StackId: stackId, StackName: f.authority.stackName,
        LogicalResourceId: tool.OPERATIONS[operation].logical, ResourceType: tool.OPERATIONS[operation].type, ResourceStatus: "CREATE_COMPLETE",
        PhysicalResourceId: operation === "certificate" ? certificateArn : "zoolanding-thn-registry-test-operator" } };
      if (action === "describe-certificate") return { Certificate: { CertificateArn: certificateArn, Status: "ISSUED", DomainName: "admin-test.thehairnarrative.com",
        SubjectAlternativeNames: ["admin-test.thehairnarrative.com"], DomainValidationOptions: [{ DomainName: "admin-test.thehairnarrative.com", ValidationStatus: "SUCCESS", ResourceRecord: cname }] } };
      if (action === "get-role") return { Role: { Arn: input.RoleName === f.authority.cfn.split("/").at(-1) ? f.authority.cfn : `arn:aws:iam::${ACCOUNT}:role/zoolanding-thn-registry-test-operator`,
        AssumeRolePolicyDocument: { Version: "2012-10-17", Statement: [{ Effect: "Allow", Action: "sts:AssumeRole",
          Principal: input.RoleName === f.authority.cfn.split("/").at(-1) ? { Service: "cloudformation.amazonaws.com" } : { AWS: PRINCIPAL } }] } } };
      if (action === "list-role-policies") return { PolicyNames: [], IsTruncated: false };
      if (action === "list-attached-role-policies") return { AttachedPolicies: [], IsTruncated: false };
      throw new Error("unexpected fixture call " + action);
    } };
  return { ledger: value, authority: f.authority, config: runtimeConfig, calls, state };
}

test("operational prerequisite enables exact protection, uses encrypted immutable transport, reviews before execute and leaves parent unchanged", async () => {
  assert.equal(typeof tool.runPrerequisite, "function", "workflow-connected runner is required");
  for (const operation of ["certificate", "operator-role"]) {
    const f = runtimeFixture(operation), parent = { AWS_ACCESS_KEY_ID: "parent" }, before = { ...parent };
    const result = await tool.runPrerequisite(f.ledger, f.authority, { ...f.config, env: parent });
    assert.equal(result.status, "verified"); assert.equal(result.addedResources, 1); assert.equal(result.terminationProtection, true);
    assert.deepEqual(parent, before); assert.ok(!JSON.stringify(result).includes(PRINCIPAL));
    assert.ok(!JSON.stringify(result).includes(ACCOUNT));
    const actions = f.calls.map(call => call.action);
    assert.ok(actions.indexOf("update-termination-protection") < actions.indexOf("put-object"));
    assert.ok(actions.indexOf("get-object") < actions.indexOf("execute-change-set"));
    assert.deepEqual(new Set(f.calls.filter(call => call.action === "get-object").map(call => call.env.AWS_SESSION_TOKEN)),
      new Set([f.authority.publisher, f.authority.deploy]));
    assert.equal(actions.filter(action => action === "create-change-set").length, 1);
    assert.equal(actions.filter(action => action === "execute-change-set").length, 1);
    assert.ok(!actions.some(action => /delete|change-resource-record-sets/.test(action)));
  }
});

test("missing protection, baseline/stack/transport drift, denied review or timeout stop without retry or destructive cleanup", async () => {
  for (const fault of ["protection-denied", "baseline-drift", "parameter-drift", "wrong-stack", "uploaded-tamper", "deploy-object-denied", "tampered-artifact", "wrong-change", "timeout"]) {
    const f = runtimeFixture("certificate", fault);
    await assert.rejects(() => tool.runPrerequisite(f.ledger, f.authority, f.config), /thn_prerequisite/);
    const actions = f.calls.map(call => call.action);
    assert.ok(!actions.includes("execute-change-set"), fault);
    assert.ok(actions.filter(action => action === "create-change-set").length <= 1, fault);
    assert.ok(!actions.some(action => /delete|change-resource-record-sets/.test(action)), fault);
  }
  const missingSeal = runtimeFixture();
  await assert.rejects(() => tool.runPrerequisite(missingSeal.ledger, missingSeal.authority, { ...missingSeal.config, ledgerSha256: undefined }), /thn_prerequisite/);
  assert.equal(missingSeal.calls.length, 0);
});

test("DNS snapshot follows every bounded page of the exact zone before and after issuance", async () => {
  const f = runtimeFixture("certificate", "dns-pagination");
  assert.equal((await tool.runPrerequisite(f.ledger, f.authority, f.config)).dns.beforeCount, 2);
  assert.ok(f.calls.some(call => call.action === "list-resource-record-sets" && call.input.StartRecordName));
});

test("manual prerequisite workflow authenticates immutable source/ledger before OIDC and never uploads private template or raw principal", () => {
  const workflowPath = path.join(__dirname, "../.github/workflows/thn-test-prerequisites.yml");
  assert.ok(fs.existsSync(workflowPath), "owning TEST prerequisite workflow is required");
  const workflow = fs.readFileSync(workflowPath, "utf8");
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /\n  push:/);
  assert.match(workflow, /environment: test/);
  assert.match(workflow, /options: \[certificate, operator-role\]/);
  assert.match(workflow, /secrets\.THN_TEST_OPERATOR_PRINCIPAL_ARN/);
  assert.match(workflow, /artifact-ids:.*needs\.validate\.outputs\.artifact_id/);
  assert.ok(workflow.indexOf("Verify immutable prerequisite before credentials") < workflow.indexOf("aws-actions/configure-aws-credentials"));
  assert.match(workflow, /manifest_sha256:.*steps\.artifact\.outputs\.manifest_sha256/);
  assert.doesNotMatch(workflow, /path:.*template|role-to-assume:.*OPERATOR|cloudformation delete|route53 change-resource-record-sets/);
  const executeJob = workflow.split("\n  execute:")[1];
  assert.doesNotMatch(executeJob, /actions\/checkout|npm |cdk synth/);
  assert.ok(executeJob.indexOf("sha256sum --check --strict") < executeJob.indexOf("node .transport/thn-test-prerequisites.js verify"));
});

test("AWS CLI streams the local template using --body while private JSON parameters remain stdin-only", () => {
  assert.equal(typeof tool.awsCli, "function");
  const observed = [];
  const spawn = (command, args, options) => { observed.push({ command, args, options }); return { status: 0, stdout: Buffer.from("{}") }; };
  tool.awsCli("s3api", "put-object", { Bucket: "fixture", Key: "fixture", Body: "/tmp/fixture/template.json" }, {}, undefined, spawn);
  assert.ok(observed[0].args.includes("--body"));
  assert.equal(observed[0].args[observed[0].args.indexOf("--body") + 1], "/tmp/fixture/template.json");
  assert.equal(JSON.parse(observed[0].options.input).Body, undefined);
  tool.awsCli("cloudformation", "create-change-set", { Parameters: [{ ParameterKey: "Private", ParameterValue: PRINCIPAL }] }, {}, undefined, spawn);
  assert.ok(!JSON.stringify(observed[1].args).includes(PRINCIPAL));
  assert.ok(observed[1].options.input.includes(PRINCIPAL));
  assert.equal(observed[1].options.env.AWS_MAX_ATTEMPTS, "1");
});

test("real source derives only reproducible public TEST CDK coordinates without cloud calls", () => {
  const cdk = require("aws-cdk-lib"), environment = require("../config/environments").environments.find(item => item.name === "test");
  for (const operation of ["certificate", "operator-role"]) {
    const authority = tool.deriveAuthority(operation), qualifier = cdk.DefaultStackSynthesizer.DEFAULT_QUALIFIER;
    assert.equal(authority.account, environment.account);
    assert.equal(authority.region, environment.region);
    for (const [kind, suffix] of [["lookup", "lookup"], ["deploy", "deploy"], ["publisher", "file-publishing"], ["cfn", "cfn-exec"]]) {
      assert.equal(authority[kind], `arn:aws:iam::${environment.account}:role/cdk-${qualifier}-${suffix}-role-${environment.account}-${environment.region}`);
    }
    assert.equal(authority.bucket, `cdk-${qualifier}-assets-${environment.account}-${environment.region}`);
    assert.doesNotThrow(() => tool.validateAuthority(authority, operation, { account: environment.account }));
  }
});

test("real CLI fails before any AWS command when its dispatch/source gates are missing, with sanitized output", () => {
  const { spawnSync } = require("node:child_process");
  const result = spawnSync(process.execPath, [path.join(__dirname, "../tools/thn-test-prerequisites.js"), "run", "missing"], {
    env: { ...process.env, GITHUB_ACTIONS: "false", THN_TEST_OPERATOR_PRINCIPAL_ARN: PRINCIPAL }, encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.deepEqual(JSON.parse(result.stderr), { status: "blocked", reason: "thn_prerequisite_guard_failed", reconciliationRequired: true });
});
