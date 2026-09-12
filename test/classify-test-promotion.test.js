"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.join(__dirname, "..");
const tool = path.join(root, "tools/classify-test-promotion.js");
const sha = "a".repeat(40), tree = "b".repeat(40), base = "c".repeat(40);
const selection = (overrides = {}) => JSON.stringify({ schemaVersion: 1, mode: "thn-source-only", devSha: sha, devTree: tree, testBaseSha: base, ...overrides });
function classifier() {
  assert.ok(fs.existsSync(tool), "source-only selection is not implemented");
  return require(tool).classifySelection;
}
test("absent selection preserves ordinary delivery; exact selection suppresses it", () => {
  const classify = classifier();
  for (const raw of [undefined, null, ""]) assert.equal(classify(raw, sha, tree, base), "legacy");
  assert.equal(classify(selection(), sha, tree, base), "thn-source-only");
});
test("malformed, duplicate, extra or ambiguous selection fails closed", () => {
  const classify = classifier();
  for (const raw of [" ", "{", "null", "[]", "true", selection({schemaVersion: true}), selection({mode: "legacy"}),
    selection({extra: 1}), selection({devSha: 42}), selection({devTree: "B".repeat(40)}), selection({testBaseSha: "0".repeat(40)}),
    selection().replace('"schemaVersion":1', '"schemaVersion":NaN'), selection().replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1'),
    selection().replace('"schemaVersion":1', '"schemaVersion":1,"schema\\u0056ersion":1'), " ".repeat(4097),
    selection().replace(',"testBaseSha":"' + base + '"', "")]) {
    assert.throws(() => classify(raw, sha, tree, base), /promotion_selection_invalid/);
  }
});
test("stale source, tree and TEST base cannot select source-only", () => {
  const classify = classifier();
  for (const key of ["devSha", "devTree", "testBaseSha"]) assert.throws(() => classify(selection({[key]: "d".repeat(40)}), sha, tree, base), /stale/);
});
test("invalid observed context never falls through to legacy", () => {
  const classify = classifier();
  for (const args of [[null, tree, base], [sha, "0".repeat(40), base], [sha, tree, ""]]) assert.throws(() => classify("", ...args), /context/);
});
test("CLI reads only environment selection, emits one mode and sanitizes failures", () => {
  classifier();
  const env = {...process.env, INFRA_TEST_PROMOTION_SELECTION_JSON: selection(), PROMOTED_DEV_SHA: sha, PROMOTED_DEV_TREE: tree, PROMOTED_TEST_BASE_SHA: base};
  const result = spawnSync(process.execPath, [tool], { env, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, "thn-source-only\n");
  for (const [raw, args] of [["private-marker-do-not-echo", []], [selection(), ["legacy"]]]) {
    const failed = spawnSync(process.execPath, [tool, ...args], {env: {...env, INFRA_TEST_PROMOTION_SELECTION_JSON: raw}, encoding: "utf8"});
    assert.equal(failed.status, 2); assert.equal(failed.stdout, ""); assert.doesNotMatch(failed.stderr, /private-marker| at /);
  }
});
test("selected workflow cannot transport an ordinary assembly or obtain deploy credentials", () => {
  const workflow = fs.readFileSync(path.join(root, ".github/workflows/deploy-test.yml"), "utf8");
  const validate = workflow.split("  validate:\n")[1].split("  deploy:\n")[0];
  const deploy = workflow.split("  deploy:\n")[1];
  assert.match(deploy.split("    steps:")[0], /if: needs.validate.outputs.promotion_mode == 'legacy'/);
  assert.match(validate, /vars.INFRA_TEST_PROMOTION_SELECTION_JSON/);
  assert.match(validate, /HEAD\^1/);
  for (const name of ["Assemble immutable TEST infrastructure release", "Compute immutable release identity", "Define artifact name", "Upload exact validated CDK assembly"]) {
    const step = validate.split(`      - name: ${name}\n`)[1].split("      - ")[0];
    assert.match(step, /if: steps.promotion.outputs.mode == 'legacy'/);
  }
  assert.doesNotMatch(validate, /id-token: write|configure-aws-credentials/);
  assert.match(workflow, /  workflow_dispatch:/, "the manual ordinary path must share the same guard");
  const candidate = fs.readFileSync(path.join(root, ".github/workflows/validate-thn-candidate.yml"), "utf8");
  assert.ok(candidate.includes("'codex/thn-first-provisioning-20260912'"), "the reviewed branch needs its credential-free full-history candidate check");
});
