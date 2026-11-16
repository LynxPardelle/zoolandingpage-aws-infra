"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const api = require("../tools/lynx-music-offers-production-frontdoor");
const { distributionId, viewerId, hosts, outputId, tlsDomain } = require("../tools/lynx-music-offers-contract");
const { hostedZones } = require("../config/environments");

const releaseId = "lynx-offers-fixture";
const workflow = path.join(__dirname, "../.github/workflows/lynx-music-offers-production-frontdoor.yml");
const operator = path.join(__dirname, "../tools/lynx-music-offers-production-frontdoor.js");
const resourceIds = [...api.operationContract.resourceTypes.keys()];

function ownedChanges(ids, action) {
  return ids.map((id) => ({
    Type: "Resource",
    ResourceChange: { LogicalResourceId: id, ResourceType: api.operationContract.resourceTypes.get(id), Action: action },
  }));
}

function changeSet(Changes) {
  return { Status: "CREATE_COMPLETE", ExecutionStatus: "AVAILABLE", IncludeNestedStacks: false, Changes };
}

test("synthesized offer native rollout and rollback are limited to 6 then 2 exact resources", (t) => {
  const temp = fs.realpathSync(os.tmpdir());
  const destination = fs.mkdtempSync(path.join(temp, "zlp-lynx-frontdoor-test-"));
  t.after(() => {
    assert.equal(path.dirname(fs.realpathSync(destination)), temp);
    fs.rmSync(destination, { recursive: true, force: true });
  });
  const synth = spawnSync(process.execPath, [operator, "prepare", releaseId, "aliases", destination], { encoding: "utf8", timeout: 120_000 });
  assert.equal(synth.status, 0, synth.stderr);
  const read = (name) => JSON.parse(fs.readFileSync(path.join(destination, name), "utf8"));
  const generated = read("generated-template.json"), aliases = read("desired-template.json");
  const before = structuredClone(generated);
  for (const id of resourceIds) delete before.Resources[id];
  delete before.Outputs[outputId];

  const staged = api.project(before, generated, releaseId, "deploy", "generated", generated);
  assert.deepEqual(staged, generated);
  api.reviewChanges(before, staged, changeSet(ownedChanges(resourceIds, "Add")), "deploy", "generated");
  const attached = api.project(staged, aliases, releaseId, "deploy", "aliases", generated);
  assert.deepEqual(attached, aliases);
  api.reviewChanges(staged, attached, changeSet(ownedChanges([distributionId, viewerId], "Modify")), "deploy", "aliases");

  const detached = api.project(attached, aliases, releaseId, "rollback", "aliases", generated);
  assert.deepEqual(detached, staged);
  api.reviewChanges(attached, detached, changeSet(ownedChanges([distributionId, viewerId], "Modify")), "rollback", "aliases");
  const removed = api.project(detached, generated, releaseId, "rollback", "generated", generated);
  assert.deepEqual(removed, before);
  api.reviewChanges(detached, removed, changeSet(ownedChanges(resourceIds, "Remove")), "rollback", "generated");

  const outside = Object.keys(before.Resources).find((id) => before.Resources[id].Type === "AWS::CloudFront::Distribution");
  const outOfScope = structuredClone(attached);
  outOfScope.Resources[outside].Properties.DistributionConfig.Enabled = false;
  assert.throws(() => api.reviewChanges(staged, outOfScope, changeSet(ownedChanges([distributionId, viewerId], "Modify")), "deploy", "aliases"), /invalid_inventory/);
  const unrelatedChange = { Type: "Resource", ResourceChange: { LogicalResourceId: outside, Action: "Modify", ResourceType: "AWS::CloudFront::Distribution" } };
  assert.throws(() => api.reviewChanges(staged, attached, changeSet([...ownedChanges([distributionId, viewerId], "Modify"), unrelatedChange]), "deploy", "aliases"), /invalid_inventory/);
  const extraAlias = structuredClone(aliases);
  extraAlias.Resources[distributionId].Properties.DistributionConfig.Aliases.push("other.music.lynxpardelle.com");
  assert.throws(() => api.project(staged, extraAlias, releaseId, "deploy", "aliases", generated), /invalid_template/);
});

