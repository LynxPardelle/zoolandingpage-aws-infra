"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

test("THN identity release is manual, TEST-only and checks the source before AWS credentials", () => {
  const file = path.join(__dirname, "../.github/workflows/thn-dedicated-identity-test.yml");
  assert.ok(fs.existsSync(file), "the dedicated identity workflow is missing");
  const source = fs.readFileSync(file, "utf8");
  assert.match(source, /workflow_dispatch:/);
  assert.match(source, /environment: test/);
  assert.match(source, /refs\/heads\/test/);
  assert.match(source, /reviewed_additions_sha256:/);
  assert.match(source, /thn_dedicated_identity_release\.py/);
  assert.ok(source.indexOf("Validate source and candidate without AWS") < source.indexOf("configure-aws-credentials@"));
  assert.doesNotMatch(source, /push:|pull_request:|environment: production|cdk deploy/);
});

test("THN identity revision is a separate manual TEST-only one-policy workflow", () => {
  const file = path.join(__dirname, "../.github/workflows/thn-dedicated-identity-revision-test.yml");
  assert.ok(fs.existsSync(file), "the exact policy revision workflow is missing");
  const source = fs.readFileSync(file, "utf8");
  assert.match(source, /workflow_dispatch:/);
  assert.match(source, /environment: test/);
  assert.match(source, /refs\/heads\/test/);
  assert.match(source, /reviewed_additions_sha256:/);
  assert.match(source, /thn_dedicated_identity_revision\.py/);
  assert.ok(source.indexOf("Validate source and candidate without AWS") < source.indexOf("configure-aws-credentials@"));
  assert.doesNotMatch(source, /push:|pull_request:|environment: production|cdk deploy/);
});
