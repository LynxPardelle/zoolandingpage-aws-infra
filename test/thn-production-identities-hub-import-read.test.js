"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const api = require("../tools/thn-production-identities");
const manifest = require("../tools/production/thn-deployment-identities.json");

const logical = "HubImportPreflightReadPolicy";
const role = "zoolanding-content-hub-production-deploy";
const registry = "arn:aws:dynamodb:us-east-1:765932874577:table/zoolanding-content-hub-prod-ServiceBindingRegistryV2";
const bucket = "arn:aws:s3:::zlp-thn-ch-production-private-765932874577-us-east-1";

function pair() {
  const candidate = api.compose(null, manifest);
  const before = structuredClone(candidate);
  delete before.Resources[logical];
  return { before, candidate };
}

function preview() {
  return {
    Status: "CREATE_COMPLETE", ExecutionStatus: "AVAILABLE", IncludeNestedStacks: false,
    Parameters: [{ ParameterKey: "ThnProductionOwnerPoolArn", ParameterValue: "BLOCKED" }],
    Changes: [{ Type: "Resource", ResourceChange: {
      Action: "Add", LogicalResourceId: logical, ResourceType: "AWS::IAM::Policy",
      Replacement: "False", Scope: [], Details: [],
    } }],
  };
}

test("import preflight policy grants only five bounded reads to the Hub deploy role", () => {
  const policy = manifest.template.Resources[logical];
  assert.deepEqual(policy.Properties.Roles, [role]);
  assert.equal(policy.Properties.PolicyName, "ThnProductionHubImportPreflightRead");
  assert.equal(policy.DeletionPolicy, "Retain");
  assert.equal(policy.UpdateReplacePolicy, "Retain");
  assert.deepEqual(policy.Properties.PolicyDocument.Statement, [
    { Effect: "Allow", Action: ["dynamodb:GetResourcePolicy"], Resource: registry },
    { Effect: "Allow", Action: ["s3:GetBucketVersioning", "s3:GetEncryptionConfiguration",
      "s3:GetBucketPublicAccessBlock", "s3:ListBucket"], Resource: bucket },
  ]);
  assert.equal(api.validateHubImportReadPolicy(manifest), policy);
});

test("candidate appends only one policy and rejects baseline drift", () => {
  const { before, candidate } = pair();
  assert.deepEqual(api.composeHubImportReadPatch(before, manifest), candidate);
  const drift = structuredClone(before);
  drift.Resources.HubGithubReleasePolicy.Properties.Roles = [];
  assert.throws(() => api.composeHubImportReadPatch(drift, manifest), /hub_import_read/);
  assert.throws(() => api.composeHubImportReadPatch(candidate, manifest), /hub_import_read/);
});

test("native review accepts exactly one non-replacing IAM policy Add", () => {
  const { before, candidate } = pair();
  assert.equal(api.reviewHubImportReadInventory(before, candidate, preview()).length, 1);
  for (const mutation of ["extra", "modify", "replacement", "logical", "type", "parameter", "pagination"]) {
    const native = preview();
    if (mutation === "extra") native.Changes.push(structuredClone(native.Changes[0]));
    if (mutation === "modify") native.Changes[0].ResourceChange.Action = "Modify";
    if (mutation === "replacement") native.Changes[0].ResourceChange.Replacement = "True";
    if (mutation === "logical") native.Changes[0].ResourceChange.LogicalResourceId = "Other";
    if (mutation === "type") native.Changes[0].ResourceChange.ResourceType = "AWS::IAM::Role";
    if (mutation === "parameter") native.Parameters[0].ParameterValue = "other";
    if (mutation === "pagination") native.NextToken = "more";
    assert.throws(() => api.reviewHubImportReadInventory(before, candidate, native), /hub_import_read/, mutation);
  }
});

test("manual workflow and retained review recognize only the explicit import-read scope", () => {
  const workflow = fs.readFileSync(".github/workflows/thn-production-identities.yml", "utf8");
  assert.match(workflow, /options:\s*\[bootstrap, trust-patch, hub-rule-policy-patch, hub-import-read-patch\]/);
  assert.match(workflow, /deployment-identities-hub-import-read-patch/);
  const review = fs.readFileSync("tools/thn-production-retained-review.js", "utf8");
  assert.match(review, /deployment-identities-hub-import-read-patch/);
});

