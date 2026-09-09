"use strict";

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const modulePath = path.join(__dirname, "..", "tools", "thn-resource-inventory.js");
const inventory = fs.existsSync(modulePath) ? require(modulePath) : {};
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const bytes = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const resource = (logicalId, overrides = {}) => ({
  logicalId, physicalIdSha256: digest(logicalId), resourceType: "AWS::Lambda::Function",
  configurationSha256: digest(`config ${logicalId}`), classification: "persistent-blog",
  purpose: "blog-runtime", retention: "managed", releaseArtifactSha256: null, tracking: "cloudformation", ...overrides,
});
function snapshot(resources = [resource("BlogFunction")]) {
  return { schemaVersion: 1, environment: "test", domain: "thehairnarrative.com", stacks: [{
    stackIdSha256: digest("approved test stack"), owner: "zoolandingpage-aws-infra", complete: true,
    terminationProtection: true, resources: resources.sort((a, b) => a.logicalId < b.logicalId ? -1 : 1),
  }] };
}
function inputs(baseline, expected = baseline, observed = expected, phase = "final") {
  return { phase, baseline: bytes(baseline), baselineSha256: digest(bytes(baseline)),
    expected: bytes(expected), expectedSha256: digest(bytes(expected)),
    observed: bytes(observed), observedSha256: digest(bytes(observed)) };
}
function check(value) {
  assert.equal(typeof inventory.checkInventory, "function", "offline inventory comparator is required");
  return inventory.checkInventory(value);
}

test("complete approved final inventory passes without changing inputs or exposing identities", () => {
  const f = snapshot([resource("BlogFunction"), resource("ProtectedTable", {
    resourceType: "AWS::DynamoDB::Table", classification: "protected-retained-data",
    purpose: "protected-data", retention: "retain",
  })]);
  const original = bytes(f);
  const result = check(inputs(f));
  assert.equal(result.status, "verified");
  assert.equal(result.phase, "final");
  assert.equal(result.coverage, "declared-stack-inventories-only");
  assert.deepEqual(result.counts, { stacks: 1, baselineResources: 2, expectedResources: 2, observedResources: 2, removedTransients: 0 });
  assert.deepEqual(result.classifications, { "persistent-blog": 1, "deployment-dependency": 0, "protected-retained-data": 1, transient: 0 });
  assert.ok(!JSON.stringify(result).includes("BlogFunction"));
  assert.ok(!JSON.stringify(result).includes("zoolandingpage-aws-infra"));
  assert.ok(bytes(f).equals(original));
});

test("each independently supplied digest is required and raw-byte tampering fails", () => {
  const value = inputs(snapshot());
  for (const name of ["baseline", "expected", "observed"]) {
    assert.throws(() => check({ ...value, [`${name}Sha256`]: "0".repeat(64) }), /thn_inventory_digest_invalid/);
    assert.throws(() => check({ ...value, [name]: Buffer.concat([value[name], Buffer.from(" ")]) }), /thn_inventory_digest_invalid/);
    assert.throws(() => check({ ...value, [`${name}Sha256`]: undefined }), /thn_inventory_digest_invalid/);
  }
});

test("closed schema denies malformed, incomplete, duplicated, unsorted and oversized snapshots", () => {
  const base = snapshot();
  for (const change of [s => { s.extra = true; }, s => { s.environment = "production"; },
    s => { s.stacks = []; }, s => { s.stacks[0].complete = false; },
    s => { s.stacks[0].complete = undefined; }, s => { s.stacks.push(structuredClone(s.stacks[0])); },
    s => { s.stacks[0].resources.push(structuredClone(s.stacks[0].resources[0])); },
    s => { s.stacks[0].resources[0].logicalId = "Blog*"; },
    s => { s.stacks[0].resources[0].physicalIdSha256 = "arn:aws:private-fixture"; },
    s => { s.stacks[0].resources = [resource("ZFunction"), resource("AFunction")]; },
    s => { s.stacks[0].resources[0].configurationSha256 = undefined; }]) {
    const invalid = structuredClone(base); change(invalid);
    assert.throws(() => check(inputs(base, base, invalid)), /thn_inventory_schema_invalid/);
  }
  const duplicate = Buffer.from(`{"schemaVersion":1,${bytes(base).toString().trim().slice(1)}\n`);
  assert.throws(() => check({ ...inputs(base), observed: duplicate, observedSha256: digest(duplicate) }), /thn_inventory_schema_invalid/);
  const huge = Buffer.alloc(2 * 1024 * 1024 + 1, 32);
  assert.throws(() => check({ ...inputs(base), observed: huge, observedSha256: digest(huge) }), /thn_inventory_schema_invalid/);
});

