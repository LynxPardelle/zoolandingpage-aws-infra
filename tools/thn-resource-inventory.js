"use strict";

const fs = require("node:fs");
const { createHash } = require("node:crypto");

const MAX_BYTES = 2 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;
const isSha256 = value => typeof value === "string" && SHA256.test(value);
const OWNERS = new Set(["zoolandingpage-aws-infra", "zoolanding-api-proxy", "zoolanding-config-authoring",
  "zoolanding-auth-admin", "zoolanding-content-hub", "zoolanding-image-upload", "zoolanding-config-runtime-read"]);
const CLASSES = ["persistent-blog", "deployment-dependency", "protected-retained-data", "transient"];
const digest = value => createHash("sha256").update(value).digest("hex");
const canonical = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const fail = reason => { throw new Error(`thn_inventory_${reason}_invalid`); };
const keys = (value, expected) => value && typeof value === "object" && !Array.isArray(value)
  && same(Object.keys(value).sort(), [...expected].sort());
const sortedUnique = values => new Set(values).size === values.length && same(values, [...values].sort());

function parseInventory(raw, expectedDigest) {
  if (!Buffer.isBuffer(raw) || !isSha256(expectedDigest) || digest(raw) !== expectedDigest) fail("digest");
  try {
    if (raw.length < 2 || raw.length > MAX_BYTES) fail("schema");
    const data = JSON.parse(raw);
    if (!canonical(data).equals(raw) || !keys(data, ["schemaVersion", "environment", "domain", "stacks"])
      || data.schemaVersion !== 1 || data.environment !== "test" || data.domain !== "thehairnarrative.com"
      || !Array.isArray(data.stacks) || data.stacks.length < 1 || data.stacks.length > 16) fail("schema");
    for (const stack of data.stacks) {
      if (!keys(stack, ["stackIdSha256", "owner", "complete", "terminationProtection", "resources"])
        || !isSha256(stack.stackIdSha256) || !OWNERS.has(stack.owner) || stack.complete !== true
        || typeof stack.terminationProtection !== "boolean" || !Array.isArray(stack.resources)
        || stack.resources.length > 10000) fail("schema");
      for (const item of stack.resources) {
        if (!keys(item, ["logicalId", "physicalIdSha256", "resourceType", "configurationSha256", "classification",
          "purpose", "retention", "releaseArtifactSha256", "tracking"])
          || typeof item.logicalId !== "string" || !/^[A-Za-z][A-Za-z0-9]{0,254}$/.test(item.logicalId)
          || !isSha256(item.physicalIdSha256) || !isSha256(item.configurationSha256)
          || typeof item.resourceType !== "string" || item.resourceType.length > 128
          || !/^(?:AWS::[A-Za-z0-9]+::[A-Za-z0-9]+|Custom::[A-Za-z][A-Za-z0-9]+)$/.test(item.resourceType)
          || !CLASSES.includes(item.classification)
          || !["cloudformation", "retained-detached", "certificate-dns"].includes(item.tracking)) fail("schema");
        const codeVersion = ["release-active", "release-rollback"].includes(item.purpose);
        if (codeVersion || item.resourceType === "AWS::Lambda::Version") {
          if (!codeVersion || item.resourceType !== "AWS::Lambda::Version" || item.classification !== "deployment-dependency"
            || item.retention !== "retain" || !isSha256(item.releaseArtifactSha256)) fail("schema");
        } else if (item.releaseArtifactSha256 !== null) fail("schema");
        if (item.tracking === "retained-detached" && item.resourceType !== "AWS::Lambda::Version") fail("schema");
        if (item.tracking === "certificate-dns" && (item.resourceType !== "AWS::Route53::RecordSet"
          || item.classification !== "deployment-dependency" || item.purpose !== "deployment-control" || item.retention !== "retain")) fail("schema");
        const rules = {
          "persistent-blog": [["blog-runtime"], ["managed", "retain"]],
          "deployment-dependency": [["deployment-control", "release-active", "release-rollback"], ["managed", "retain"]],
          "protected-retained-data": [["protected-data"], ["retain"]],
          transient: [["transient-operation", "qa-only"], ["transient"]],
        };
        if (!rules[item.classification][0].includes(item.purpose) || !rules[item.classification][1].includes(item.retention)) fail("schema");
      }
      if (!sortedUnique(stack.resources.map(item => item.logicalId))
        || new Set(stack.resources.map(item => `${item.resourceType}:${item.physicalIdSha256}`)).size !== stack.resources.length) fail("schema");
    }
    if (!sortedUnique(data.stacks.map(stack => stack.stackIdSha256))) fail("schema");
    return data;
  } catch { fail("schema"); }
}