test("production CLI accepts only exact post-apply simulations", () => {
  const cert = require("../tools/thn-production-certificate-release");
  assert.doesNotThrow(() => cert.assertProductionOperation("lookup", "cloudformation", "describe-type", {
    Type: "RESOURCE", TypeName: "AWS::IAM::Policy",
  }));
  assert.doesNotThrow(() => cert.assertProductionOperation("lookup", "iam", "simulate-principal-policy", {
    PolicySourceArn: cert.roles["cfn-exec"],
    ActionNames: ["iam:GetRolePolicy", "iam:PutRolePolicy", "iam:DeleteRolePolicy"],
    ResourceArns: [`arn:aws:iam::765932874577:role/${role}`],
  }));
  const principal = `arn:aws:iam::765932874577:role/${role}`;
  for (const [actions, resource] of [
    [["dynamodb:GetResourcePolicy"], registry],
    [["s3:GetBucketVersioning", "s3:GetEncryptionConfiguration",
      "s3:GetBucketPublicAccessBlock", "s3:ListBucket"], bucket],
  ]) {
    assert.doesNotThrow(() => cert.assertProductionOperation("lookup", "iam", "simulate-principal-policy", {
      PolicySourceArn: principal, ActionNames: actions, ResourceArns: [resource],
    }));
  }
  assert.throws(() => cert.assertProductionOperation("lookup", "iam", "simulate-principal-policy", {
    PolicySourceArn: principal, ActionNames: ["dynamodb:Scan"], ResourceArns: [registry],
  }), /out_of_scope/);
  assert.throws(() => cert.assertProductionOperation("lookup", "iam", "simulate-principal-policy", {
    PolicySourceArn: principal, ActionNames: ["s3:GetBucketVersioning"], ResourceArns: ["arn:aws:s3:::other"],
  }), /out_of_scope/);
});

test("IAM review proves exact CloudFormation policy create permissions", () => {
  const { before, candidate } = pair();
  const roleArn = `arn:aws:iam::765932874577:role/${role}`;
  const baseline = { templates: { Original: before, Processed: before },
    externalRoles: { [role]: { roleId: "ROLE-ID", boundarySha256: "boundary" } } };
  let denied = false, duplicate = false;
  const call = (kind, service, operation, input) => {
    assert.equal(kind, "lookup");
    if (service === "cloudformation" && operation === "describe-type") {
      assert.equal(input.TypeName, "AWS::IAM::Policy");
      return { Schema: JSON.stringify({ handlers: { create: { permissions: [
        "iam:GetUserPolicy", "iam:GetRolePolicy", "iam:GetGroupPolicy",
        "iam:PutUserPolicy", "iam:PutRolePolicy", "iam:PutGroupPolicy",
      ] }, delete: { permissions: ["iam:DeleteRolePolicy", "iam:DeleteUserPolicy", "iam:DeleteGroupPolicy"] } } }) };
    }
    if (service === "iam" && operation === "simulate-principal-policy") {
      assert.deepEqual(input.ActionNames, ["iam:GetRolePolicy", "iam:PutRolePolicy", "iam:DeleteRolePolicy"]);
      assert.deepEqual(input.ResourceArns, [roleArn]);
      const results = input.ActionNames.map(action => ({
        EvalActionName: action, EvalResourceName: roleArn,
        EvalDecision: denied && action === "iam:PutRolePolicy" ? "implicitDeny" : "allowed",
      }));
      if (duplicate) results[1].EvalActionName = results[0].EvalActionName;
      return { EvaluationResults: results };
    }
    throw Error(`unexpected ${service}:${operation}`);
  };
  assert.equal(api.hubImportReadPermissionProof(call, baseline, candidate).actions.length, 3);
  denied = true;
  assert.throws(() => api.hubImportReadPermissionProof(call, baseline, candidate), /hub_import_read_permissions/);
  denied = false;
  duplicate = true;
  assert.throws(() => api.hubImportReadPermissionProof(call, baseline, candidate), /hub_import_read_permissions/);
});

test("post-apply proof accounts for the new owned inline policy and rejects drift", () => {
  const { before: original, candidate } = pair();
  const policy = candidate.Resources[logical].Properties;
  const policySha = crypto.createHash("sha256")
    .update(require("../tools/thn-production-certificate-release").canonical(policy.PolicyDocument))
    .digest("hex");
  const before = { templates: { Original: original, Processed: original },
    resources: [{ LogicalResourceId: "Existing", ResourceType: "AWS::IAM::Role" }],
    externalRoles: { [role]: { roleId: "ROLE-ID", policies: [] } } };
  const after = structuredClone(before);
  after.templates = { Original: candidate, Processed: candidate };
  after.resources.push({ LogicalResourceId: logical, ResourceType: "AWS::IAM::Policy" });
  after.externalRoles[role].policies.push({ type: "inline", name: policy.PolicyName, sha256: policySha });
  const call = (kind, service, operation, input) => {
    assert.equal(kind, "lookup");
    if (service === "iam" && operation === "get-role-policy") {
      assert.equal(input.PolicyName, policy.PolicyName);
      return { PolicyDocument: policy.PolicyDocument };
    }
    if (service === "iam" && operation === "simulate-principal-policy") {
      return { EvaluationResults: input.ActionNames.map(action => ({
        EvalActionName: action, EvalResourceName: input.ResourceArns[0], EvalDecision: "allowed",
      })) };
    }
    throw Error(`unexpected ${service}:${operation}`);
  };
  assert.equal(api.verifyHubImportReadPost(call, before, after, candidate), true);
  const changed = structuredClone(after);
  changed.externalRoles[role].policies[0].sha256 = "0".repeat(64);
  assert.throws(() => api.verifyHubImportReadPost(call, before, changed, candidate), /post_mismatch/);
});