test("scope and owner changes cannot be hidden in otherwise valid sealed snapshots", () => {
  const base = snapshot();
  for (const change of [s => { s.stacks[0].stackIdSha256 = digest("another stack"); },
    s => { s.stacks[0].owner = "zoolanding-auth-admin"; },
    s => { s.stacks.push({ ...structuredClone(s.stacks[0]), stackIdSha256: "f".repeat(64) }); }]) {
    const changed = structuredClone(base); change(changed);
    assert.throws(() => check(inputs(base, changed, changed)), /thn_inventory_scope_invalid/);
    assert.throws(() => check(inputs(base, base, changed)), /thn_inventory_scope_invalid/);
  }
});

test("digest fields must be strings, never values coerced by a regular expression", () => {
  const base = snapshot();
  for (const field of ["baselineSha256", "expectedSha256", "observedSha256"]) {
    const value = inputs(base);
    assert.throws(() => check({ ...value, [field]: [value[field]] }), /thn_inventory_digest_invalid/);
  }
  for (const change of [s => { s.stacks[0].stackIdSha256 = [s.stacks[0].stackIdSha256]; },
    s => { s.stacks[0].resources[0].physicalIdSha256 = [s.stacks[0].resources[0].physicalIdSha256]; },
    s => { s.stacks[0].resources[0].configurationSha256 = [s.stacks[0].resources[0].configurationSha256]; }]) {
    const invalid = structuredClone(base); change(invalid);
    assert.throws(() => check(inputs(invalid)), /thn_inventory_schema_invalid/);
  }
  const invalid = snapshot([resource("ActiveVersion", { resourceType: "AWS::Lambda::Version",
    classification: "deployment-dependency", purpose: "release-active", retention: "retain",
    releaseArtifactSha256: [digest("approved release")] })]);
  assert.throws(() => check(inputs(invalid)), /thn_inventory_schema_invalid/);
});

test("an empty reviewed stack cannot certify that its missing capture is clean", () => {
  const empty = snapshot([]);
  assert.throws(() => check(inputs(empty)), /thn_inventory_schema_invalid/);
  const base = snapshot();
  const twoStacks = structuredClone(base);
  twoStacks.stacks.push({ ...structuredClone(empty.stacks[0]), stackIdSha256: "f".repeat(64) });
  assert.throws(() => check(inputs(twoStacks)), /thn_inventory_schema_invalid/);
});

test("unknown or missing final resources and unapproved configuration changes fail closed", () => {
  const base = snapshot();
  for (const change of [s => { s.stacks[0].resources = []; },
    s => { s.stacks[0].resources.push(resource("UnapprovedFunction")); },
    s => { s.stacks[0].resources[0].configurationSha256 = digest("new config"); },
    s => { s.stacks[0].resources[0].physicalIdSha256 = digest("replaced service"); }]) {
    const changed = structuredClone(base); change(changed);
    assert.throws(() => check(inputs(base, base, changed)), /thn_inventory_observed_mismatch/);
  }
});

