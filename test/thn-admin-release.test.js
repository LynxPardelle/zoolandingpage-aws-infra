"use strict";

const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { fixture, digest, bytes } = require("./fixtures/thn-admin-selection");
const modulePath = path.join(__dirname, "..", "tools", "thn-admin-release.js");
const consumer = existsSync(modulePath) ? require(modulePath) : {};
const select = inputs => {
  assert.equal(typeof consumer.selectThnAdminRelease, "function", "exact admin release consumer is required");
  return consumer.selectThnAdminRelease(inputs);
};

test("disabled admin needs no selection and performs no I/O", () => {
  assert.equal(select({}), null);
  assert.equal(select({ FRONTEND_TEST_THN_ADMIN_ORIGIN_ENABLED: "false", FRONTEND_TEST_THN_ADMIN_MANIFEST_BASE64: "invalid" }), null);
});

test("enabled selection binds exact manifest bytes and independent source metadata", () => {
  const f = fixture(["/browser/chunk-2ZPUOXRY.js", "/browser/thn-admin-assets/1234abcd1234abcd.angora-styles.css"]);
  const selected = select(f.inputs);
  assert.deepEqual(selected.manifest, f.manifest);
  assert.deepEqual(selected.metadata, f.metadata);
  assert.equal(selected.originPrefix, f.prefix);
  assert.throws(() => select({ ...f.inputs, FRONTEND_TEST_THN_ADMIN_MANIFEST_BASE64: `${f.inputs.FRONTEND_TEST_THN_ADMIN_MANIFEST_BASE64}\n` }), /thn_admin_release_invalid/);
  assert.throws(() => select({ ...f.inputs, FRONTEND_TEST_THN_ADMIN_RELEASE_METADATA_JSON: JSON.stringify({ ...f.metadata, manifestSha256: "0".repeat(64) }) }), /thn_admin_release_invalid/);
});

test("selection rejects missing, unknown, duplicate and oversized metadata", () => {
  const f = fixture();
  for (const metadata of [undefined, {}, { ...f.metadata, environment: "production" }, { ...f.metadata, unexpected: true }, { ...f.metadata, releaseId: "../other" }]) {
    assert.throws(() => select({ ...f.inputs, FRONTEND_TEST_THN_ADMIN_RELEASE_METADATA_JSON: JSON.stringify(metadata) }), /thn_admin_release_invalid/);
  }
  assert.throws(() => select({ ...f.inputs, FRONTEND_TEST_THN_ADMIN_RELEASE_METADATA_JSON: `{"schemaVersion":1,${JSON.stringify(f.metadata).slice(1)}` }), /thn_admin_release_invalid/);
  assert.throws(() => select({ ...f.inputs, FRONTEND_TEST_THN_ADMIN_MANIFEST_BASE64: "A".repeat(32769) }), /thn_admin_release_invalid/);
});

test("manifest rejects absent hashes, path collisions, traversal and non-public paths", () => {
  for (const paths of [[], ["/browser/main.js"], ["/browser/main-notahash.js"], ["/browser/main-2ZPUOXRY.js", "/browser/main-2ZPUOXRY.js"],
    ["/browser/main-2ZPUOXRY.js", "/browser/MAIN-2ZPUOXRY.js"], ["/browser/../main-2ZPUOXRY.js"], ["/browser/%2e/main-2ZPUOXRY.js"],
    ["/browser/server/main-2ZPUOXRY.js"], ["/browser/main-2ZPUOXRY.js?x=1"], ["/browser/*"], ["/main-2ZPUOXRY.js"],
    ["/browser/1234abcd1234abcd.policy.json"], Array.from({ length: 65 }, (_, i) => `/browser/${i}-1234abcd.js`)]) {
    assert.throws(() => select(fixture(paths).inputs), /thn_admin_release_invalid/, JSON.stringify(paths));
  }
});

test("published preflight binds completion marker, delivery, exact bytes and assets before mutation", async () => {
  const f = fixture();
  const calls = [];
  const selected = select(f.inputs);
  assert.equal(typeof consumer.verifyPublishedAdminRelease, "function");
  const result = await consumer.verifyPublishedAdminRelease(selected, async key => {
    calls.push(key);
    assert.ok(f.objects.has(key), "read must use exact immutable release object keys");
    return f.objects.get(key);
  });
  assert.equal(result, true);
  assert.equal(new Set(calls).size, 4);
  assert.ok(calls.every(key => key.startsWith(`${f.prefix}/`)));
});