test("protected import-read review keeps one Add and stops execution on drift", async () => {
  const os = require("node:os");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "thn-import-read-review-"));
  const { before, candidate } = pair();
  const stackId = `arn:aws:cloudformation:us-east-1:765932874577:stack/${api.STACK}/11111111-1111-1111-1111-111111111111`;
  const baseline = {
    stackId, templates: { Original: before, Processed: before },
    parameters: [{ ParameterKey: "ThnProductionOwnerPoolArn", ParameterValue: "BLOCKED" }],
    terminationProtection: false,
    resources: Object.entries(before.Resources).map(([id, resource]) => ({
      LogicalResourceId: id, ResourceType: resource.Type, PhysicalResourceId: id,
    })),
    externalRoles: { [role]: { roleId: "ROLE-ID", trustSha256: "trust", policySha256: "policies", boundarySha256: "boundary", policies: [] } },
    newRoles: {}, ownerPool: { arn: "BLOCKED" }, packageBucket: { exists: true },
  };
  const objects = new Map();
  let native, executes = 0, drift = false;
  const call = (kind, service, operation, input, output) => {
    const key = `${service}:${operation}`;
    if (key === "cloudformation:describe-type") return { Schema: JSON.stringify({ handlers: {
      create: { permissions: ["iam:GetRolePolicy", "iam:PutRolePolicy"] },
      delete: { permissions: ["iam:DeleteRolePolicy"] },
    } }) };
    if (key === "iam:simulate-principal-policy") return { EvaluationResults: input.ActionNames.map(action => ({
      EvalActionName: action, EvalResourceName: input.ResourceArns[0], EvalDecision: "allowed",
    })) };
    if (key === "s3api:list-objects-v2") return { Contents: [] };
    if (key === "s3api:put-object") { objects.set(input.Key, fs.readFileSync(input.Body)); return { VersionId: "v1" }; }
    if (key === "s3api:get-object") { fs.writeFileSync(output, objects.get(input.Key)); return { VersionId: "v1" }; }
    if (key === "cloudformation:create-change-set") {
      assert.equal(input.ChangeSetType, "UPDATE");
      assert.deepEqual(input.Parameters, baseline.parameters);
      native = { ...preview(), StackId: stackId,
        ChangeSetId: `arn:aws:cloudformation:us-east-1:765932874577:changeSet/${input.ChangeSetName}/11111111-1111-1111-1111-111111111111`,
        CreationTime: new Date().toISOString() };
      return { Id: native.ChangeSetId, StackId: stackId };
    }
    if (key === "cloudformation:describe-change-set") return native;
    if (key === "cloudformation:get-template") return { TemplateBody: candidate };
    if (key === "cloudformation:execute-change-set") { executes++; throw Error("test_apply_boundary"); }
    throw Error(`unexpected:${kind}:${key}`);
  };
  try {
    const options = { call, manifest, scope: "hub-import-read-patch", sourceSha: "a".repeat(40),
      fingerprint: "b".repeat(64), runId: "123-1", outputPath: path.join(dir, "review.json"),
      captureBaseline: () => ({ ...structuredClone(baseline), ...(drift ? { drift: true } : {}) }) };
    const record = await api.runIdentities({ ...options, execution: "review" });
    assert.equal(record.purpose, "deployment-identities-hub-import-read-patch");
    assert.equal(record.changes.length, 1);
    assert.equal(record.recoveryCoordinates.length, 2);
    assert.equal(executes, 0);
    drift = true;
    await assert.rejects(() => api.runIdentities({ ...options, execution: "execute", record,
      approvedDigest: record.digest }), /baseline_changed|retained_review_stale|package_invalid/);
    assert.equal(executes, 0);
    drift = false;
    await assert.rejects(() => api.runIdentities({ ...options, execution: "execute", record,
      approvedDigest: record.digest }), /test_apply_boundary/);
    assert.equal(executes, 1);
  } finally { fs.rmSync(dir, { recursive: true }); }
});
