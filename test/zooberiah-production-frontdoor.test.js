"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const toolPath = path.resolve(__dirname, "../tools/zooberiah-production-frontdoor.js");
const api = fs.existsSync(toolPath) ? require(toolPath) : {};

test("Zooberiah compiler and projection expose a closed staged front door", () => {
  assert.equal(typeof api.prepareZooberiahFrontDoor, "function");
  assert.equal(typeof api.projectZooberiahFrontDoor, "function");
  assert.equal(typeof api.reviewZooberiahChanges, "function");

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "zooberiah-frontdoor-"));
  try {
    const prepared = api.prepareZooberiahFrontDoor("release-123", directory);
    assert.match(prepared.desiredTemplateSha256, /^[a-f0-9]{64}$/);
    assert.match(prepared.generatedTemplateSha256, /^[a-f0-9]{64}$/);
    const desired = JSON.parse(fs.readFileSync(path.join(directory, "desired-template.json"), "utf8"));
    const generatedDesired = JSON.parse(
      fs.readFileSync(path.join(directory, "generated-template.json"), "utf8")
    );
    assert.deepEqual(generatedDesired, desired);
    const entries = api.zooberiahResourceEntries(desired);
    assert.equal(entries.length, 6);

    const distribution = entries.find(([, resource]) => resource.Type === "AWS::CloudFront::Distribution");
    assert.ok(distribution);
    assert.equal(
      distribution[1].Properties.DistributionConfig.Comment,
      "Zoolandingpage Angular SSR frontend (production/zooberiahsystems)"
    );
    assert.equal(distribution[1].Properties.DistributionConfig.Aliases, undefined);
    assert.equal(distribution[1].Properties.DistributionConfig.ViewerCertificate, undefined);

    const before = structuredClone(desired);
    for (const [logicalId] of entries) delete before.Resources[logicalId];
    delete before.Outputs.FrontendDistributionDomainNameZooberiahsystems;
    const sharedSsr = Object.entries(before.Resources).find(([, resource]) =>
      resource.Type === "AWS::Lambda::Function"
      && resource.Properties?.FunctionName === "zoolandingpage-production-frontend-ssr"
    );
    assert.ok(sharedSsr);
    const [sharedSsrId, sharedSsrResource] = sharedSsr;
    const zooberiahHosts = new Set(["zooberiahsystems.com", "www.zooberiahsystems.com"]);
    const originalAllowedHosts = sharedSsrResource.Properties.Environment.Variables.NG_ALLOWED_HOSTS
      .split(",")
      .filter((host) => !zooberiahHosts.has(host))
      .join(",");
    sharedSsrResource.Properties.Environment.Variables.NG_ALLOWED_HOSTS = originalAllowedHosts;
    before.Resources.UnrelatedRetained = {
      Type: "AWS::S3::Bucket",
      Properties: { BucketName: "retained-example" },
    };
    desired.Resources.UnexpectedNew = { Type: "AWS::DynamoDB::Table" };

    const wrongRelease = structuredClone(before);
    wrongRelease.Resources[sharedSsrId].Properties.Environment.Variables.ZLP_RELEASE_ID = "release-other";
    assert.throws(
      () => api.projectZooberiahFrontDoor(wrongRelease, desired, "release-123", "deploy"),
      /zooberiah_frontdoor_release_binding_invalid/
    );
    const wrongObject = structuredClone(before);
    wrongObject.Resources[sharedSsrId].Properties.Code.S3Key =
      "frontend/angular-ssr/production/releases/release-other/server/ssr-handler.zip";
    assert.throws(
      () => api.projectZooberiahFrontDoor(wrongObject, desired, "release-123", "deploy"),
      /zooberiah_frontdoor_release_binding_invalid/
    );

    const deploy = api.projectZooberiahFrontDoor(before, desired, "release-123", "deploy");
    assert.equal(api.zooberiahResourceEntries(deploy).length, 6);
    assert.deepEqual(deploy.Resources.UnrelatedRetained, before.Resources.UnrelatedRetained);
    assert.equal(deploy.Resources.UnexpectedNew, undefined);
    assert.ok(deploy.Outputs.FrontendDistributionDomainNameZooberiahsystems);
    const deployedAllowedHosts = deploy.Resources[sharedSsrId].Properties.Environment.Variables.NG_ALLOWED_HOSTS
      .split(",");
    assert.equal(deployedAllowedHosts.filter((host) => host === "zooberiahsystems.com").length, 1);
    assert.equal(deployedAllowedHosts.filter((host) => host === "www.zooberiahsystems.com").length, 1);

    const deployChanges = api.zooberiahResourceEntries(deploy).map(([logicalId, resource]) => ({
      Type: "Resource",
      ResourceChange: {
        Action: "Add",
        LogicalResourceId: logicalId,
        ResourceType: resource.Type,
        Replacement: "False",
      },
    }));
    deployChanges.push({
      Type: "Resource",
      ResourceChange: {
        Action: "Modify",
        LogicalResourceId: sharedSsrId,
        ResourceType: "AWS::Lambda::Function",
        Replacement: "False",
        Scope: ["Properties"],
      },
    });
    assert.equal(
      api.reviewZooberiahChanges(before, deploy, {
        Status: "CREATE_COMPLETE",
        ExecutionStatus: "AVAILABLE",
        Changes: deployChanges,
      }, "deploy").length,
      7
    );

    const rollback = api.projectZooberiahFrontDoor(deploy, desired, "release-123", "rollback");
    assert.equal(api.zooberiahResourceEntries(rollback).length, 0);
    assert.deepEqual(rollback.Resources.UnrelatedRetained, before.Resources.UnrelatedRetained);
    assert.equal(rollback.Outputs.FrontendDistributionDomainNameZooberiahsystems, undefined);
    assert.equal(
      rollback.Resources[sharedSsrId].Properties.Environment.Variables.NG_ALLOWED_HOSTS,
      originalAllowedHosts
    );

    const rollbackChanges = api.zooberiahResourceEntries(deploy).map(([logicalId, resource]) => ({
      Type: "Resource",
      ResourceChange: {
        Action: "Remove",
        LogicalResourceId: logicalId,
        ResourceType: resource.Type,
        Replacement: "False",
      },
    }));
    rollbackChanges.push({
      Type: "Resource",
      ResourceChange: {
        Action: "Modify",
        LogicalResourceId: sharedSsrId,
        ResourceType: "AWS::Lambda::Function",
        Replacement: "False",
        Scope: ["Properties"],
      },
    });
    assert.equal(
      api.reviewZooberiahChanges(deploy, rollback, {
        Status: "CREATE_COMPLETE",
        ExecutionStatus: "AVAILABLE",
        Changes: rollbackChanges,
      }, "rollback").length,
      7
    );

    assert.throws(
      () => api.reviewZooberiahChanges(before, deploy, {
        Status: "CREATE_COMPLETE",
        ExecutionStatus: "AVAILABLE",
        Changes: [...deployChanges, {
          Type: "Resource",
          ResourceChange: {
            Action: "Modify",
            LogicalResourceId: "UnrelatedRetained",
            ResourceType: "AWS::S3::Bucket",
            Replacement: "False",
          },
        }],
      }, "deploy"),
      /zooberiah_frontdoor_inventory_invalid/
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("Zooberiah native review seals one exact change set and blocks drift before execution", async () => {
  assert.equal(typeof api.runZooberiahOperation, "function");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "zooberiah-operation-"));
  try {
    api.prepareZooberiahFrontDoor("release-123", directory);
    const desired = JSON.parse(fs.readFileSync(path.join(directory, "desired-template.json"), "utf8"));
    const original = structuredClone(desired);
    for (const [logicalId] of api.zooberiahResourceEntries(desired)) delete original.Resources[logicalId];
    delete original.Outputs.FrontendDistributionDomainNameZooberiahsystems;
    const [sharedSsrId, sharedSsrResource] = Object.entries(original.Resources).find(([, resource]) =>
      resource.Type === "AWS::Lambda::Function"
      && resource.Properties?.FunctionName === "zoolandingpage-production-frontend-ssr"
    );
    sharedSsrResource.Properties.Environment.Variables.NG_ALLOWED_HOSTS =
      sharedSsrResource.Properties.Environment.Variables.NG_ALLOWED_HOSTS
        .split(",")
        .filter((host) => !["zooberiahsystems.com", "www.zooberiahsystems.com"].includes(host))
        .join(",");

    const stackId = "arn:aws:cloudformation:us-east-1:765932874577:stack/ZoolandingProduction-Zoolandingpage-production-Frontend/11111111-1111-1111-1111-111111111111";
    const baseline = {
      stackId,
      templates: { Original: original, Processed: original },
      parameters: [],
      resources: [],
      trust: { policy: "sealed" },
    };
    const objects = new Map();
    let candidate;
    let preview;
    let drift = false;
    let executions = 0;
    const call = (kind, service, operation, input, outputFile) => {
      const key = `${service}:${operation}`;
      if (key === "s3api:list-objects-v2") return { Contents: [] };
      if (key === "s3api:put-object") {
        objects.set(input.Key, fs.readFileSync(input.Body));
        return { VersionId: "v1" };
      }
      if (key === "s3api:get-object") {
        fs.writeFileSync(outputFile, objects.get(input.Key));
        return { VersionId: input.VersionId };
      }
      if (key === "cloudformation:create-change-set") {
        const objectKey = new URL(input.TemplateURL).pathname.slice(1);
        candidate = JSON.parse(objects.get(objectKey));
        const changes = api.zooberiahResourceEntries(candidate).map(([logicalId, resource]) => ({
          Type: "Resource",
          ResourceChange: {
            Action: "Add",
            LogicalResourceId: logicalId,
            ResourceType: resource.Type,
            Replacement: "False",
          },
        }));
        changes.push({
          Type: "Resource",
          ResourceChange: {
            Action: "Modify",
            LogicalResourceId: sharedSsrId,
            ResourceType: "AWS::Lambda::Function",
            Replacement: "False",
            Scope: ["Properties"],
          },
        });
        preview = {
          StackId: stackId,
          ChangeSetId: `arn:aws:cloudformation:us-east-1:765932874577:changeSet/${input.ChangeSetName}/11111111-1111-1111-1111-111111111111`,
          Status: "CREATE_COMPLETE",
          ExecutionStatus: "AVAILABLE",
          CreationTime: new Date().toISOString(),
          Changes: changes,
        };
        return { Id: preview.ChangeSetId };
      }
      if (key === "cloudformation:describe-change-set") return preview;
      if (key === "cloudformation:get-template") return { TemplateBody: candidate };
      if (key === "cloudformation:execute-change-set") {
        executions += 1;
        throw new Error("test_apply_boundary");
      }
      throw new Error(`unexpected_call:${key}`);
    };
    const options = {
      action: "deploy",
      call,
      desired,
      releaseId: "release-123",
      runId: "123-1",
      fingerprint: "c".repeat(64),
      sourceSha: "a".repeat(40),
      outputPath: path.join(directory, "review.json"),
      captureBaseline: () => ({ ...structuredClone(baseline), ...(drift ? { drift: true } : {}) }),
      verifySource: () => true,
      pause: async () => {},
    };
    const record = await api.runZooberiahOperation({ ...options, execution: "review" });
    assert.equal(record.purpose, "zooberiah-frontdoor");
    assert.equal(record.packageManifest.length, 1);
    assert.equal(executions, 0);

    drift = true;
    await assert.rejects(
      () => api.runZooberiahOperation({
        ...options,
        execution: "execute",
        record,
        approvedDigest: record.digest,
      }),
      /retained_review_stale/
    );
    assert.equal(executions, 0);

    drift = false;
    await assert.rejects(
      () => api.runZooberiahOperation({
        ...options,
        execution: "execute",
        record,
        approvedDigest: record.digest,
      }),
      /test_apply_boundary/
    );
    assert.equal(executions, 1);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("Zooberiah alias phase changes only its staged resources and never creates DNS records", () => {
  const generatedDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "zooberiah-generated-"));
  const aliasesDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "zooberiah-aliases-"));
  try {
    api.prepareZooberiahFrontDoor("release-123", generatedDirectory, "generated");
    api.prepareZooberiahFrontDoor("release-123", aliasesDirectory, "aliases");
    const generatedDesired = JSON.parse(
      fs.readFileSync(path.join(generatedDirectory, "desired-template.json"), "utf8")
    );
    const aliasesDesired = JSON.parse(
      fs.readFileSync(path.join(aliasesDirectory, "desired-template.json"), "utf8")
    );
    const aliasesDistribution = api.zooberiahResourceEntries(aliasesDesired)
      .find(([, resource]) => resource.Type === "AWS::CloudFront::Distribution")[1]
      .Properties.DistributionConfig;
    assert.deepEqual(aliasesDistribution.Aliases, [
      "zooberiahsystems.com",
      "www.zooberiahsystems.com",
    ]);
    assert.match(
      aliasesDistribution.ViewerCertificate.AcmCertificateArn,
      /certificate\/a23103a6-8dfb-443e-bbcb-b3d924038fd5$/
    );
    assert.equal(
      Object.values(aliasesDesired.Resources).some((resource) =>
        resource.Type === "Custom::ZoolandingFrontendAliasRecords"
        && JSON.stringify(resource).includes("zooberiahsystems.com")
      ),
      false
    );

    const baseline = structuredClone(generatedDesired);
    for (const [logicalId] of api.zooberiahResourceEntries(baseline)) delete baseline.Resources[logicalId];
    delete baseline.Outputs.FrontendDistributionDomainNameZooberiahsystems;
    const [, sharedSsr] = Object.entries(baseline.Resources).find(([, resource]) =>
      resource.Type === "AWS::Lambda::Function"
      && resource.Properties?.FunctionName === "zoolandingpage-production-frontend-ssr"
    );
    sharedSsr.Properties.Environment.Variables.NG_ALLOWED_HOSTS =
      sharedSsr.Properties.Environment.Variables.NG_ALLOWED_HOSTS
        .split(",")
        .filter((host) => !["zooberiahsystems.com", "www.zooberiahsystems.com"].includes(host))
        .join(",");
    const generated = api.projectZooberiahFrontDoor(
      baseline,
      generatedDesired,
      "release-123",
      "deploy",
      "generated"
    );
    const aliases = api.projectZooberiahFrontDoor(
      generated,
      aliasesDesired,
      "release-123",
      "deploy",
      "aliases",
      generatedDesired
    );
    const changed = Object.entries(aliases.Resources)
      .filter(([logicalId, resource]) =>
        JSON.stringify(resource) !== JSON.stringify(generated.Resources[logicalId])
      )
      .map(([logicalId, resource]) => ({
        Type: "Resource",
        ResourceChange: {
          Action: "Modify",
          LogicalResourceId: logicalId,
          ResourceType: resource.Type,
          Replacement: "False",
          Scope: ["Properties"],
        },
      }));
    assert.equal(changed.length, 2);
    assert.equal(
      api.reviewZooberiahChanges(generated, aliases, {
        Status: "CREATE_COMPLETE",
        ExecutionStatus: "AVAILABLE",
        Changes: changed,
      }, "deploy", "aliases").length,
      2
    );

    const driftedGenerated = structuredClone(generated);
    const permissionId = api.zooberiahResourceEntries(driftedGenerated)
      .find(([, resource]) => resource.Type === "AWS::Lambda::Permission")[0];
    driftedGenerated.Resources[permissionId].Properties.Action = "lambda:InvokeFunction";
    assert.throws(
      () => api.projectZooberiahFrontDoor(
        driftedGenerated,
        aliasesDesired,
        "release-123",
        "deploy",
        "aliases",
        generatedDesired
      ),
      /zooberiah_frontdoor_projection_invalid/
    );

    const broadenedAliases = structuredClone(aliasesDesired);
    broadenedAliases.Resources.FrontendDistributionDomainParameterZooberiahsystems75FC7D03
      .Properties.Description = "unexpected alias-phase mutation";
    assert.throws(
      () => api.projectZooberiahFrontDoor(
        generated,
        broadenedAliases,
        "release-123",
        "deploy",
        "aliases",
        generatedDesired
      ),
      /zooberiah_frontdoor_projection_invalid/
    );
  } finally {
    fs.rmSync(generatedDirectory, { recursive: true, force: true });
    fs.rmSync(aliasesDirectory, { recursive: true, force: true });
  }
});

