"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const sha = "a".repeat(40), tree = "b".repeat(40), base = "c".repeat(40), merged = "d".repeat(40);
const selected = overrides => JSON.stringify({schemaVersion:1, mode:"thn-source-only", sourceSha:sha, sourceTree:tree, targetBaseSha:base, mergeTree:merged, ...overrides});
function classify(raw, context={sourceSha:sha, sourceTree:tree, targetBaseSha:base, mergeTree:merged}) {
  return require("../tools/classify-production-promotion").classifySelection(raw, context);
}
test("production push requires an exact source, source tree, main base and native merge tree selector", () => {
  assert.equal(classify(selected()), "thn-source-only");
  for (const raw of [undefined,null,"", " ", "null", "[]", selected({extra:true}), selected({schemaVersion:true}), selected({mode:"legacy"})]) assert.throws(()=>classify(raw), /production_promotion_selection_invalid/);
  for (const key of ["sourceSha","sourceTree","targetBaseSha","mergeTree"]) assert.throws(()=>classify(selected({[key]:"e".repeat(40)})), /stale/);
});
test("production selection rejects duplicates, escaped duplicates and malformed objects before parsing", () => {
  for (const raw of [selected().replace('"schemaVersion":1','"schemaVersion":1,"schemaVersion":1'), selected().replace('"schemaVersion":1','"schemaVersion":1,"schema\\u0056ersion":1'), selected().replace('"schemaVersion":1','"schemaVersion":NaN'), selected({sourceSha:"0".repeat(40)}), selected({mergeTree:tree.toUpperCase()}), " ".repeat(4097)]) assert.throws(()=>classify(raw), /invalid/);
});
test("missing or invalid observed production context cannot fall through to delivery",()=>{
  assert.throws(()=>classify(selected(),{}),/production_promotion_context_invalid/);
});
test("production workflow validates without credentials and cannot deploy on a main push or unspecified manual dispatch",()=>{
  const yml=fs.readFileSync(path.join(__dirname,"../.github/workflows/deploy-production.yml"),"utf8");
  assert.match(yml,/INFRA_PRODUCTION_PROMOTION_SELECTION_JSON/);
  assert.match(yml,/PROMOTED_MERGE_TREE/);
  assert.doesNotMatch(yml,/cdk deploy/);
  assert.doesNotMatch(yml,/id-token: write|configure-aws-credentials/);
  assert.match(yml,/npm test/);
});