/** Compare independently sealed, complete local inventories. This grants no cleanup authority. */
function checkInventory(input) {
  if (!input || !["qa", "final"].includes(input.phase)) fail("phase");
  const baseline = parseInventory(input.baseline, input.baselineSha256);
  const expected = parseInventory(input.expected, input.expectedSha256);
  const observed = parseInventory(input.observed, input.observedSha256);
  const scope = data => data.stacks.map(stack => [stack.stackIdSha256, stack.owner]);
  if (!same(scope(baseline), scope(expected)) || !same(scope(expected), scope(observed))) fail("scope");
  let removedTransients = 0;
  for (let index = 0; index < baseline.stacks.length; index++) {
    const before = baseline.stacks[index];
    const after = expected.stacks[index];
    if (before.terminationProtection && !after.terminationProtection) fail("protection");
    const next = new Map(after.resources.map(item => [item.logicalId, item]));
    for (const resource of before.resources) {
      const target = next.get(resource.logicalId);
      if (!target) {
        if (resource.classification !== "transient") fail("protection");
        removedTransients++;
        continue;
      }
      // Only the sealed expected final inventory may change a retained version's release role.
      const reviewedVersionPurposeChange = input.phase === "final" && resource.resourceType === "AWS::Lambda::Version"
        && ["release-active", "release-rollback"].includes(resource.purpose)
        && ["release-active", "release-rollback"].includes(target.purpose);
      if (["classification", "retention", "resourceType", "releaseArtifactSha256", "tracking"].some(key => resource[key] !== target[key])
        || (resource.purpose !== target.purpose && !reviewedVersionPurposeChange)
        || (resource.retention === "retain" && resource.physicalIdSha256 !== target.physicalIdSha256)) fail("protection");
    }
  }
  if ([baseline, expected].some(data => data.stacks.some(stack => stack.resources.length === 0))) fail("schema");
  if (input.phase === "qa" && !same(baseline, expected)) fail("qa_delta");
  if (!same(expected, observed)) throw new Error("thn_inventory_observed_mismatch");
  const allResources = expected.stacks.flatMap(stack => stack.resources);
  if (allResources.some(item => item.purpose === "qa-only" || (input.phase === "final" && item.classification === "transient"))) fail("leftover");
  const classifications = Object.fromEntries(CLASSES.map(name => [name, allResources.filter(item => item.classification === name).length]));
  return { status: "verified", phase: input.phase, coverage: "declared-stack-inventories-only",
    counts: { stacks: expected.stacks.length, baselineResources: baseline.stacks.reduce((sum, stack) => sum + stack.resources.length, 0),
      expectedResources: allResources.length, observedResources: observed.stacks.reduce((sum, stack) => sum + stack.resources.length, 0), removedTransients },
    classifications, digests: { baselineSha256: input.baselineSha256, expectedSha256: input.expectedSha256, observedSha256: input.observedSha256 } };
}

function readLocal(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES) fail("schema");
  return fs.readFileSync(file);
}

function main(args) {
  if (args.length !== 7 || !["qa", "final"].includes(args[0])) fail("phase");
  const [phase, baselineFile, baselineSha256, expectedFile, expectedSha256, observedFile, observedSha256] = args;
  return checkInventory({ phase, baseline: readLocal(baselineFile), baselineSha256,
    expected: readLocal(expectedFile), expectedSha256, observed: readLocal(observedFile), observedSha256 });
}

if (require.main === module) {
  try { process.stdout.write(`${JSON.stringify(main(process.argv.slice(2)))}\n`); }
  catch { process.stderr.write('{"status":"blocked","reason":"thn_inventory_check_failed"}\n'); process.exitCode = 1; }
}
module.exports = { checkInventory, main };