test("Zooberiah alias preflight requires issued ACM and preserves the HostGator CNAME shape", () => {
  assert.equal(typeof api.assertZooberiahAliasPreflight, "function");
  const records = [
    {
      Name: "zooberiahsystems.com.",
      Type: "A",
      TTL: 300,
      ResourceRecords: [{ Value: "162.241.62.201" }],
    },
    {
      Name: "www.zooberiahsystems.com.",
      Type: "CNAME",
      TTL: 300,
      ResourceRecords: [{ Value: "zooberiahsystems.com." }],
    },
  ];
  const call = (kind, service, operation) => {
    if (service === "acm" && operation === "describe-certificate") {
      return {
        Certificate: {
          DomainName: "zooberiahsystems.com",
          Status: "ISSUED",
          SubjectAlternativeNames: ["zooberiahsystems.com", "www.zooberiahsystems.com"],
          DomainValidationOptions: [
            { DomainName: "zooberiahsystems.com", ValidationStatus: "SUCCESS" },
            { DomainName: "www.zooberiahsystems.com", ValidationStatus: "SUCCESS" },
          ],
        },
      };
    }
    if (service === "route53" && operation === "list-resource-record-sets") {
      return { IsTruncated: false, ResourceRecordSets: records };
    }
    throw new Error(`unexpected_call:${service}:${operation}`);
  };
  assert.deepEqual(api.assertZooberiahAliasPreflight(call), { recordCount: 2 });
  assert.throws(
    () => api.assertZooberiahAliasPreflight((kind, service, operation) => {
      if (service === "acm" && operation === "describe-certificate") {
        return { Certificate: { DomainName: "zooberiahsystems.com", Status: "PENDING_VALIDATION" } };
      }
      return { IsTruncated: false, ResourceRecordSets: records };
    }),
    /zooberiah_alias_preflight_invalid/
  );
  assert.throws(
    () => api.assertZooberiahAliasPreflight((kind, service, operation) => {
      if (service === "acm") return call(kind, service, operation);
      return {
        IsTruncated: false,
        ResourceRecordSets: [
          ...records,
          { Name: "www.zooberiahsystems.com.", Type: "A", AliasTarget: { DNSName: "example.cloudfront.net." } },
        ],
      };
    }),
    /zooberiah_alias_preflight_invalid/
  );

  let rollbackAcmCalls = 0;
  assert.deepEqual(
    api.assertZooberiahAliasPreflight((kind, service, operation) => {
      if (service === "acm") {
        rollbackAcmCalls += 1;
        return { Certificate: { DomainName: "zooberiahsystems.com", Status: "REVOKED" } };
      }
      if (service === "route53" && operation === "list-resource-record-sets") {
        return { IsTruncated: false, ResourceRecordSets: records };
      }
      throw new Error(`unexpected_call:${service}:${operation}`);
    }, "rollback"),
    { recordCount: 2 }
  );
  assert.equal(rollbackAcmCalls, 0);
});