test("published preflight rejects missing marker, digest, source and route drift", async () => {
  const f = fixture();
  const selected = select(f.inputs);
  assert.equal(typeof consumer.verifyPublishedAdminRelease, "function");
  for (const name of ["manifest.json", "delivery.json", "thn-admin-release.json", "thn-route-manifest.json"]) {
    await assert.rejects(() => consumer.verifyPublishedAdminRelease(selected, async key => {
      if (key.endsWith(`/${name}`)) return Buffer.from("{}");
      return f.objects.get(key);
    }), /thn_admin_published_release_invalid/);
  }
  const modified = structuredClone(f.delivery);
  modified.sourceCommit = "b".repeat(40);
  const wrongSource = { ...selected, metadata: { ...selected.metadata, deliverySha256: digest(bytes(modified)) } };
  await assert.rejects(() => consumer.verifyPublishedAdminRelease(wrongSource, async key => key.endsWith("/delivery.json") ? bytes(modified) : f.objects.get(key)), /thn_admin_published_release_invalid/);
  const missingAsset = structuredClone(f.delivery);
  missingAsset.files = missingAsset.files.filter(item => !item.path.startsWith("staging/"));
  const wrongInventory = { ...selected, metadata: { ...selected.metadata, deliverySha256: digest(bytes(missingAsset)) } };
  await assert.rejects(() => consumer.verifyPublishedAdminRelease(wrongInventory, async key => key.endsWith("/delivery.json") ? bytes(missingAsset) : f.objects.get(key)), /thn_admin_published_release_invalid/);
});

test("delivery inventory uses the producer's exact ordinal ordering for mixed-case files", async () => {
  const f = fixture(["/browser/Zfile-12345678.js", "/browser/afile-12345678.js"]);
  const delivery = { ...f.delivery, files: [...f.delivery.files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0) };
  const selected = select(f.inputs);
  selected.metadata.deliverySha256 = digest(bytes(delivery));
  assert.equal(await consumer.verifyPublishedAdminRelease(selected, async key => key.endsWith("/delivery.json") ? bytes(delivery) : f.objects.get(key)), true);
  const localeOrdered = { ...delivery, files: [...delivery.files].sort((a, b) => a.path.localeCompare(b.path)) };
  assert.notDeepEqual(localeOrdered.files, delivery.files);
  selected.metadata.deliverySha256 = digest(bytes(localeOrdered));
  await assert.rejects(() => consumer.verifyPublishedAdminRelease(selected, async key => key.endsWith("/delivery.json") ? bytes(localeOrdered) : f.objects.get(key)), /thn_admin_published_release_invalid/);
});

test("ACM preflight requires issued exact host certificate pinned by artifact hash", () => {
  assert.equal(typeof consumer.verifyAdminCertificate, "function");
  const arn = "arn:aws:acm:us-east-1:123456789012:certificate/fixture";
  const expected = { arn, arnSha256: digest(arn), accountId: "123456789012" };
  const response = { Certificate: { CertificateArn: arn, Status: "ISSUED", DomainName: "admin-test.thehairnarrative.com",
    SubjectAlternativeNames: ["admin-test.thehairnarrative.com"] } };
  assert.equal(consumer.verifyAdminCertificate(response, expected), true);
  for (const patch of [{ Status: "PENDING_VALIDATION" }, { Status: "EXPIRED" }, { DomainName: "*.thehairnarrative.com" },
    { SubjectAlternativeNames: [] }, { SubjectAlternativeNames: ["*.thehairnarrative.com"] },
    { SubjectAlternativeNames: ["admin-test.thehairnarrative.com", "thehairnarrative.com"] },
    { CertificateArn: arn.replace("us-east-1", "us-west-2") }, { CertificateArn: arn.replace("123456789012", "999999999999") }]) {
    assert.throws(() => consumer.verifyAdminCertificate({ Certificate: { ...response.Certificate, ...patch } }, expected), /thn_admin_certificate_invalid/);
  }
  assert.throws(() => consumer.verifyAdminCertificate(response, { ...expected, arnSha256: "0".repeat(64) }), /thn_admin_certificate_invalid/);
  assert.throws(() => consumer.verifyAdminCertificate(response, { ...expected, accountId: "999999999999" }), /thn_admin_certificate_invalid/);
  assert.throws(() => consumer.verifyAdminCertificate({}, expected), /thn_admin_certificate_invalid/);
});

