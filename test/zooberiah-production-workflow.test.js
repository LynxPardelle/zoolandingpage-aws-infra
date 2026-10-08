"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("Zooberiah production workflow is manual, source-bound, reviewed, and exact", () => {
  const workflowPath = path.resolve(__dirname, "../.github/workflows/zooberiah-production-frontdoor.yml");
  assert.equal(fs.existsSync(workflowPath), true);
  const workflow = fs.readFileSync(workflowPath, "utf8").replace(/\r\n/g, "\n");
  assert.match(workflow, /^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /\n  push:/);
  assert.match(workflow, /options: \[generated, aliases\]/);
  assert.match(workflow, /options: \[deploy, rollback\]/);
  assert.match(workflow, /options: \[review, execute, cleanup\]/);
  assert.match(workflow, /test "\$GITHUB_REF" = refs\/heads\/main/);
  assert.match(workflow, /test "\$GITHUB_SHA" = "\$EXPECTED_SOURCE_SHA"/);
  assert.match(workflow, /git\/ref\/heads\/main/);
  assert.match(workflow, /node tools\/zooberiah-production-frontdoor\.js prepare/);
  assert.match(workflow, /node tools\/zooberiah-production-frontdoor\.js operate/);
  assert.match(workflow, /generated_sha256/);
  assert.match(workflow, /transport\/generated-template\.json/);
  assert.match(workflow, /RELEASE_ID: \$\{\{ inputs\.release_id \}\}/);
  assert.match(workflow, /PHASE: \$\{\{ inputs\.phase \}\}/);
  assert.match(
    workflow,
    /run: node tools\/zooberiah-production-frontdoor\.js operate "\$RELEASE_ID" "\$PHASE" transport\/desired-template\.json transport\/generated-template\.json/
  );
  assert.doesNotMatch(
    workflow,
    /run: node tools\/zooberiah-production-frontdoor\.js operate ['"]\$\{\{ inputs\./
  );
  assert.match(workflow, /role-to-assume: arn:aws:iam::[0-9]+:role\/zoolandingpage-infra-production-github-oidc-deploy/);
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /expected_review_digest/);
  assert.match(workflow, /reviewed_run_id/);
  assert.match(workflow, /zooberiah-production-frontdoor-review-/);
  const operationJob = workflow.split("\n  operation:\n")[1];
  assert.ok(operationJob, "operation job must exist");
  const operationEnvironment = operationJob.split("\n    steps:\n")[0];
  assert.match(operationEnvironment, /\n      GH_TOKEN: \$\{\{ github\.token \}\}/);
});
