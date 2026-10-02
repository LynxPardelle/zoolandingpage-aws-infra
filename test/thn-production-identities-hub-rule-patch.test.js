"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const api = require("../tools/thn-production-identities");
const manifest = require("../tools/production/thn-deployment-identities.json");

const policyIds = ["HubCfnNativePolicy2", "HubCfnNativePolicy3"];
const rules = [
  "ThnContentHubV2PrivateAssetCollectorFunctionCollectionSchedule",
  "ThnContentHubV2InvalidationWorkerFunctionInvalidationSchedule",
  "ThnContentHubV2PreparedOrphanCollectorFunctionCollectionSchedule",
];
const stack = "zoolanding-content-hub-prod";
const arn = (name) => `arn:aws:events:us-east-1:765932874577:rule/${name}`;

function hubRoleSnapshot(template) {
  const cert = require("../tools/thn-production-certificate-release");
  const name = "zoolanding-deployer-content-hub-production-cfn-exec";
  const role = Object.values(template.Resources).find((resource) => resource.Type === "AWS::IAM::Role" && resource.Properties.RoleName === name);
  assert.ok(role);
  const policies = {};
  for (const inline of role.Properties.Policies || []) policies[`inline:${inline.PolicyName}`] = cert.sha(cert.canonical(inline.PolicyDocument));
  for (const attached of role.Properties.ManagedPolicyArns || []) {
    const resource = template.Resources[attached.Ref];
    const policyArn = `arn:aws:iam::765932874577:policy/${resource.Properties.ManagedPolicyName}`;
    policies[policyArn] = cert.sha(cert.canonical(resource.Properties.PolicyDocument));
  }
  for (const resource of Object.values(template.Resources)) {
    if (resource.Type !== "AWS::IAM::Policy") continue;
    if (!(resource.Properties.Roles || []).some((target) => target === name || target?.Ref === "HubCfnExecutionRole")) continue;
    policies[`inline:${resource.Properties.PolicyName}`] = cert.sha(cert.canonical(resource.Properties.PolicyDocument));
  }
  return { roleId: "HUB-ROLE-ID", trust: role.Properties.AssumeRolePolicyDocument, policies, boundary: null };
}

function pair() {
  const candidate = api.compose(null, manifest);
  const before = structuredClone(candidate);
  const oldNames = rules.map((logical) => `${stack}-${logical}-*`);
  const newNames = rules.map((logical) => `${stack.slice(0, 25)}-${logical.slice(0, 25)}-*`);
  for (const id of policyIds) {
    const document = before.Resources[id].Properties.PolicyDocument;
    let json = JSON.stringify(document);
    for (let i = 0; i < rules.length; i++) json = json.replaceAll(arn(newNames[i]), arn(oldNames[i]));
    before.Resources[id].Properties.PolicyDocument = JSON.parse(json);
  }
  return { before, candidate };
}

function inventory(candidate) {
  return {
    Status: "CREATE_COMPLETE", ExecutionStatus: "AVAILABLE",
    Parameters: [{ ParameterKey: "ThnProductionOwnerPoolArn", ParameterValue: "BLOCKED" }],
    Changes: policyIds.map((id) => ({
      Type: "Resource",
      ResourceChange: {
        Action: "Modify", LogicalResourceId: id, ResourceType: "AWS::IAM::ManagedPolicy",
        PhysicalResourceId: `arn:aws:iam::765932874577:policy/${candidate.Resources[id].Properties.ManagedPolicyName}`,
        Replacement: "False", Scope: ["Properties"],
        Details: [{ Target: { Attribute: "Properties", Name: "PolicyDocument", RequiresRecreation: "Never" }, ChangeSource: "DirectModification", Evaluation: "Static" }],
      },
    })),
  };
}

test("Hub policy candidate changes exactly two existing policy documents", () => {
  const { before, candidate } = pair();
  assert.deepEqual(api.composeHubRulePolicyPatch(before, manifest), candidate);
  const drift = structuredClone(before);
  drift.Resources.HubCfnNativePolicy2.Properties.Roles = [];
  assert.throws(() => api.composeHubRulePolicyPatch(drift, manifest), /hub_rule_policy/);
  const extra = structuredClone(before);
  extra.Resources.ThnProductionReleaseBucket.Properties.VersioningConfiguration.Status = "Suspended";
  assert.throws(() => api.composeHubRulePolicyPatch(extra, manifest), /hub_rule_policy/);
  assert.throws(() => api.composeHubRulePolicyPatch(candidate, manifest), /hub_rule_policy/);
});