test("ACM selection reads only the exact immutable TEST stack and admin distribution", () => {
  assert.equal(typeof consumer.adminCertificateFromAssembly, "function");
  const arn = "arn:aws:acm:us-east-1:123456789012:certificate/fixture";
  const entry = { type: "aws:cloudformation:stack", properties: {
    stackName: "ZoolandingTest-Zoolandingpage-test-Frontend", templateFile: "test.template.json" } };
  const assembly = { artifacts: { stack: entry } };
  const template = { Resources: { Admin: { Type: "AWS::CloudFront::Distribution", Properties: { DistributionConfig: {
    Aliases: ["admin-test.thehairnarrative.com"], ViewerCertificate: { AcmCertificateArn: arn } } } } } };
  const read = file => { assert.equal(file, "test.template.json"); return template; };
  assert.equal(consumer.adminCertificateFromAssembly(assembly, read), arn);
  for (const invalid of [{ artifacts: {} }, { artifacts: { a: entry, b: entry } },
    { artifacts: { stack: { ...entry, properties: { ...entry.properties, templateFile: "../outside.json" } } } },
    { artifacts: { stack: { ...entry, properties: { ...entry.properties, stackName: "production" } } } }]) {
    assert.throws(() => consumer.adminCertificateFromAssembly(invalid, read), /thn_admin_release_invalid/);
  }
  assert.throws(() => consumer.adminCertificateFromAssembly(assembly, () => ({ Resources: {} })), /thn_admin_release_invalid/);
  const extra = structuredClone(template);
  extra.Resources.Admin.Properties.DistributionConfig.Aliases.push("thehairnarrative.com");
  assert.throws(() => consumer.adminCertificateFromAssembly(assembly, () => extra), /thn_admin_release_invalid/);
});

test("final transported assembly gate measures UTF-8 bytes and total cache behaviors without truncation", () => {
  assert.equal(typeof consumer.verifyAdminAssemblyQuotas, "function");
  const assembly = { artifacts: { stack: { type: "aws:cloudformation:stack", properties: {
    stackName: "ZoolandingTest-Zoolandingpage-test-Frontend", templateFile: "test.template.json" } } } };
  const template = { Resources: { Edge: { Type: "AWS::CloudFront::Function", Properties: { FunctionCode: "a".repeat(10240) } },
    Admin: { Type: "AWS::CloudFront::Distribution", Properties: { DistributionConfig: {
      Aliases: ["admin-test.thehairnarrative.com"], CacheBehaviors: Array.from({ length: 49 }, () => ({})),
      DefaultCacheBehavior: { FunctionAssociations: [{ EventType: "viewer-request", FunctionARN: { "Fn::GetAtt": ["Edge", "FunctionARN"] } }] },
    } } } } };
  assert.deepEqual(consumer.verifyAdminAssemblyQuotas(assembly, () => template), { functionBytes: 10240, orderedBehaviors: 49 });
  for (const code of ["a".repeat(10241), "é".repeat(5121), undefined]) {
    const changed = structuredClone(template);
    changed.Resources.Edge.Properties.FunctionCode = code;
    assert.throws(() => consumer.verifyAdminAssemblyQuotas(assembly, () => changed), /thn_admin_assembly_quota_invalid/);
  }
  const tooMany = structuredClone(template);
  tooMany.Resources.Admin.Properties.DistributionConfig.CacheBehaviors = Array.from({ length: 75 }, () => ({}));
  assert.throws(() => consumer.verifyAdminAssemblyQuotas(assembly, () => tooMany), /thn_admin_assembly_quota_invalid/);
});

