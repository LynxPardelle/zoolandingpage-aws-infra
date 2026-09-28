"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const modulePath = path.join(__dirname, "../tools/thn-dedicated-identity-candidate.js");

test("candidate exposes only the three TEST IAM additions and pinned bootstrap authority", () => {
  assert.ok(fs.existsSync(modulePath), "the dedicated identity candidate exporter is missing");
  const { candidate } = require(modulePath);
  const result = candidate();
  assert.deepEqual(Object.keys(result).sort(), ["additions", "authority"]);
  assert.deepEqual(Object.keys(result.additions).sort(), [
    "ThnDedicatedRuntimeTestCloudFormationRoleCF799F56",
    "ThnDedicatedRuntimeTestExecutionPolicy",
    "ThnDedicatedRuntimeTestGithubPolicy",
  ]);
  assert.equal(result.additions.ThnDedicatedRuntimeTestGithubPolicy.Type, "AWS::IAM::ManagedPolicy");
  assert.equal(result.authority.stackName, "ZoolandingTest-Zoolandingpage-test-ServiceRepositoryBootstrap");
  assert.equal(result.authority.region, "us-east-1");
});

test("candidate contains no production role or stack target", () => {
  assert.ok(fs.existsSync(modulePath), "the dedicated identity candidate exporter is missing");
  const { candidate } = require(modulePath);
  const result = JSON.stringify(candidate());
  assert.ok(!result.includes("ZoolandingProduction"));
  assert.ok(!result.includes("zoolanding-deployer-thn-auth-runtime-production"));
});