test("post-deployment QA requires exactly zero infrastructure delta even if a larger expected set is supplied", () => {
  const base = snapshot();
  assert.equal(check(inputs(base, base, base, "qa")).status, "verified");
  for (const change of [s => { s.stacks[0].resources.push(resource("QaExtraFunction")); },
    s => { s.stacks[0].resources[0].configurationSha256 = digest("changed configuration"); },
    s => { s.stacks[0].resources[0].physicalIdSha256 = digest("changed identity"); },
    s => { s.stacks[0].terminationProtection = false; }]) {
    const changed = structuredClone(base); change(changed);
    assert.throws(() => check(inputs(base, changed, changed, "qa")), /thn_inventory_(qa_delta|protection)_invalid/);
  }
});

test("final permits reviewed permanent additions and removal of baseline transients, never leftover transient or QA-only services", () => {
  const transient = resource("TemporaryOperation", { classification: "transient", purpose: "transient-operation", retention: "transient" });
  const base = snapshot([resource("BlogFunction"), transient]);
  const expected = snapshot([resource("BlogFunction"), resource("RequiredMediator")]);
  assert.equal(check(inputs(base, expected)).counts.removedTransients, 1);
  assert.throws(() => check(inputs(base)), /thn_inventory_leftover_invalid/);
  const qaOnly = snapshot([resource("QaOnlyService", { classification: "transient", purpose: "qa-only", retention: "transient" })]);
  assert.throws(() => check(inputs(qaOnly)), /thn_inventory_leftover_invalid/);
  assert.throws(() => check(inputs(qaOnly, qaOnly, qaOnly, "qa")), /thn_inventory_leftover_invalid/);
});

test("baseline purpose, retention, classification and protected identities cannot be rewritten away", () => {
  const base = snapshot([resource("ProtectedTable", { resourceType: "AWS::DynamoDB::Table",
    classification: "protected-retained-data", purpose: "protected-data", retention: "retain" })]);
  for (const change of [s => { s.stacks[0].resources = []; },
    s => { Object.assign(s.stacks[0].resources[0], { classification: "persistent-blog", purpose: "blog-runtime", retention: "managed" }); },
    s => { s.stacks[0].resources[0].physicalIdSha256 = digest("replacement"); },
    s => { s.stacks[0].terminationProtection = false; }]) {
    const changed = structuredClone(base); change(changed);
    assert.throws(() => check(inputs(base, changed, changed)), /thn_inventory_protection_invalid/);
  }
  const role = snapshot([resource("DeployRole", { resourceType: "AWS::IAM::Role", classification: "deployment-dependency",
    purpose: "deployment-control", retention: "retain" })]);
  const weakened = structuredClone(role); weakened.stacks[0].resources[0].retention = "managed";
  assert.throws(() => check(inputs(role, weakened, weakened)), /thn_inventory_protection_invalid/);
});

test("retained rollback code versions require exact approved identities and artifact hashes, not service wildcards", () => {
  const version = resource("BlogRollbackVersion", { resourceType: "AWS::Lambda::Version", classification: "deployment-dependency",
    purpose: "release-rollback", retention: "retain", releaseArtifactSha256: digest("approved immutable release") });
  const base = snapshot([resource("BlogFunction"), version]);
  assert.equal(check(inputs(base)).classifications["deployment-dependency"], 1);
  for (const patch of [{ releaseArtifactSha256: null }, { logicalId: "BlogVersion*" },
    { resourceType: "AWS::Lambda::Function" }, { retention: "managed" }]) {
    const invalid = snapshot([resource("BlogFunction"), { ...version, ...patch }]);
    assert.throws(() => check(inputs(invalid)), /thn_inventory_schema_invalid/);
  }
  const unapproved = snapshot([resource("BlogFunction"), version, { ...version, logicalId: "ExtraVersion", physicalIdSha256: digest("extra") }]);
  assert.throws(() => check(inputs(base, base, unapproved)), /thn_inventory_observed_mismatch/);
});