test("release CLI attests ACM and immutable S3 metadata read-only; failure prevents subsequent reads", async t => {
  assert.equal(typeof consumer.main, "function");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "thn-infra-release-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const f = fixture();
  const arn = "arn:aws:acm:us-east-1:123456789012:certificate/fixture";
  const selection = path.join(directory, "thn-admin-selection.json");
  const assembly = path.join(directory, "cdk.out", "assembly-ZoolandingTest");
  fs.mkdirSync(assembly, { recursive: true });
  fs.writeFileSync(selection, bytes(select(f.inputs)));
  fs.writeFileSync(path.join(directory, "release-metadata.json"), bytes({
    expected_aws_account_id: "123456789012", expected_aws_region: "us-east-1", thn_admin_origin_enabled: "true",
    thn_admin_certificate_sha256: digest(arn), thn_admin_hosted_zone_sha256: digest("ZFIXTURE"),
  }));
  fs.writeFileSync(path.join(assembly, "manifest.json"), bytes({ artifacts: { stack: {
    type: "aws:cloudformation:stack", properties: { stackName: "ZoolandingTest-Zoolandingpage-test-Frontend", templateFile: "test.template.json" },
  } } }));
  const retained = retainedCertificate();
  const template = { Resources: {
    ThnAdminTestCertificate: retained,
    Edge: { Type: "AWS::CloudFront::Function", Properties: { FunctionCode: "function handler(e){return e.request;}" } }, Admin: {
    Type: "AWS::CloudFront::Distribution", Properties: { DistributionConfig: {
      Aliases: ["admin-test.thehairnarrative.com"], ViewerCertificate: { AcmCertificateArn: arn },
      CacheBehaviors: [], DefaultCacheBehavior: { FunctionAssociations: [{ EventType: "viewer-request", FunctionARN: { "Fn::GetAtt": ["Edge", "FunctionARN"] } }] },
    } },
  } } };
  fs.writeFileSync(path.join(assembly, "test.template.json"), bytes(template));
  const previous = { THN_ADMIN_ORIGIN_ENABLED: process.env.THN_ADMIN_ORIGIN_ENABLED, EXPECTED_AWS_ACCOUNT_ID: process.env.EXPECTED_AWS_ACCOUNT_ID };
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  process.env.THN_ADMIN_ORIGIN_ENABLED = "true";
  process.env.EXPECTED_AWS_ACCOUNT_ID = "123456789012";
  const calls = [];
  const read = args => {
    calls.push(args.slice(0, 2).join(" "));
    if (args[0] === "acm") return bytes({ Certificate: { CertificateArn: arn, Status: "ISSUED",
      DomainName: "admin-test.thehairnarrative.com", SubjectAlternativeNames: ["admin-test.thehairnarrative.com"] } });
    if (args[1] === "get-template") return bytes({ TemplateBody: template });
    if (args[1] === "describe-stack-resource") return bytes({ StackResourceDetail: { StackName: "ZoolandingTest-Zoolandingpage-test-Frontend",
      LogicalResourceId: "ThnAdminTestCertificate", ResourceType: "AWS::CertificateManager::Certificate", ResourceStatus: "CREATE_COMPLETE", PhysicalResourceId: arn } });
    if (args[0] === "cloudformation") return bytes({ Stacks: [{ StackName: "ZoolandingTest-Zoolandingpage-test-Frontend",
      Outputs: [{ OutputKey: "FrontendArtifactBucketName", OutputValue: "zoolandingpage-test-frontend-artifacts-123456789012" }] }] });
    assert.equal(args[0], "s3");
    assert.equal(args[1], "cp");
    assert.equal(args[3], "-", "S3 transport must be download-to-memory only");
    const prefix = "s3://zoolandingpage-test-frontend-artifacts-123456789012/";
    assert.ok(args[2].startsWith(prefix));
    const result = f.objects.get(args[2].slice(prefix.length));
    assert.ok(result, "only exact published metadata keys may be read");
    return result;
  };
  await consumer.main(["verify", selection], read);
  assert.deepEqual(calls, ["cloudformation get-template", "cloudformation describe-stack-resource", "acm describe-certificate", "cloudformation describe-stacks", "s3 cp", "s3 cp", "s3 cp", "s3 cp"]);
  let failedCalls = 0;
  await assert.rejects(() => consumer.main(["verify", selection], args => {
    if (args[0] !== "acm") return read(args);
    failedCalls++; return bytes({ Certificate: { Status: "PENDING_VALIDATION" } });
  }), /thn_admin_certificate_invalid/);
  assert.equal(failedCalls, 1);
  await assert.rejects(() => consumer.main(["verify", selection], () => { throw new Error("AccessDenied"); }));
  const transportedTemplate = JSON.parse(fs.readFileSync(path.join(assembly, "test.template.json")));
  transportedTemplate.Resources.Edge.Properties.FunctionCode = "é".repeat(5121);
  fs.writeFileSync(path.join(assembly, "test.template.json"), bytes(transportedTemplate));
  let quotaReads = 0;
  await assert.rejects(() => consumer.main(["verify", selection], () => { quotaReads++; throw new Error("unexpected AWS read"); }), /thn_admin_assembly_quota_invalid/);
  assert.equal(quotaReads, 0, "final assembly quota rejection must precede even the first AWS read");
  process.env.THN_ADMIN_ORIGIN_ENABLED = "false";
  fs.writeFileSync(selection, bytes(null));
  const disabledMetadata = JSON.parse(fs.readFileSync(path.join(directory, "release-metadata.json")));
  disabledMetadata.thn_admin_origin_enabled = "false";
  fs.writeFileSync(path.join(directory, "release-metadata.json"), bytes(disabledMetadata));
  fs.writeFileSync(path.join(assembly, "test.template.json"), bytes({ Resources: { ThnAdminTestCertificate: retained } }));
  await consumer.main(["verify", selection], read);
  const noCertificate = { Resources: {} };
  fs.writeFileSync(path.join(assembly, "test.template.json"), bytes(noCertificate));
  await assert.rejects(() => consumer.main(["verify", selection], read), /thn_admin_certificate_preservation/);
});

