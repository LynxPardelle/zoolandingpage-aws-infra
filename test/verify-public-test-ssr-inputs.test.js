"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { readPublicTestSsrInputs } = require("../tools/verify-public-test-ssr-inputs");

const root = path.join(__dirname, "..");
const current = "previous-public-1";
const candidate = "next-public-2";
const digest = "a".repeat(64);
const manifestSha256 = "b".repeat(64);
const invalid = /public_test_ssr_selection_invalid/;
const inputs = {
  GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_REF: "refs/heads/test",
  ADMIN_INFRASTRUCTURE_APPROVED: "false",
  ADMIN_ROUTE_ASSOCIATION_APPROVED: "false",
  FRONTEND_TEST_RELEASE_ID: candidate,
  PUBLIC_SSR_ACTION: "review",
  PUBLIC_SSR_CURRENT_RELEASE_ID: current,
  PUBLIC_SSR_RELEASE_ID: candidate,
  PUBLIC_SSR_REVIEW_DIGEST: "",
  PUBLIC_SSR_MANIFEST_SHA256: manifestSha256,
};

test("ordinary pushes and private dispatches leave the public release mode unset", () => {
  for (const event of ["push", "workflow_dispatch"]) {
    assert.equal(readPublicTestSsrInputs({
      GITHUB_EVENT_NAME: event, GITHUB_REF: "refs/heads/test",
      ADMIN_INFRASTRUCTURE_APPROVED: "true", ADMIN_ROUTE_ASSOCIATION_APPROVED: "true",
      FRONTEND_TEST_RELEASE_ID: current,
    }), null);
  }
});

test("review needs a distinct release; execute also needs the approved digest", () => {
  assert.deepEqual(readPublicTestSsrInputs(inputs), {
    action: "review", currentReleaseId: current, releaseId: candidate, reviewDigest: "", manifestSha256,
  });
  assert.deepEqual(readPublicTestSsrInputs({ ...inputs, PUBLIC_SSR_ACTION: "execute", PUBLIC_SSR_REVIEW_DIGEST: digest }), {
    action: "execute", currentReleaseId: current, releaseId: candidate, reviewDigest: digest, manifestSha256,
  });
  for (const overrides of [
    { PUBLIC_SSR_ACTION: "execute" },
    { PUBLIC_SSR_REVIEW_DIGEST: digest },
    { PUBLIC_SSR_ACTION: "execute", PUBLIC_SSR_REVIEW_DIGEST: digest.toUpperCase() },
    { PUBLIC_SSR_ACTION: "execute", PUBLIC_SSR_REVIEW_DIGEST: "a".repeat(63) },
    { PUBLIC_SSR_MANIFEST_SHA256: "" },
    { PUBLIC_SSR_MANIFEST_SHA256: "b".repeat(63) },
    { PUBLIC_SSR_MANIFEST_SHA256: manifestSha256.toUpperCase() },
    { PUBLIC_SSR_CURRENT_RELEASE_ID: candidate },
    { PUBLIC_SSR_RELEASE_ID: "" },
    { PUBLIC_SSR_CURRENT_RELEASE_ID: "../outside" },
    { PUBLIC_SSR_CURRENT_RELEASE_ID: "malformed..current" },
    { PUBLIC_SSR_RELEASE_ID: "malformed..candidate", FRONTEND_TEST_RELEASE_ID: "malformed..candidate" },
    { PUBLIC_SSR_ACTION: "" },
    { PUBLIC_SSR_ACTION: "deploy" },
    { FRONTEND_TEST_RELEASE_ID: current },
  ]) assert.throws(() => readPublicTestSsrInputs({ ...inputs, ...overrides }), invalid);
});

test("selected public releases reject pushes, other refs and any private approval", () => {
  for (const overrides of [
    { GITHUB_EVENT_NAME: "push" },
    { GITHUB_REF: "refs/heads/main" },
    { GITHUB_REF: "refs/heads/dev" },
    { GITHUB_REF: "refs/tags/test" },
    { ADMIN_INFRASTRUCTURE_APPROVED: "true" },
    { ADMIN_ROUTE_ASSOCIATION_APPROVED: "true" },
    { ADMIN_INFRASTRUCTURE_APPROVED: "true", ADMIN_ROUTE_ASSOCIATION_APPROVED: "true" },
    { ADMIN_INFRASTRUCTURE_APPROVED: undefined },
  ]) assert.throws(() => readPublicTestSsrInputs({ ...inputs, ...overrides }), invalid);
});