test("active and rollback versions have distinct closed purposes and exact immutable release provenance", () => {
  const active = resource("ActiveVersion", { resourceType: "AWS::Lambda::Version", classification: "deployment-dependency",
    purpose: "release-active", retention: "retain", releaseArtifactSha256: digest("active immutable release") });
  const rollback = { ...active, logicalId: "RollbackVersion", physicalIdSha256: digest("old version"),
    purpose: "release-rollback", releaseArtifactSha256: digest("previous immutable release") };
  const base = snapshot([active, resource("BlogFunction"), rollback]);
  assert.equal(check(inputs(base)).classifications["deployment-dependency"], 2);
  const missingDigest = structuredClone(base); missingDigest.stacks[0].resources[0].releaseArtifactSha256 = null;
  assert.throws(() => check(inputs(missingDigest)), /thn_inventory_schema_invalid/);
  for (const patch of [{ releaseArtifactSha256: digest("another release") },
    { physicalIdSha256: digest("replacement version") }]) {
    const changed = structuredClone(base); Object.assign(changed.stacks[0].resources[0], patch);
    assert.throws(() => check(inputs(base, changed, changed)), /thn_inventory_protection_invalid/);
    assert.throws(() => check(inputs(base, base, changed)), /thn_inventory_observed_mismatch/);
  }
});

test("final accepts reviewed active/rollback purpose swaps only on the same retained code version", () => {
  for (const tracking of ["cloudformation", "retained-detached"]) {
    for (const [from, to] of [["release-active", "release-rollback"], ["release-rollback", "release-active"]]) {
      const version = resource("ExactVersion", { resourceType: "AWS::Lambda::Version", classification: "deployment-dependency",
        purpose: from, retention: "retain", releaseArtifactSha256: digest("same approved immutable release"), tracking });
      const base = snapshot([resource("BlogFunction"), version]);
      const expected = structuredClone(base);
      expected.stacks[0].resources.find(item => item.logicalId === version.logicalId).purpose = to;
      const result = check(inputs(base, expected, expected, "final"));
      assert.equal(result.status, "verified");
      assert.equal(result.counts.removedTransients, 0);
      assert.equal(result.counts.observedResources, 2);
      assert.equal(base.stacks[0].resources.find(item => item.logicalId === version.logicalId).purpose, from);
    }
  }
});

test("version purpose swaps remain forbidden during QA or without exact reviewed expected agreement", () => {
  for (const [from, to] of [["release-active", "release-rollback"], ["release-rollback", "release-active"]]) {
    const version = resource("ExactVersion", { resourceType: "AWS::Lambda::Version", classification: "deployment-dependency",
      purpose: from, retention: "retain", releaseArtifactSha256: digest("approved immutable release") });
    const base = snapshot([resource("BlogFunction"), version]);
    const changed = structuredClone(base);
    changed.stacks[0].resources.find(item => item.logicalId === version.logicalId).purpose = to;
    assert.throws(() => check(inputs(base, changed, changed, "qa")), /thn_inventory_(qa_delta|protection)_invalid/);
    assert.throws(() => check(inputs(base, base, changed, "final")), /thn_inventory_observed_mismatch/);
    assert.throws(() => check(inputs(base, changed, base, "final")), /thn_inventory_(observed_mismatch|protection_invalid)/);
    const unsealed = inputs(base, changed, changed, "final");
    unsealed.expectedSha256 = digest(bytes(base));
    assert.throws(() => check(unsealed), /thn_inventory_digest_invalid/);
  }
});

test("a final version purpose swap never permits changed identity provenance tracking type retention or deletion", () => {
  const version = resource("ExactVersion", { resourceType: "AWS::Lambda::Version", classification: "deployment-dependency",
    purpose: "release-active", retention: "retain", releaseArtifactSha256: digest("approved immutable release") });
  const base = snapshot([resource("BlogFunction"), version]);
  for (const patch of [
    { physicalIdSha256: digest("different version") }, { releaseArtifactSha256: digest("different artifact") },
    { tracking: "retained-detached" }, { resourceType: "AWS::Lambda::Function" },
    { classification: "persistent-blog" }, { retention: "managed" }, { logicalId: "SubstituteVersion" },
  ]) {
    const changed = structuredClone(base);
    Object.assign(changed.stacks[0].resources.find(item => item.logicalId === version.logicalId), { purpose: "release-rollback", ...patch });
    assert.throws(() => check(inputs(base, changed, changed)), /thn_inventory_(schema|protection)_invalid/);
  }
  assert.throws(() => check(inputs(base, snapshot([resource("BlogFunction")]))), /thn_inventory_protection_invalid/);
  const otherBase = snapshot([resource("BlogFunction")]);
  const relabeled = snapshot([resource("BlogFunction", { classification: "deployment-dependency", purpose: "deployment-control", retention: "retain" })]);
  assert.throws(() => check(inputs(otherBase, relabeled, relabeled)), /thn_inventory_protection_invalid/);
});