test("Hub policy review accepts only two direct non-replacing PolicyDocument changes", () => {
  const { before, candidate } = pair();
  const native = inventory(candidate);
  assert.equal(api.reviewHubRulePolicyInventory(before, candidate, native).length, 2);
  for (const mutation of ["missing", "extra", "replacement", "conditional", "property", "dynamic", "physical", "pagination", "parameter", "candidate"]) {
    const changed = structuredClone(native), candidateChanged = structuredClone(candidate);
    if (mutation === "missing") changed.Changes.pop();
    if (mutation === "extra") changed.Changes.push(structuredClone(changed.Changes[0]));
    if (mutation === "replacement") changed.Changes[0].ResourceChange.Replacement = "True";
    if (mutation === "conditional") changed.Changes[0].ResourceChange.Replacement = "Conditional";
    if (mutation === "property") changed.Changes[0].ResourceChange.Details[0].Target.Name = "Roles";
    if (mutation === "dynamic") changed.Changes[0].ResourceChange.Details[0].Evaluation = "Dynamic";
    if (mutation === "physical") changed.Changes[0].ResourceChange.PhysicalResourceId = "other";
    if (mutation === "pagination") changed.NextToken = "next";
    if (mutation === "parameter") changed.Parameters[0].ParameterValue = "other";
    if (mutation === "candidate") candidateChanged.Description = "other";
    assert.throws(() => api.reviewHubRulePolicyInventory(before, candidateChanged, changed), /hub_rule_policy/, mutation);
  }
});

test("protected workflow exposes the narrow scope and retains its separate purpose", () => {
  const workflow = fs.readFileSync(path.resolve(__dirname, "../.github/workflows/thn-production-identities.yml"), "utf8");
  assert.match(workflow, /options:\s*\[bootstrap, trust-patch, hub-rule-policy-patch, hub-import-read-patch, api-runtime-role-patch, auth-owner-read-patch\]/);
  assert.match(workflow, /purpose=scope==="bootstrap"\?"deployment-identities":"deployment-identities-"\+scope/);
  assert.match(workflow, /test\/thn-production-identities-hub-rule-patch\.test\.js/);
});