test("Runtime Read proof covers every exact production root and rejects any unpublished member", async () => {
  const observed = new Set();
  await api.verifyPublishedOffers(async (url) => {
    assert.equal(url.origin, "https://api.zoolandingpage.com.mx");
    assert.equal(url.searchParams.get("path"), "/");
    const domain = url.searchParams.get("domain");
    observed.add(domain);
    return { ok: true, json: async () => ({ domain, environment: "production", pageId: "default" }) };
  });
  assert.deepEqual([...observed], hosts);
  await assert.rejects(api.verifyPublishedOffers(async (url) => ({
    ok: true,
    json: async () => ({ domain: url.searchParams.get("domain"), environment: "test", pageId: "default" }),
  })), /offer_scope_not_published/);
});

test("DNS and certificate preflight allow only the validated wildcard and empty exact offer records", () => {
  const issued = {
    Status: "ISSUED", DomainName: tlsDomain, SubjectAlternativeNames: [tlsDomain],
    DomainValidationOptions: [{ DomainName: tlsDomain, ValidationStatus: "SUCCESS" }],
  };
  assert.equal(api.validIssuedCertificate(issued), true);
  assert.equal(api.validIssuedCertificate({ ...issued, SubjectAlternativeNames: [...issued.SubjectAlternativeNames, "other.example.com"] }), false);
  assert.equal(api.validIssuedCertificate({ ...issued, Status: "PENDING_VALIDATION" }), false);
  const probe = (records) => (kind, service, operation) => {
    assert.equal(kind, "lookup");
    assert.equal(service, "route53");
    if (operation === "get-hosted-zone") return { HostedZone: { Id: `/hostedzone/${hostedZones.lynxPardelle.hostedZoneId}`, Name: "lynxpardelle.com.", Config: { PrivateZone: false } } };
    assert.equal(operation, "list-resource-record-sets");
    return { ResourceRecordSets: records, IsTruncated: false };
  };
  api.assertOfferDnsAbsent(probe([{ Name: "music.lynxpardelle.com.", Type: "A" }]));
  assert.throws(() => api.assertOfferDnsAbsent(probe([{ Name: `${hosts[0]}.`, Type: "A" }])), /offer_dns_already_present/);
  assert.throws(() => api.assertOfferDnsAbsent(probe([{ Name: "\\052.music.lynxpardelle.com.", Type: "CNAME" }])), /offer_dns_already_present/);
  assert.throws(() => api.assertOfferDnsAbsent(probe([{ Name: "music.lynxpardelle.com.", Type: "NS" }])), /invalid_zone/);
});

test("workflow binds current protected main, distinct phase reviews and the exact source package", () => {
  const source = fs.readFileSync(workflow, "utf8");
  assert.match(source, /workflow_dispatch:/);
  assert.doesNotMatch(source, /\bon:\s*\n\s*(?:push|pull_request):|route53 change-resource-record-sets|cdk deploy/);
  assert.match(source, /lynx-music-offers-production-frontdoor\.yml/);
  assert.match(source, /\.purpose\(process\.env\.ACTION,process\.env\.PHASE\)/);
  assert.match(source, /environment: production/);
  assert.match(source, /expected_review_digest/);
  assert.ok(source.indexOf(".assertAuthority()") < source.indexOf("aws-actions/configure-aws-credentials@"));
  assert.equal(new Set(["deploy", "rollback"].flatMap((action) => ["generated", "aliases"].map((phase) => api.purpose(action, phase)))).size, 4);
  assert.match(api.sourcePackageHash(), /^[a-f0-9]{64}$/);
});
