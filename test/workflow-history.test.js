"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

for (const filename of [
  "cdk-validate.yml",
  "thn-identity-tests.yml",
  "validate-thn-candidate.yml",
  "deploy-test.yml",
  "thn-test-permissions.yml",
  "thn-test-prerequisites.yml",
]) {
  test(`${filename} fetches history before validating committed scanner fingerprints`, () => {
    const workflow = readFileSync(path.join(__dirname, "../.github/workflows", filename), "utf8")
      .replace(/\r\n/g, "\n");
    const checkout = workflow.match(/^      - uses: actions\/checkout@[^\n]+\n((?:^(?!      - ).*\n)*)/m);
    assert.ok(checkout, "validation must explicitly check out its source");
    assert.match(checkout[1], /^          fetch-depth: 0\s*$/m,
      "exact committed fingerprints require historical Git objects, including in offline tests");
    const suiteIndex = workflow.search(/npm test|node --test/);
    assert.ok(suiteIndex > checkout.index, "source checkout must precede the full test suite");
  });
}