test("Hub policy preflight binds versions, attachments, provider schema and effective permissions", () => {
  const { before, candidate } = pair();
  const baseline = {
    stackId: `arn:aws:cloudformation:us-east-1:765932874577:stack/${api.STACK}/11111111-1111-1111-1111-111111111111`,
    templates: { Original: before, Processed: before },
    parameters: [{ ParameterKey: "ThnProductionOwnerPoolArn", ParameterValue: "BLOCKED" }],
    newRoles: { "zoolanding-deployer-content-hub-production-cfn-exec": hubRoleSnapshot(before) },
  };
  let fault = "";
  const call = (kind, service, operation, input) => {
    assert.equal(kind, "lookup");
    const name = input.PolicyArn?.split("/").at(-1);
    const id = name === "ThnProductionHubNative2" ? policyIds[0] : policyIds[1];
    if (service === "cloudformation" && operation === "describe-type") {
      return { Schema: JSON.stringify({ handlers: { read: { permissions: ["iam:GetPolicy", "iam:ListEntitiesForPolicy", "iam:GetPolicyVersion"] }, update: { permissions: ["iam:GetPolicy", "iam:ListPolicyVersions", "iam:CreatePolicyVersion", "iam:DeletePolicyVersion", "iam:AttachRolePolicy", "iam:DetachRolePolicy"] } } }) };
    }
    if (operation === "get-policy") return { Policy: { Arn: input.PolicyArn, PolicyName: name, DefaultVersionId: "v1", AttachmentCount: 1, PermissionsBoundaryUsageCount: 0 } };
    if (operation === "get-policy-version") return { PolicyVersion: { VersionId: "v1", IsDefaultVersion: true, Document: before.Resources[id].Properties.PolicyDocument } };
    if (operation === "list-policy-versions") return { Versions: Array.from({ length: fault === "versions" ? 5 : 1 }, (_, i) => ({ VersionId: `v${i + 1}`, IsDefaultVersion: i === 0 })) };
    if (operation === "list-entities-for-policy") return { PolicyRoles: [{ RoleName: fault === "attachment" ? "other" : "zoolanding-deployer-content-hub-production-cfn-exec", RoleId: "HUB-ROLE-ID" }], PolicyUsers: [], PolicyGroups: [] };
    if (operation === "simulate-principal-policy" || operation === "simulate-custom-policy") return { EvaluationResults: input.ActionNames.map((action) => ({ EvalActionName: action, EvalResourceName: input.ResourceArns[0], EvalDecision: fault === "deny" ? "implicitDeny" : "allowed" })) };
    throw Error(`unexpected:${service}:${operation}`);
  };
  const proof = api.hubRulePolicyProof(call, baseline, candidate);
  assert.equal(proof.policies.length, 2);
  assert.equal(proof.ruleSimulations.length, 3);
  for (const mutation of ["versions", "attachment", "deny"]) {
    fault = mutation;
    assert.throws(() => api.hubRulePolicyProof(call, baseline, candidate), /hub_rule_policy/, mutation);
  }
  fault = "";
  const boundary = structuredClone(baseline);
  boundary.newRoles["zoolanding-deployer-content-hub-production-cfn-exec"].boundary = { arn: "unexpected" };
  assert.throws(() => api.hubRulePolicyProof(call, boundary, candidate), /hub_rule_policy/);
  const extraPolicy = structuredClone(baseline);
  extraPolicy.newRoles["zoolanding-deployer-content-hub-production-cfn-exec"].policies["inline:Unexpected"] = "x";
  assert.throws(() => api.hubRulePolicyProof(call, extraPolicy, candidate), /hub_rule_policy/);
});