test("Zooberiah alias operation fails before a change set while ACM is pending", async () => {
  const generatedDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "zooberiah-live-generated-"));
  const aliasesDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "zooberiah-live-aliases-"));
  try {
    api.prepareZooberiahFrontDoor("release-123", generatedDirectory, "generated");
    api.prepareZooberiahFrontDoor("release-123", aliasesDirectory, "aliases");
    const generated = JSON.parse(
      fs.readFileSync(path.join(generatedDirectory, "desired-template.json"), "utf8")
    );
    const aliases = JSON.parse(
      fs.readFileSync(path.join(aliasesDirectory, "desired-template.json"), "utf8")
    );
    const initial = structuredClone(generated);
    for (const [logicalId] of api.zooberiahResourceEntries(initial)) delete initial.Resources[logicalId];
    delete initial.Outputs.FrontendDistributionDomainNameZooberiahsystems;
    const [, initialSsr] = Object.entries(initial.Resources).find(([, resource]) =>
      resource.Type === "AWS::Lambda::Function"
      && resource.Properties?.FunctionName === "zoolandingpage-production-frontend-ssr"
    );
    initialSsr.Properties.Environment.Variables.NG_ALLOWED_HOSTS =
      initialSsr.Properties.Environment.Variables.NG_ALLOWED_HOSTS
        .split(",")
        .filter((host) => !["zooberiahsystems.com", "www.zooberiahsystems.com"].includes(host))
        .join(",");
    const deployedGenerated = api.projectZooberiahFrontDoor(
      initial,
      generated,
      "release-123",
      "deploy",
      "generated"
    );
    const baseline = {
      stackId: "arn:aws:cloudformation:us-east-1:765932874577:stack/ZoolandingProduction-Zoolandingpage-production-Frontend/11111111-1111-1111-1111-111111111111",
      templates: { Original: deployedGenerated, Processed: deployedGenerated },
      parameters: [],
      resources: [],
      trust: { policy: "sealed" },
    };
    let changeSets = 0;
    await assert.rejects(
      () => api.runZooberiahOperation({
        action: "deploy",
        execution: "review",
        phase: "aliases",
        releaseId: "release-123",
        desired: aliases,
        generatedDesired: generated,
        call: (kind, service, operation) => {
          if (service === "acm" && operation === "describe-certificate") {
            return { Certificate: { DomainName: "zooberiahsystems.com", Status: "PENDING_VALIDATION" } };
          }
          if (service === "cloudformation" && operation === "create-change-set") changeSets += 1;
          throw new Error(`unexpected_call:${service}:${operation}`);
        },
        runId: "123-1",
        fingerprint: "c".repeat(64),
        sourceSha: "a".repeat(40),
        outputPath: path.join(aliasesDirectory, "review.json"),
        captureBaseline: () => structuredClone(baseline),
      }),
      /zooberiah_alias_preflight_invalid/
    );
    assert.equal(changeSets, 0);
  } finally {
    fs.rmSync(generatedDirectory, { recursive: true, force: true });
    fs.rmSync(aliasesDirectory, { recursive: true, force: true });
  }
});

test("Zooberiah postcheck parameter normalization ignores order but preserves values", () => {
  assert.equal(typeof api.normalizeParameters, "function");
  const baseline = [
    { ParameterKey: "Second", ParameterValue: "two", ResolvedValue: "resolved-two" },
    { ParameterKey: "First", ParameterValue: "one" },
  ];
  const reordered = [...baseline].reverse();
  assert.deepEqual(api.normalizeParameters(baseline), api.normalizeParameters(reordered));
  assert.notDeepEqual(
    api.normalizeParameters(baseline),
    api.normalizeParameters([
      { ParameterKey: "First", ParameterValue: "changed" },
      baseline[0],
    ])
  );
});