function retainedCertificate() {
  return { Type: "AWS::CertificateManager::Certificate", DeletionPolicy: "Retain", UpdateReplacePolicy: "Retain", Properties: {
    DomainName: "admin-test.thehairnarrative.com", ValidationMethod: "DNS", CertificateExport: "DISABLED",
    DomainValidationOptions: [{ DomainName: "admin-test.thehairnarrative.com", HostedZoneId: "ZFIXTURE" }],
  } };
}

test("normal release requires the same existing retained certificate; absent, swapped, replaced and removed ownership fail closed", () => {
  assert.equal(typeof consumer.verifyCertificatePreservation, "function");
  const arn = "arn:aws:acm:us-east-1:123456789012:certificate/fixture";
  const template = { Resources: { ThnAdminTestCertificate: retainedCertificate() } };
  const resource = { StackName: "ZoolandingTest-Zoolandingpage-test-Frontend", LogicalResourceId: "ThnAdminTestCertificate",
    ResourceType: "AWS::CertificateManager::Certificate", ResourceStatus: "CREATE_COMPLETE", PhysicalResourceId: arn };
  const metadata = { thn_admin_certificate_sha256: digest(arn), thn_admin_hosted_zone_sha256: digest("ZFIXTURE") };
  const check = (desired = template, live = template, detail = resource, selected = arn) => consumer.verifyCertificatePreservation(desired, live, metadata, detail, selected);
  assert.equal(check(), arn);
  assert.equal(check(template, template, resource, undefined), arn, "flags off must still preserve and attest ownership");
  assert.throws(() => check(template, { Resources: {} }), /thn_admin_certificate_preservation/);
  assert.throws(() => check({ Resources: {} }, template), /thn_admin_certificate_preservation/);
  assert.throws(() => check(template, template, { ...resource, PhysicalResourceId: arn + "other" }), /thn_admin_certificate_preservation/);
  assert.throws(() => check(template, template, resource, arn + "other"), /thn_admin_certificate_preservation/);
  for (const key of ["DeletionPolicy", "UpdateReplacePolicy"]) {
    const changed = structuredClone(template); changed.Resources.ThnAdminTestCertificate[key] = "Delete";
    assert.throws(() => check(changed), /thn_admin_certificate_preservation/);
  }
  const replacement = structuredClone(template); replacement.Resources.ThnAdminTestCertificate.Properties.DomainName = "other.thehairnarrative.com";
  assert.throws(() => check(replacement), /thn_admin_certificate_preservation/);
  assert.equal(consumer.verifyCertificatePreservation({ Resources: {} }, { Resources: {} }, { thn_admin_certificate_sha256: digest("") }), null);
});