test("Hub policy review retains the exact two-policy change and refuses drift before execute", async () => {
  const os = require("node:os");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "thn-hub-policy-review-"));
  const { before, candidate } = pair();
  const stackId = `arn:aws:cloudformation:us-east-1:765932874577:stack/${api.STACK}/11111111-1111-1111-1111-111111111111`;
  const hubRole = "zoolanding-deployer-content-hub-production-cfn-exec";
  const baseline = {
    stackId, templates: { Original: before, Processed: before },
    parameters: [{ ParameterKey: "ThnProductionOwnerPoolArn", ParameterValue: "BLOCKED" }],
    terminationProtection: false,
    resources: Object.entries(before.Resources).map(([id, resource]) => ({ LogicalResourceId: id, ResourceType: resource.Type, PhysicalResourceId: policyIds.includes(id) ? `arn:aws:iam::765932874577:policy/${resource.Properties.ManagedPolicyName}` : id })),
    newRoles: { [hubRole]: hubRoleSnapshot(before) }, externalRoles: {}, ownerPool: { arn: "arn:aws:cognito-idp:us-east-1:765932874577:userpool/us-east-1_TEST" }, packageBucket: { exists: true },
  };
  const objects = new Map();
  let native, executes = 0, drift = false;
  const call = (kind, service, operation, input, output) => {
    const key = `${service}:${operation}`;
    const name = input.PolicyArn?.split("/").at(-1);
    const id = name === "ThnProductionHubNative2" ? policyIds[0] : policyIds[1];
    if (key === "cloudformation:describe-type") return { Schema: JSON.stringify({ handlers: { read: { permissions: ["iam:GetPolicy", "iam:ListEntitiesForPolicy", "iam:GetPolicyVersion"] }, update: { permissions: ["iam:GetPolicy", "iam:ListPolicyVersions", "iam:CreatePolicyVersion", "iam:DeletePolicyVersion", "iam:AttachRolePolicy", "iam:DetachRolePolicy"] } } }) };
    if (key === "iam:get-policy") return { Policy: { Arn: input.PolicyArn, PolicyName: name, DefaultVersionId: "v1", AttachmentCount: 1, PermissionsBoundaryUsageCount: 0 } };
    if (key === "iam:get-policy-version") return { PolicyVersion: { VersionId: "v1", IsDefaultVersion: true, Document: before.Resources[id].Properties.PolicyDocument } };
    if (key === "iam:list-policy-versions") return { Versions: [{ VersionId: "v1", IsDefaultVersion: true }] };
    if (key === "iam:list-entities-for-policy") return { PolicyRoles: [{ RoleName: hubRole, RoleId: "HUB-ROLE-ID" }], PolicyUsers: [], PolicyGroups: [] };
    if (key === "iam:simulate-principal-policy" || key === "iam:simulate-custom-policy") return { EvaluationResults: input.ActionNames.map((action) => ({ EvalActionName: action, EvalResourceName: input.ResourceArns[0], EvalDecision: "allowed" })) };
    if (key === "s3api:list-objects-v2") return { Contents: [] };
    if (key === "s3api:put-object") { objects.set(input.Key, fs.readFileSync(input.Body)); return { VersionId: "v1" }; }
    if (key === "s3api:get-object") { fs.writeFileSync(output, objects.get(input.Key)); return { VersionId: "v1" }; }
    if (key === "cloudformation:create-change-set") {
      assert.equal(input.ChangeSetType, "UPDATE");
      assert.deepEqual(input.Parameters, [{ ParameterKey: "ThnProductionOwnerPoolArn", ParameterValue: "BLOCKED" }]);
      native = { ...inventory(candidate), StackId: stackId, ChangeSetId: `arn:aws:cloudformation:us-east-1:765932874577:changeSet/${input.ChangeSetName}/11111111-1111-1111-1111-111111111111`, CreationTime: new Date().toISOString() };
      return { Id: native.ChangeSetId, StackId: stackId };
    }
    if (key === "cloudformation:describe-change-set") return native;
    if (key === "cloudformation:get-template") return { TemplateBody: candidate };
    if (key === "cloudformation:execute-change-set") { executes++; throw Error("test_apply_boundary"); }
    throw Error(`unexpected:${kind}:${key}`);
  };
  try {
    const options = { call, manifest, scope: "hub-rule-policy-patch", sourceSha: "a".repeat(40), fingerprint: "b".repeat(64), runId: "123-1", outputPath: path.join(dir, "review.json"), captureBaseline: () => ({ ...structuredClone(baseline), ...(drift ? { drift: true } : {}) }) };
    const record = await api.runIdentities({ ...options, execution: "review" });
    assert.equal(record.purpose, "deployment-identities-hub-rule-policy-patch");
    assert.equal(record.recoveryCoordinates.length, 2);
    assert.equal(record.changes.length, 2);
    assert.equal(executes, 0);
    drift = true;
    await assert.rejects(() => api.runIdentities({ ...options, execution: "execute", record, approvedDigest: record.digest }), /package_invalid|retained_review_stale|baseline_changed/);
    assert.equal(executes, 0);
    drift = false;
    await assert.rejects(() => api.runIdentities({ ...options, execution: "execute", record, approvedDigest: record.digest }), /test_apply_boundary/);
    assert.equal(executes, 1);
  } finally { fs.rmSync(dir, { recursive: true }); }
});