test("CLI reports only a stable error for invalid inputs", () => {
  const tool = path.join(root, "tools", "verify-public-test-ssr-inputs.js");
  const run = env => spawnSync(process.execPath, [tool], { env: { ...process.env, ...env }, encoding: "utf8" });
  const good = run(inputs);
  assert.equal(good.status, 0, good.stderr);
  assert.equal(good.stdout, "");
  const bad = run({ ...inputs, PUBLIC_SSR_CURRENT_RELEASE_ID: "marker-not-for-logs/" });
  assert.equal(bad.status, 1);
  assert.equal(bad.stdout, "");
  assert.equal(bad.stderr, "public_test_ssr_selection_invalid\n");
});

test("TEST workflow requires an explicit scoped dispatch before sealing a public release", () => {
  const workflow = readFileSync(path.join(root, ".github/workflows/deploy-test.yml"), "utf8").replace(/\r\n/g, "\n");
  const trigger = workflow.slice(0, workflow.indexOf("\npermissions:"));
  assert.match(trigger.split("  workflow_dispatch:")[0], /push:\n    branches: \[test\]/);
  assert.doesNotMatch(trigger.split("  workflow_dispatch:")[0], /public_ssr_/);
  assert.match(trigger, /workflow_dispatch:[\s\S]*public_ssr_action:/);
  const validate = workflow.split("\n  validate:\n")[1].split("\n  deploy:\n")[0];
  const scopedGate = validate.match(/if \[\[ -n "\$\{PUBLIC_SSR_ACTION\}[^\n]+\n([\s\S]*?)\n          fi/)?.[1];
  assert.match(scopedGate ?? "", /test "\$GITHUB_EVENT_NAME" = workflow_dispatch[\s\S]*?test "\$mode" = thn-source-only/);
  assert.match(scopedGate, /test "\$ADMIN_INFRASTRUCTURE_APPROVED" = false/);
  assert.match(scopedGate, /test "\$ADMIN_ROUTE_ASSOCIATION_APPROVED" = false/);
  assert.match(scopedGate, /verify-public-test-ssr-inputs\.js\n\s+public_action="\$PUBLIC_SSR_ACTION"/);
  assert.match(validate, /PUBLIC_SSR_MANIFEST_SHA256: \$\{\{ inputs\.public_ssr_manifest_sha256 \}\}/);
  assert.doesNotMatch(scopedGate, /mode=legacy/);
  assert.match(validate, /printf 'public_ssr_action=%s\\n' "\$public_action" >> "\$GITHUB_OUTPUT"/);
  assert.match(validate, /cp tools\/verify-public-test-template\.js \.release\/release-tools\//);
  assert.doesNotMatch(validate, /configure-aws-credentials|id-token: write/);
  assert.match(workflow, /git\/ref\/heads\/test[\s\S]+verify-public-ssr-baseline[\s\S]+run-test-infra-change-set\.sh/);
});

test("review exits before execution and execute checks the reviewed digest and activated template", () => {
  const runner = readFileSync(path.join(root, "tools/run-test-infra-change-set.sh"), "utf8").replace(/\r\n/g, "\n");
  const awsGuard = readFileSync(path.join(root, "tools/infra-test-aws.js"), "utf8");
  const review = runner.match(/if \[\[ "\$\{PUBLIC_SSR_ACTION:-\}" == review \]\]; then\n([\s\S]*?)\nfi/)?.[1];
  assert.match(review ?? "", /review-public-ssr[\s\S]*executed=false[\s\S]*exit 0/);
  assert.doesNotMatch(review, /execute-change-set/);
  assert.match(runner, /execute-change-set[\s\S]*wait-stack[\s\S]*verify-public-ssr-activated/);
  assert.match(awsGuard, /verifyPublicTestChangeSet\(description\)[\s\S]+publicSsr\.reviewDigest[\s\S]+client\(\["cloudformation", "execute-change-set"/);
});
