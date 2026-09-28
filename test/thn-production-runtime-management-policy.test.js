"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const deltas = require("../tools/production/thn-config-production-deltas.json");
const manifest = require("../tools/production/thn-deployment-identities.json");
const api = require("../tools/thn-production-identities");
const { canonical, sha } = require("../tools/thn-production-certificate-release");
const role = "zoolanding-config-runtime-read-production-github-deploy";
const arn = "arn:aws:lambda:us-east-1:765932874577:function:zoolanding-config-runtime-ConfigRuntimeReadFunctio-tyt19jOfQNXg";
const policy = deltas.deltas[role].policy;
const values = v => Array.isArray(v) ? v : [v];
function matches(pattern, value) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp("^" + escaped + "$", "i").test(value);
}
function grants(document, action, resource) {
  return document.Statement.some(s => s.Effect === "Allow" && !s.Condition
    && values(s.Action).some(p => matches(p, action))
    && values(s.Resource).some(p => matches(p, resource)));
}

test("the production Runtime caller can read its managed runtime on the exact existing function", () => {
  assert.equal(grants(policy, "lambda:GetRuntimeManagementConfig", arn), true);
  assert.deepEqual(policy.Statement.find(s => s.Sid === "ProductionCodePostflightRead"), {
    Action: ["lambda:GetFunctionConfiguration", "lambda:GetRuntimeManagementConfig"],
    Effect: "Allow", Resource: arn, Sid: "ProductionCodePostflightRead"
  });
  assert.equal(deltas.deltas[role].policySha256, sha(canonical(policy)));
});

test("the managed-runtime addition cannot read TEST, qualifiers or another production function, or mutate runtime mode", () => {
  for (const target of [arn + ":live", arn.replace("tyt19jOfQNXg", "otherFunction"),
    arn.replace("tyt19jOfQNXg", "h2B86UU86X18")]) {
    assert.equal(grants(policy, "lambda:GetRuntimeManagementConfig", target), false);
  }
  for (const action of ["lambda:PutRuntimeManagementConfig", "lambda:UpdateFunctionCode", "lambda:UpdateFunctionConfiguration"]) {
    assert.equal(grants(policy, action, arn), false);
  }
});

test("the sealed bootstrap carries that exact caller policy and scoped proof without granting the CF executor", () => {
  const candidate = api.compose(null, manifest);
  const grant = candidate.Resources.ConfigRuntimeDeployRequiredReadPolicy;
  assert.deepEqual(grant.Properties.Roles, [role]);
  assert.deepEqual(grant.Properties.PolicyDocument, policy);
  const proofs = manifest.proofMatrix.filter(row => row.principalArn === "arn:aws:iam::765932874577:role/" + role
    && row.actions.includes("lambda:GetRuntimeManagementConfig"));
  assert.equal(proofs.length, 1);
  assert.equal(proofs[0].principalArn, "arn:aws:iam::765932874577:role/" + role);
  assert.deepEqual(proofs[0].resources, [arn]);
  assert.deepEqual(proofs[0].condition, {});
  assert.equal(grants(deltas.deltas["zoolanding-config-runtime-read-production-cfn-exec"].policy,
    "lambda:GetRuntimeManagementConfig", arn), false);
});