test("Hub policy postcheck preserves role identity and every unrelated policy hash", () => {
  const cert = require("../tools/thn-production-certificate-release");
  const { before, candidate } = pair();
  const hubRole = "zoolanding-deployer-content-hub-production-cfn-exec";
  const beforePolicies = Object.fromEntries(policyIds.map((id) => {
    const resource = before.Resources[id];
    return [`arn:aws:iam::765932874577:policy/${resource.Properties.ManagedPolicyName}`, cert.sha(cert.canonical(resource.Properties.PolicyDocument))];
  }));
  beforePolicies["arn:aws:iam::765932874577:policy/Other"] = "unchanged";
  const baseline = { templates: { Original: before, Processed: before }, terminationProtection: false, resources: [{ LogicalResourceId: "Role", PhysicalResourceId: "role-id" }], newRoles: { [hubRole]: { roleId: "HUB-ROLE-ID", trust: { Statement: [] }, policies: beforePolicies, policySizes: {}, boundary: null } }, hubRulePolicyProof: { checked: true } };
  const after = structuredClone(baseline);
  delete after.hubRulePolicyProof;
  after.templates = { Original: candidate, Processed: candidate };
  for (const id of policyIds) {
    const resource = candidate.Resources[id];
    after.newRoles[hubRole].policies[`arn:aws:iam::765932874577:policy/${resource.Properties.ManagedPolicyName}`] = cert.sha(cert.canonical(resource.Properties.PolicyDocument));
  }
  assert.equal(api.verifyHubRulePolicyPost(baseline, after, candidate), true);
  for (const field of ["roleId", "trust", "policies", "resources", "terminationProtection"]) {
    const bad = structuredClone(after);
    if (field === "policies") bad.newRoles[hubRole].policies["arn:aws:iam::765932874577:policy/Other"] = "changed";
    else if (field === "resources") bad.resources[0].PhysicalResourceId = "changed";
    else if (field === "terminationProtection") bad.terminationProtection = true;
    else bad.newRoles[hubRole][field] = "changed";
    assert.throws(() => api.verifyHubRulePolicyPost(baseline, bad, candidate), /hub_rule_policy_post_mismatch/, field);
  }
});

test("production CLI guard admits only the Hub patch read probes", () => {
  const cert = require("../tools/thn-production-certificate-release");
  const role = "arn:aws:iam::765932874577:role/cdk-hnb659fds-cfn-exec-role-765932874577-us-east-1";
  const policyArn = "arn:aws:iam::765932874577:policy/ThnProductionHubNative2";
  const ruleArn = "arn:aws:events:us-east-1:765932874577:rule/zoolanding-content-hub-pr-ThnContentHubV2PrivateAss-3oPnJWQJPmCK";
  assert.doesNotThrow(() => cert.assertProductionOperation("lookup", "cloudformation", "describe-type", { Type: "RESOURCE", TypeName: "AWS::IAM::ManagedPolicy" }));
  assert.doesNotThrow(() => cert.assertProductionOperation("lookup", "iam", "list-policy-versions", { PolicyArn: policyArn }));
  assert.doesNotThrow(() => cert.assertProductionOperation("lookup", "iam", "list-entities-for-policy", { PolicyArn: policyArn }));
  assert.doesNotThrow(() => cert.assertProductionOperation("lookup", "iam", "simulate-principal-policy", { PolicySourceArn: role, ActionNames: ["iam:getpolicy", "iam:getpolicyversion", "iam:listpolicyversions", "iam:listentitiesforpolicy", "iam:createpolicyversion", "iam:deletepolicyversion"], ResourceArns: [policyArn] }));
  assert.doesNotThrow(() => cert.assertProductionOperation("lookup", "iam", "simulate-custom-policy", { PolicyInputList: ["{}"], ActionNames: [...api.HUB_RULE_ACTIONS], ResourceArns: [ruleArn] }));
  assert.throws(() => cert.assertProductionOperation("lookup", "iam", "list-policy-versions", { PolicyArn: "arn:aws:iam::765932874577:policy/Other" }), /out_of_scope/);
  assert.throws(() => cert.assertProductionOperation("lookup", "iam", "simulate-custom-policy", { PolicyInputList: ["{}"], ActionNames: [...api.HUB_RULE_ACTIONS], ResourceArns: [ruleArn.replace("PrivateAss", "UnknownRule")] }), /out_of_scope/);
  assert.throws(() => cert.assertProductionOperation("lookup", "cloudformation", "execute-change-set", { StackName: api.STACK }), /out_of_scope/);
});

test("Hub policy postcheck counts only resources active under the preserved stack parameter", () => {
  const { candidate } = pair();
  const baseline = { parameters: [{ ParameterKey: "ThnProductionOwnerPoolArn", ParameterValue: "BLOCKED" }], ownerPool: { arn: "arn:aws:cognito-idp:us-east-1:765932874577:userpool/us-east-1_TEST" } };
  assert.equal(api.expectedActiveResourceCount("hub-rule-policy-patch", candidate, baseline), 33);
  assert.equal(api.expectedActiveResourceCount("bootstrap", candidate, baseline), 37);
});

module.exports = { pair, inventory };
