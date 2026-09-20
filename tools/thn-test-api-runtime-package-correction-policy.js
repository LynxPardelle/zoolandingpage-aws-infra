"use strict";
const { canonical, sha } = require("./thn-test-prerequisites");
const TARGET = Object.freeze({ role: "zoolanding-deployer-api-proxy-test-github-deploy",
  logical: "ThnApiRuntimePackageCorrectionPolicy", prefix: "ThnApiRuntimeCorrected",
  service: "zoolanding-api-proxy-test", owner: "operator-role",
  policyName: "ThnTestRuntimePackageCorrectionV1" });
const SOURCE_SHA = "45c6a2586a481333221fdafbbbd4e503a8560b8b";
const fail = () => { throw new Error("thn_runtime_package_correction_guard_failed"); };
const same = (a, b) => canonical(a) === canonical(b);
const keys = (value, expected) => value && typeof value === "object" && !Array.isArray(value)
  && same(Object.keys(value).sort(), [...expected].sort());
const ref = name => ({ Ref: TARGET.prefix + name });
function parameterDefinitions() {
  return Object.fromEntries(["PackageObjectArn", "PackageVersionId", "RecordObjectArn", "RecordVersionId"]
    .map(name => [TARGET.prefix + name, { Type: "String", NoEcho: true, MinLength: 1, MaxLength: 2048 }]));
}
function policyResource() {
  const read = name => ({ Effect: "Allow", Action: ["s3:GetObjectVersion"], Resource: [ref(name + "ObjectArn")],
    Condition: { StringEquals: { "s3:VersionId": ref(name + "VersionId") } } });
  return { Type: "AWS::IAM::RolePolicy", Properties: { RoleName: TARGET.role, PolicyName: TARGET.policyName,
    PolicyDocument: { Version: "2012-10-17", Statement: [read("Package"), read("Record")] } } };
}
function validateBindings(binding, config) {
  try {
    if (!keys(binding, ["schemaVersion", "service", "environment", "account", "stackId", "sourceSha",
      "packageSha256", "package", "record"]) || binding.schemaVersion !== 1
      || binding.service !== "api-runtime-corrected" || binding.environment !== "test"
      || !/^[0-9]{12}$/.test(binding.account) || binding.account !== config.account
      || sha(binding.account) !== config.anchors.account || sha(canonical(binding)) !== config.expectedBindingSha256
      || sha(binding.stackId) !== config.expectedStackSha256
      || !new RegExp(`^arn:aws:cloudformation:us-east-1:${binding.account}:stack/${TARGET.service}/[A-Za-z0-9-]+$`).test(binding.stackId)
      || binding.sourceSha !== SOURCE_SHA || !/^[a-f0-9]{64}$/.test(binding.packageSha256)) fail();
    for (const [name, folder, filename] of [["package", "thn-runtime", "runtime-v2.zip"],
      ["record", "first-provisioning", "plan.json"]]) {
      const item = binding[name];
      if (!keys(item, ["bucket", "key", "versionId"]) || item.bucket !== config.channelBucket
        || typeof item.bucket !== "string" || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(item.bucket)
        || item.key !== `${TARGET.service}/${folder}/${SOURCE_SHA}/git-lf/${binding.packageSha256}/${filename}`
        || typeof item.versionId !== "string" || !/^[A-Za-z0-9_.+/-]{1,1024}$/.test(item.versionId)
        || item.versionId === "null") fail();
    }
    return Object.fromEntries(["Package", "Record"].flatMap(name => {
      const item = binding[name.toLowerCase()];
      return [[TARGET.prefix + name + "ObjectArn", `arn:aws:s3:::${item.bucket}/${item.key}`],
        [TARGET.prefix + name + "VersionId", item.versionId]];
    }));
  } catch { fail(); }
}
module.exports = { TARGET, SOURCE_SHA, parameterDefinitions, policyResource, validateBindings };