test("exact retained detached versions and certificate validation CNAMEs remain in the reviewed inventory", () => {
  const detached = resource("DetachedRollbackVersion", { resourceType: "AWS::Lambda::Version", classification: "deployment-dependency",
    purpose: "release-rollback", retention: "retain", releaseArtifactSha256: digest("retained release"), tracking: "retained-detached" });
  const cname = resource("CertificateValidationCname", { resourceType: "AWS::Route53::RecordSet", classification: "deployment-dependency",
    purpose: "deployment-control", retention: "retain", tracking: "certificate-dns" });
  const base = snapshot([resource("BlogFunction"), detached, cname]);
  assert.equal(check(inputs(base)).counts.observedResources, 3);
  for (const logicalId of [detached.logicalId, cname.logicalId]) {
    const missing = structuredClone(base); missing.stacks[0].resources = missing.stacks[0].resources.filter(item => item.logicalId !== logicalId);
    assert.throws(() => check(inputs(base, base, missing)), /thn_inventory_observed_mismatch/);
    assert.throws(() => check(inputs(base, missing, missing)), /thn_inventory_protection_invalid/);
  }
  for (const invalid of [{ ...detached, resourceType: "AWS::Lambda::Function" },
    { ...cname, resourceType: "AWS::S3::Bucket" }, { ...cname, tracking: "all-account-scan" }]) {
    assert.throws(() => check(inputs(snapshot([invalid]))), /thn_inventory_schema_invalid/);
  }
  const relabeled = structuredClone(base); relabeled.stacks[0].resources.find(item => item.logicalId === detached.logicalId).tracking = "cloudformation";
  assert.throws(() => check(inputs(base, relabeled, relabeled)), /thn_inventory_protection_invalid/);
});

test("CLI reads only supplied local files, never writes them, and emits sanitized verdicts", t => {
  assert.ok(fs.existsSync(modulePath), "offline CLI is required");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "thn-inventory-cli-"));
  t.after(() => { assert.equal(path.dirname(directory), os.tmpdir()); fs.rmSync(directory, { recursive: true }); });
  const contents = bytes(snapshot());
  const file = path.join(directory, "snapshot.json"); fs.writeFileSync(file, contents);
  const args = [modulePath, "qa", file, digest(contents), file, digest(contents), file, digest(contents)];
  const success = spawnSync(process.execPath, args, { encoding: "utf8" });
  assert.equal(success.status, 0, success.stderr);
  assert.equal(JSON.parse(success.stdout).status, "verified");
  assert.equal(fs.readdirSync(directory).length, 1);
  assert.ok(fs.readFileSync(file).equals(contents));
  for (const invalid of [[...args.slice(0, -1), "0".repeat(64)], [modulePath, "cleanup", file],
    [modulePath, "final", path.join(directory, "private-example-name"), "a".repeat(64), file, digest(contents), file, digest(contents)]]) {
    const failure = spawnSync(process.execPath, invalid, { encoding: "utf8" });
    assert.equal(failure.status, 1);
    assert.equal(failure.stdout, "");
    assert.deepEqual(JSON.parse(failure.stderr), { status: "blocked", reason: "thn_inventory_check_failed" });
    assert.ok(!failure.stderr.includes("private-example-name"));
  }
  const source = fs.readFileSync(modulePath, "utf8");
  assert.doesNotMatch(source, /child_process|https?:|aws-sdk|writeFile|unlink|rmSync|execSync|spawn/);
});
