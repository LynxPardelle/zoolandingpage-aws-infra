"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const certificate = require("./thn-production-certificate-release");
const retained = require("./thn-production-retained-review");
const { canonical, sha, ACCOUNT, REGION, STACK, ASSET_BUCKET, roles } = certificate;

const fail = (code) => { throw new Error(code); };
const same = (left, right) => canonical(left) === canonical(right);
const OUTPUT_ID = "FrontendDistributionDomainNameZooberiahsystems";
const ZOOBERIAH_HOSTS = ["zooberiahsystems.com", "www.zooberiahsystems.com"];
const FRONTEND_ARTIFACT_BUCKET = `zoolandingpage-production-frontend-artifacts-${ACCOUNT}`;
const ZOOBERIAH_CERTIFICATE_ARN =
  "arn:aws:acm:us-east-1:765932874577:certificate/a23103a6-8dfb-443e-bbcb-b3d924038fd5";
const ZOOBERIAH_ZONE_ID = "Z00733952JM7567FL6HXC";
const RESOURCE_TYPES = new Map([
  ["FrontendSsrFunctionAllowCloudFrontInvokeFunctionUrlZooberiahsystems4FF79D82", "AWS::Lambda::Permission"],
  ["FrontendSsrFunctionAllowCloudFrontInvokeFunctionZooberiahsystems8463B954", "AWS::Lambda::Permission"],
  ["FrontendViewerHostHeaderFunctionZooberiahsystems82D505B9", "AWS::CloudFront::Function"],
  ["FrontendDistributionZooberiahsystemsOrigin1InvokeFromApiForZoolandingProductionZoolandingpageproductionFrontendFrontendDistributionZooberiahsystemsOrigin1D87FECD6EC08873F", "AWS::Lambda::Permission"],
  ["FrontendDistributionZooberiahsystems75814218", "AWS::CloudFront::Distribution"],
  ["FrontendDistributionDomainParameterZooberiahsystems75FC7D03", "AWS::SSM::Parameter"],
]);
const ALIAS_MUTABLE_IDS = new Set([
  "FrontendViewerHostHeaderFunctionZooberiahsystems82D505B9",
  "FrontendDistributionZooberiahsystems75814218",
]);

function validReleaseId(value) {
  return typeof value === "string"
    && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)
    && !value.includes("..");
}

function zooberiahResourceEntries(template) {
  return Object.entries(template?.Resources || {}).filter(
    ([logicalId, resource]) => RESOURCE_TYPES.get(logicalId) === resource.Type
  );
}

function sharedSsrEntry(template) {
  const entries = Object.entries(template?.Resources || {}).filter(([, resource]) =>
    resource.Type === "AWS::Lambda::Function"
    && resource.Properties?.FunctionName === "zoolandingpage-production-frontend-ssr"
  );
  if (entries.length !== 1) fail("zooberiah_frontdoor_template_invalid");
  return entries[0];
}

function allowedHosts(resource) {
  const value = resource?.Properties?.Environment?.Variables?.NG_ALLOWED_HOSTS;
  if (typeof value !== "string" || !value) fail("zooberiah_frontdoor_template_invalid");
  return value.split(",").filter(Boolean);
}

function normalizeParameters(parameters) {
  if (
    !Array.isArray(parameters)
    || parameters.some((parameter) =>
      !parameter
      || typeof parameter !== "object"
      || typeof parameter.ParameterKey !== "string"
      || typeof parameter.ParameterValue !== "string"
    )
    || new Set(parameters.map(({ ParameterKey }) => ParameterKey)).size !== parameters.length
  ) fail("zooberiah_frontdoor_parameters_invalid");
  return parameters
    .map(({ ParameterKey, ParameterValue, ResolvedValue }) => ({
      ParameterKey,
      ParameterValue,
      ...(ResolvedValue === undefined ? {} : { ResolvedValue }),
    }))
    .sort((left, right) => left.ParameterKey.localeCompare(right.ParameterKey));
}

function assertReleaseBinding(template, releaseId) {
  const [, sharedSsr] = sharedSsrEntry(template);
  const code = sharedSsr.Properties?.Code;
  const bucket = code?.S3Bucket;
  const bucketMatches = bucket === FRONTEND_ARTIFACT_BUCKET
    || (
      bucket
      && typeof bucket === "object"
      && typeof bucket.Ref === "string"
      && template.Resources?.[bucket.Ref]?.Type === "AWS::S3::Bucket"
      && template.Resources[bucket.Ref].Properties?.BucketName === FRONTEND_ARTIFACT_BUCKET
    );
  if (
    sharedSsr.Properties?.Environment?.Variables?.ZLP_RELEASE_ID !== releaseId
    || code?.S3Key !== `frontend/angular-ssr/production/releases/${releaseId}/server/ssr-handler.zip`
    || !bucketMatches
  ) fail("zooberiah_frontdoor_release_binding_invalid");
  return sharedSsr;
}

function assertZooberiahAliasPreflight(call, action = "deploy") {
  if (!["deploy", "rollback"].includes(action)) fail("zooberiah_alias_preflight_invalid");
  if (action === "deploy") {
    const certificateDetails = call("lookup", "acm", "describe-certificate", {
      CertificateArn: ZOOBERIAH_CERTIFICATE_ARN,
    }).Certificate;
    if (
      certificateDetails?.DomainName !== ZOOBERIAH_HOSTS[0]
      || certificateDetails.Status !== "ISSUED"
      || !same([...(certificateDetails.SubjectAlternativeNames || [])].sort(), [...ZOOBERIAH_HOSTS].sort())
      || !same(
        (certificateDetails.DomainValidationOptions || [])
          .map(({ DomainName, ValidationStatus }) => ({ DomainName, ValidationStatus }))
          .sort((left, right) => left.DomainName.localeCompare(right.DomainName)),
        ZOOBERIAH_HOSTS
          .map((DomainName) => ({ DomainName, ValidationStatus: "SUCCESS" }))
          .sort((left, right) => left.DomainName.localeCompare(right.DomainName))
      )
    ) fail("zooberiah_alias_preflight_invalid");
  }
  const response = call("lookup", "route53", "list-resource-record-sets", {
    HostedZoneId: ZOOBERIAH_ZONE_ID,
    MaxItems: "100",
  });
  if (response.IsTruncated || !Array.isArray(response.ResourceRecordSets)) {
    fail("zooberiah_alias_preflight_invalid");
  }
  const records = response.ResourceRecordSets.filter(({ Name }) =>
    ["zooberiahsystems.com.", "www.zooberiahsystems.com."].includes(Name)
  );
  const apexA = records.filter(({ Name, Type }) => Name === "zooberiahsystems.com." && Type === "A");
  const wwwCname = records.filter(({ Name, Type }) => Name === "www.zooberiahsystems.com." && Type === "CNAME");
  if (
    apexA.length !== 1
    || apexA[0].AliasTarget
    || !same(apexA[0].ResourceRecords, [{ Value: "162.241.62.201" }])
    || wwwCname.length !== 1
    || wwwCname[0].AliasTarget
    || !same(wwwCname[0].ResourceRecords, [{ Value: "zooberiahsystems.com." }])
    || records.some(({ Name, Type }) =>
      (Name === "zooberiahsystems.com." && Type === "AAAA")
      || (Name === "www.zooberiahsystems.com." && ["A", "AAAA"].includes(Type))
    )
  ) fail("zooberiah_alias_preflight_invalid");
  return { recordCount: records.length };
}

function validateDesiredTemplate(template, releaseId, phase = "generated") {
  if (
    !validReleaseId(releaseId)
    || !["generated", "aliases"].includes(phase)
    || zooberiahResourceEntries(template).length !== RESOURCE_TYPES.size
  ) {
    fail("zooberiah_frontdoor_template_invalid");
  }
  for (const [logicalId, type] of RESOURCE_TYPES) {
    if (template.Resources[logicalId]?.Type !== type) fail("zooberiah_frontdoor_template_invalid");
  }
  const distribution = template.Resources.FrontendDistributionZooberiahsystems75814218
    ?.Properties?.DistributionConfig;
  if (
    distribution?.Comment !== "Zoolandingpage Angular SSR frontend (production/zooberiahsystems)"
    || !distribution.Origins?.some(
      (origin) => origin.DomainName === "assets.zoolandingpage.com.mx"
        && origin.OriginPath === `/frontend/angular-ssr/production/releases/${releaseId}/browser`
    )
  ) fail("zooberiah_frontdoor_template_invalid");
  if (phase === "generated" && (distribution.Aliases !== undefined || distribution.ViewerCertificate !== undefined)) {
    fail("zooberiah_frontdoor_template_invalid");
  }
  if (
    phase === "aliases"
    && (
      !same(distribution.Aliases, ZOOBERIAH_HOSTS)
      || !/certificate\/a23103a6-8dfb-443e-bbcb-b3d924038fd5$/.test(
        distribution.ViewerCertificate?.AcmCertificateArn || ""
      )
    )
  ) fail("zooberiah_frontdoor_template_invalid");
  if (Object.values(template.Resources).some((resource) =>
    ["Custom::ZoolandingFrontendAliasRecords", "AWS::Route53::RecordSet"].includes(resource.Type)
    && JSON.stringify(resource).includes("zooberiahsystems.com")
  )) fail("zooberiah_frontdoor_template_invalid");
  const viewer = template.Resources.FrontendViewerHostHeaderFunctionZooberiahsystems82D505B9
    ?.Properties?.FunctionCode;
  if (typeof viewer !== "string" || !viewer.includes("zooberiahsystems.com")) {
    fail("zooberiah_frontdoor_template_invalid");
  }
  const parameter = template.Resources.FrontendDistributionDomainParameterZooberiahsystems75FC7D03;
  if (parameter?.Properties?.Name !== "/zoolandingpage/production/frontend/distributions/zooberiahsystems/domain-name") {
    fail("zooberiah_frontdoor_template_invalid");
  }
  if (!template.Outputs?.[OUTPUT_ID]) fail("zooberiah_frontdoor_template_invalid");
  const desiredHosts = allowedHosts(sharedSsrEntry(template)[1]);
  if (ZOOBERIAH_HOSTS.some((host) => !desiredHosts.includes(host))) {
    fail("zooberiah_frontdoor_template_invalid");
  }
  assertReleaseBinding(template, releaseId);
  return template;
}

function assertAliasTemplateDelta(generated, aliases, releaseId) {
  validateDesiredTemplate(generated, releaseId, "generated");
  validateDesiredTemplate(aliases, releaseId, "aliases");
  const changed = [...RESOURCE_TYPES.keys()].filter((logicalId) =>
    !same(generated.Resources[logicalId], aliases.Resources[logicalId])
  );
  if (
    changed.length !== ALIAS_MUTABLE_IDS.size
    || changed.some((logicalId) => !ALIAS_MUTABLE_IDS.has(logicalId))
    || !same(generated.Outputs?.[OUTPUT_ID], aliases.Outputs?.[OUTPUT_ID])
  ) fail("zooberiah_frontdoor_projection_invalid");
}

function assertReferencesExist(before, desired) {
  const available = new Set([...Object.keys(before.Resources || {}), ...RESOURCE_TYPES.keys()]);
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    if (typeof value.Ref === "string" && !value.Ref.startsWith("AWS::") && !available.has(value.Ref)) {
      fail("zooberiah_frontdoor_reference_invalid");
    }
    const getAtt = value["Fn::GetAtt"];
    if (Array.isArray(getAtt) && typeof getAtt[0] === "string" && !available.has(getAtt[0])) {
      fail("zooberiah_frontdoor_reference_invalid");
    }
    for (const child of Object.values(value)) visit(child);
  };
  for (const [, resource] of zooberiahResourceEntries(desired)) visit(resource);
  visit(desired.Outputs[OUTPUT_ID]);
}

function projectZooberiahFrontDoor(
  before,
  desired,
  releaseId,
  action,
  phase = "generated",
  generatedDesired = phase === "generated" ? desired : undefined
) {
  if (!["deploy", "rollback"].includes(action) || !before?.Resources) {
    fail("zooberiah_frontdoor_projection_invalid");
  }
  validateDesiredTemplate(desired, releaseId, phase);
  assertReleaseBinding(before, releaseId);
  if (phase === "aliases") {
    if (!generatedDesired) fail("zooberiah_frontdoor_projection_invalid");
    assertAliasTemplateDelta(generatedDesired, desired, releaseId);
  } else if (!same(generatedDesired, desired)) {
    fail("zooberiah_frontdoor_projection_invalid");
  }
  const candidate = structuredClone(before);
  candidate.Outputs = { ...(candidate.Outputs || {}) };
  if (action === "deploy") {
    const existingEntries = zooberiahResourceEntries(before);
    if (existingEntries.length === RESOURCE_TYPES.size) {
      if (phase !== "aliases" || !before.Outputs?.[OUTPUT_ID]) {
        fail("zooberiah_frontdoor_projection_invalid");
      }
      const currentDistribution = before.Resources.FrontendDistributionZooberiahsystems75814218
        ?.Properties?.DistributionConfig;
      if (currentDistribution?.Aliases !== undefined || currentDistribution?.ViewerCertificate !== undefined) {
        fail("zooberiah_frontdoor_projection_invalid");
      }
      if (
        [...RESOURCE_TYPES.keys()].some((logicalId) =>
          !same(before.Resources[logicalId], generatedDesired.Resources[logicalId])
        )
        || !same(before.Outputs[OUTPUT_ID], generatedDesired.Outputs[OUTPUT_ID])
      ) fail("zooberiah_frontdoor_projection_invalid");
      const [, sharedResource] = sharedSsrEntry(candidate);
      const currentHosts = allowedHosts(sharedResource);
      if (ZOOBERIAH_HOSTS.some((host) => currentHosts.filter((value) => value === host).length !== 1)) {
        fail("zooberiah_frontdoor_projection_invalid");
      }
      for (const [logicalId] of RESOURCE_TYPES) {
        candidate.Resources[logicalId] = structuredClone(desired.Resources[logicalId]);
      }
      candidate.Outputs[OUTPUT_ID] = structuredClone(desired.Outputs[OUTPUT_ID]);
      return candidate;
    }
    if (phase !== "generated" || existingEntries.length !== 0 || before.Outputs?.[OUTPUT_ID]) {
      fail("zooberiah_frontdoor_projection_invalid");
    }
    assertReferencesExist(before, desired);
    for (const [logicalId] of RESOURCE_TYPES) {
      candidate.Resources[logicalId] = structuredClone(desired.Resources[logicalId]);
    }
    const [sharedId, sharedResource] = sharedSsrEntry(candidate);
    const currentHosts = allowedHosts(sharedResource);
    if (ZOOBERIAH_HOSTS.some((host) => currentHosts.includes(host))) {
      fail("zooberiah_frontdoor_projection_invalid");
    }
    sharedResource.Properties.Environment.Variables.NG_ALLOWED_HOSTS = [
      ...currentHosts,
      ...ZOOBERIAH_HOSTS,
    ].join(",");
    candidate.Outputs[OUTPUT_ID] = structuredClone(desired.Outputs[OUTPUT_ID]);
    return candidate;
  }
  if (
    zooberiahResourceEntries(before).length !== RESOURCE_TYPES.size
    || !before.Outputs?.[OUTPUT_ID]
    || [...RESOURCE_TYPES.keys()].some((logicalId) => !same(before.Resources[logicalId], desired.Resources[logicalId]))
  ) fail("zooberiah_frontdoor_projection_invalid");
  for (const [logicalId] of RESOURCE_TYPES) delete candidate.Resources[logicalId];
  const [, sharedResource] = sharedSsrEntry(candidate);
  const currentHosts = allowedHosts(sharedResource);
  if (ZOOBERIAH_HOSTS.some((host) => currentHosts.filter((value) => value === host).length !== 1)) {
    fail("zooberiah_frontdoor_projection_invalid");
  }
  sharedResource.Properties.Environment.Variables.NG_ALLOWED_HOSTS = currentHosts
    .filter((host) => !ZOOBERIAH_HOSTS.includes(host))
    .join(",");
  delete candidate.Outputs[OUTPUT_ID];
  return candidate;
}

function reviewZooberiahChanges(before, candidate, description, action, phase = "generated") {
  if (
    !["deploy", "rollback"].includes(action)
    || !["generated", "aliases"].includes(phase)
    || description?.Status !== "CREATE_COMPLETE"
    || description.ExecutionStatus !== "AVAILABLE"
    || description.NextToken
    || description.IncludeNestedStacks
    || !Array.isArray(description.Changes)
  ) fail("zooberiah_frontdoor_inventory_invalid");
  const expected = new Map();
  for (const [logicalId, type] of RESOURCE_TYPES) {
    const oldResource = before.Resources?.[logicalId];
    const newResource = candidate.Resources?.[logicalId];
    if (!same(oldResource, newResource)) {
      const expectedAction = !oldResource ? "Add" : !newResource ? "Remove" : "Modify";
      if (
        action === "deploy" && !["Add", "Modify"].includes(expectedAction)
        || action === "rollback" && expectedAction !== "Remove"
        || (oldResource && oldResource.Type !== type)
        || (newResource && newResource.Type !== type)
      ) fail("zooberiah_frontdoor_inventory_invalid");
      expected.set(logicalId, { action: expectedAction, type });
    }
  }
  const [beforeSsrId, beforeSsr] = sharedSsrEntry(before);
  const [candidateSsrId, candidateSsr] = sharedSsrEntry(candidate);
  if (beforeSsrId !== candidateSsrId) fail("zooberiah_frontdoor_inventory_invalid");
  if (!same(beforeSsr, candidateSsr)) {
    if (!same(
      { ...beforeSsr, Properties: { ...beforeSsr.Properties, Environment: candidateSsr.Properties.Environment } },
      candidateSsr
    )) fail("zooberiah_frontdoor_inventory_invalid");
    expected.set(beforeSsrId, { action: "Modify", type: "AWS::Lambda::Function" });
  }
  if (
    action === "deploy"
    && phase === "aliases"
    && (
      expected.size !== ALIAS_MUTABLE_IDS.size
      || [...expected].some(([logicalId, change]) =>
        !ALIAS_MUTABLE_IDS.has(logicalId) || change.action !== "Modify"
      )
    )
  ) fail("zooberiah_frontdoor_inventory_invalid");
  if (expected.size === 0 || description.Changes.length !== expected.size) {
    fail("zooberiah_frontdoor_inventory_invalid");
  }
  const seen = new Set();
  for (const change of description.Changes) {
    const resource = change?.ResourceChange;
    const wanted = expected.get(resource?.LogicalResourceId);
    if (
      change?.Type !== "Resource"
      || !wanted
      || seen.has(resource.LogicalResourceId)
      || resource.Action !== wanted.action
      || resource.ResourceType !== wanted.type
      || ![undefined, "False"].includes(resource.Replacement)
      || resource.Scope?.some((scope) => scope !== "Properties")
      || resource.Details?.some(
        (detail) => detail.Target?.Attribute !== undefined && detail.Target.Attribute !== "Properties"
      )
    ) fail("zooberiah_frontdoor_inventory_invalid");
    seen.add(resource.LogicalResourceId);
  }
  return description.Changes;
}

function prepareZooberiahFrontDoor(releaseId, destination, phase = "generated") {
  if (!validReleaseId(releaseId) || !["generated", "aliases"].includes(phase)) {
    fail("zooberiah_frontdoor_release_invalid");
  }
  const previous = {
    releaseId: process.env.FRONTEND_PRODUCTION_RELEASE_ID,
    customDomains: process.env.FRONTEND_PRODUCTION_CUSTOM_DOMAIN_NAMES_ENABLED,
    zooberiahPhase: process.env.FRONTEND_PRODUCTION_ZOOBERIAH_PHASE,
  };
  process.env.FRONTEND_PRODUCTION_RELEASE_ID = releaseId;
  process.env.FRONTEND_PRODUCTION_CUSTOM_DOMAIN_NAMES_ENABLED = "true";
  try {
    const configPath = require.resolve("../config/environments");
    const cdk = require("aws-cdk-lib");
    const { FrontendStack } = require("../lib/stacks/frontend-stack");
    const synthesize = (selectedPhase) => {
      process.env.FRONTEND_PRODUCTION_ZOOBERIAH_PHASE = selectedPhase;
      delete require.cache[configPath];
      const { environments } = require(configPath);
      const environment = environments.find(({ name }) => name === "production");
      const app = new cdk.App({ outdir: path.join(destination, `assembly-${selectedPhase}`) });
      const stage = new cdk.Stage(app, "ZoolandingProduction", {
        env: { account: ACCOUNT, region: REGION },
      });
      const stack = new FrontendStack(stage, "Zoolandingpage-production-Frontend", {
        env: { account: ACCOUNT, region: REGION },
        environment,
        stackName: STACK,
      });
      const template = stage.synth().getStackArtifact(stack.artifactId).template;
      validateDesiredTemplate(template, releaseId, selectedPhase);
      return template;
    };
    const generated = synthesize("generated");
    const desired = phase === "generated" ? generated : synthesize("aliases");
    validateDesiredTemplate(desired, releaseId, phase);
    if (phase === "aliases") assertAliasTemplateDelta(generated, desired, releaseId);
    fs.mkdirSync(destination, { recursive: true });
    fs.writeFileSync(path.join(destination, "desired-template.json"), `${JSON.stringify(desired, null, 2)}\n`);
    fs.writeFileSync(
      path.join(destination, "generated-template.json"),
      `${JSON.stringify(generated, null, 2)}\n`
    );
    return {
      desiredTemplateSha256: sha(canonical(desired)),
      generatedTemplateSha256: sha(canonical(generated)),
    };
  } finally {
    if (previous.releaseId === undefined) delete process.env.FRONTEND_PRODUCTION_RELEASE_ID;
    else process.env.FRONTEND_PRODUCTION_RELEASE_ID = previous.releaseId;
    if (previous.customDomains === undefined) delete process.env.FRONTEND_PRODUCTION_CUSTOM_DOMAIN_NAMES_ENABLED;
    else process.env.FRONTEND_PRODUCTION_CUSTOM_DOMAIN_NAMES_ENABLED = previous.customDomains;
    if (previous.zooberiahPhase === undefined) delete process.env.FRONTEND_PRODUCTION_ZOOBERIAH_PHASE;
    else process.env.FRONTEND_PRODUCTION_ZOOBERIAH_PHASE = previous.zooberiahPhase;
    delete require.cache[require.resolve("../config/environments")];
  }
}

function purposeForAction(action) {
  if (action === "deploy") return "zooberiah-frontdoor";
  if (action === "rollback") return "zooberiah-frontdoor-rollback";
  fail("zooberiah_frontdoor_operation_invalid");
}

function templateBody(value) {
  return typeof value === "string" ? JSON.parse(value) : value;
}

function verifyVersionedTemplate(call, coordinate, bytes, directory) {
  if (
    coordinate?.bucket !== ASSET_BUCKET
    || !/^thn-production\/zooberiah-frontdoor(?:-rollback)?\/[a-f0-9]{64}\.json$/.test(coordinate.key || "")
    || coordinate.sha256 !== sha(bytes)
    || typeof coordinate.versionId !== "string"
    || coordinate.versionId === "null"
  ) fail("zooberiah_frontdoor_asset_invalid");
  const output = path.join(directory, `readback-${coordinate.sha256}.json`);
  const response = call("file-publishing", "s3api", "get-object", {
    Bucket: coordinate.bucket,
    Key: coordinate.key,
    VersionId: coordinate.versionId,
    ExpectedBucketOwner: ACCOUNT,
  }, output);
  if (response.VersionId !== coordinate.versionId || !fs.readFileSync(output).equals(bytes)) {
    fail("zooberiah_frontdoor_asset_invalid");
  }
  return coordinate;
}

function writeVersionedTemplate(call, bytes, purpose, directory) {
  const key = `thn-production/${purpose}/${sha(bytes)}.json`;
  const file = path.join(directory, "candidate.json");
  fs.writeFileSync(file, bytes, { mode: 0o600, flag: "wx" });
  const listed = call("file-publishing", "s3api", "list-objects-v2", {
    Bucket: ASSET_BUCKET,
    Prefix: key,
    MaxKeys: 2,
    ExpectedBucketOwner: ACCOUNT,
  });
  if (listed.IsTruncated || !Array.isArray(listed.Contents || [])) fail("zooberiah_frontdoor_asset_invalid");
  const found = (listed.Contents || []).filter((object) => object.Key === key);
  if (found.length > 1) fail("zooberiah_frontdoor_asset_invalid");
  const result = found.length
    ? call("file-publishing", "s3api", "head-object", {
      Bucket: ASSET_BUCKET,
      Key: key,
      ExpectedBucketOwner: ACCOUNT,
    })
    : call("file-publishing", "s3api", "put-object", {
      Bucket: ASSET_BUCKET,
      Key: key,
      ExpectedBucketOwner: ACCOUNT,
      Body: file,
      IfNoneMatch: "*",
      ContentType: "application/json",
      ServerSideEncryption: "aws:kms",
    });
  return verifyVersionedTemplate(
    call,
    { bucket: ASSET_BUCKET, key, versionId: result.VersionId, sha256: sha(bytes) },
    bytes,
    directory
  );
}

function freshReviewFields(
  call,
  baseline,
  candidate,
  description,
  coordinate,
  action,
  phase,
  sourceSha,
  fingerprint
) {
  const native = {};
  for (const stage of ["Original", "Processed"]) {
    native[stage] = templateBody(call("deploy", "cloudformation", "get-template", {
      StackName: baseline.stackId,
      ChangeSetName: description.ChangeSetId,
      TemplateStage: stage,
    }).TemplateBody);
  }
  if (!same(native.Original, candidate)) fail("zooberiah_frontdoor_native_template_invalid");
  reviewZooberiahChanges(baseline.templates.Original, candidate, description, action, phase);
  return {
    sourceSha,
    sourcePackageSha256: fingerprint,
    baselineSha256: certificate.baselineDigest(baseline),
    identitySha256: sha(canonical(baseline.resources)),
    permissionSha256: sha(canonical(baseline.trust)),
    originalTemplateSha256: sha(canonical(native.Original)),
    processedTemplateSha256: sha(canonical(native.Processed)),
    parametersSha256: sha(canonical(baseline.parameters)),
    nativeInventorySha256: retained.hash(description.Changes),
    packageManifest: [coordinate],
    changes: retained.inventorySummary(description.Changes),
  };
}

async function waitForStack(call, stackId, pause) {
  for (let attempt = 0; attempt < 360; attempt += 1) {
    const stack = call("deploy", "cloudformation", "describe-stacks", { StackName: stackId }).Stacks?.[0];
    if (stack?.StackStatus === "UPDATE_COMPLETE") return stack;
    if (!["UPDATE_IN_PROGRESS", "UPDATE_COMPLETE_CLEANUP_IN_PROGRESS"].includes(stack?.StackStatus)) {
      fail("zooberiah_frontdoor_execution_failed");
    }
    await pause(5000);
  }
  fail("zooberiah_frontdoor_execution_timeout");
}

async function runZooberiahOperation(options) {
  const {
    action,
    execution,
    releaseId,
    desired,
    generatedDesired,
    call,
    runId,
    fingerprint,
    outputPath,
  } = options;
  const phase = options.phase || "generated";
  if (
    !["deploy", "rollback"].includes(action)
    || !["review", "execute", "cleanup"].includes(execution)
    || !["generated", "aliases"].includes(phase)
    || !validReleaseId(releaseId)
    || !/^\d+-\d+$/.test(runId || "")
    || !/^[a-f0-9]{64}$/.test(fingerprint || "")
    || !/^[a-f0-9]{40}$/.test(options.sourceSha || "")
    || typeof call !== "function"
  ) fail("zooberiah_frontdoor_operation_invalid");
  const purpose = purposeForAction(action);
  if (execution === "cleanup") {
    const record = retained.validateReview(options.record);
    if (record.purpose !== purpose || record.digest !== options.approvedDigest) {
      fail("zooberiah_frontdoor_review_invalid");
    }
    const stack = call("deploy", "cloudformation", "describe-stacks", { StackName: record.stackId }).Stacks?.[0];
    const changeSet = call("deploy", "cloudformation", "describe-change-set", {
      StackName: record.stackId,
      ChangeSetName: record.changeSetArn,
      IncludePropertyValues: true,
    });
    if (
      stack?.StackId !== record.stackId
      || changeSet.StackId !== record.stackId
      || changeSet.ChangeSetId !== record.changeSetArn
      || changeSet.Status !== "CREATE_COMPLETE"
      || changeSet.ExecutionStatus !== "AVAILABLE"
      || retained.hash(changeSet.Changes) !== record.nativeInventorySha256
    ) fail("zooberiah_frontdoor_review_invalid");
    call("deploy", "cloudformation", "delete-change-set", {
      StackName: record.stackId,
      ChangeSetName: record.changeSetArn,
    });
    return { cleanup: true, changeSetArn: record.changeSetArn };
  }

  validateDesiredTemplate(desired, releaseId, phase);
  const captureBaseline = options.captureBaseline || certificate.readProductionBaseline;
  const pause = options.pause || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const baseline = captureBaseline(call);
  const candidate = projectZooberiahFrontDoor(
    baseline.templates.Original,
    desired,
    releaseId,
    action,
    phase,
    generatedDesired
  );
  if (phase === "aliases") assertZooberiahAliasPreflight(call, action);
  const bytes = Buffer.from(`${canonical(candidate)}\n`);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "zooberiah-production-frontdoor-"));
  try {
    if (execution === "review") {
      const coordinate = writeVersionedTemplate(call, bytes, purpose, directory);
      const freshBaseline = captureBaseline(call);
      if (certificate.baselineDigest(freshBaseline) !== certificate.baselineDigest(baseline)) {
        fail("zooberiah_frontdoor_baseline_changed");
      }
      options.verifySource?.();
      const created = call("deploy", "cloudformation", "create-change-set", {
        StackName: baseline.stackId,
        ChangeSetName: `thn-production-${purpose}-${runId}`,
        ChangeSetType: "UPDATE",
        Description: `Zooberiah ${action} source ${options.sourceSha}; expires after 24 hours; execute exact ARN only`,
        TemplateURL: `https://${ASSET_BUCKET}.s3.${REGION}.amazonaws.com/${coordinate.key}?versionId=${encodeURIComponent(coordinate.versionId)}`,
        Parameters: baseline.parameters.map((parameter) => ({
          ParameterKey: parameter.ParameterKey,
          UsePreviousValue: true,
        })),
        Capabilities: ["CAPABILITY_NAMED_IAM"],
        RoleARN: roles["cfn-exec"],
      });
      const description = await certificate.waitPreview(call, baseline.stackId, created.Id, pause);
      const fields = freshReviewFields(
        call, baseline, candidate, description, coordinate, action, phase, options.sourceSha, fingerprint
      );
      const createdAt = new Date(description.CreationTime).toISOString();
      const record = retained.sealReview({
        schemaVersion: 1,
        contract: "thn-production-retained-review/v1",
        environment: "production",
        service: "infra",
        purpose,
        stackId: baseline.stackId,
        changeSetArn: description.ChangeSetId,
        createdAt,
        expiresAt: new Date(Date.parse(createdAt) + 86_400_000).toISOString(),
        ...fields,
        recoveryCoordinates: [],
      });
      fs.writeFileSync(outputPath, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600, flag: "wx" });
      return record;
    }

    const record = retained.validateReview(options.record);
    if (
      record.purpose !== purpose
      || record.stackId !== baseline.stackId
      || record.sourceSha !== options.sourceSha
      || record.sourcePackageSha256 !== fingerprint
      || record.digest !== options.approvedDigest
      || record.packageManifest.length !== 1
    ) fail("zooberiah_frontdoor_review_invalid");
    const coordinate = record.packageManifest[0];
    verifyVersionedTemplate(call, coordinate, bytes, directory);
    const description = call("deploy", "cloudformation", "describe-change-set", {
      StackName: baseline.stackId,
      ChangeSetName: record.changeSetArn,
      IncludePropertyValues: true,
    });
    const fields = freshReviewFields(
      call, baseline, candidate, description, coordinate, action, phase, options.sourceSha, fingerprint
    );
    retained.verifyRetainedExecution(record, options.approvedDigest, fields, description);
    const immediate = captureBaseline(call);
    if (certificate.baselineDigest(immediate) !== certificate.baselineDigest(baseline)) {
      fail("retained_review_stale");
    }
    const last = call("deploy", "cloudformation", "describe-change-set", {
      StackName: baseline.stackId,
      ChangeSetName: record.changeSetArn,
      IncludePropertyValues: true,
    });
    retained.verifyRetainedExecution(record, options.approvedDigest, fields, last);
    if (phase === "aliases") assertZooberiahAliasPreflight(call, action);
    options.verifySource?.();
    call("deploy", "cloudformation", "execute-change-set", {
      StackName: baseline.stackId,
      ChangeSetName: record.changeSetArn,
      ClientRequestToken: `zooberiah-${action}-${record.digest}`,
    });
    const stack = await waitForStack(call, baseline.stackId, pause);
    const actual = templateBody(call("lookup", "cloudformation", "get-template", {
      StackName: baseline.stackId,
      TemplateStage: "Original",
    }).TemplateBody);
    if (
      !same(actual, candidate)
      || !same(normalizeParameters(stack.Parameters || []), normalizeParameters(baseline.parameters))
    ) {
      fail("zooberiah_frontdoor_postcheck_failed");
    }
    const resources = call("lookup", "cloudformation", "list-stack-resources", { StackName: baseline.stackId });
    if (resources.NextToken) fail("zooberiah_frontdoor_postcheck_failed");
    const present = new Set(resources.StackResourceSummaries.map(({ LogicalResourceId }) => LogicalResourceId));
    if ([...RESOURCE_TYPES.keys()].some((logicalId) => present.has(logicalId) !== (action === "deploy"))) {
      fail("zooberiah_frontdoor_postcheck_failed");
    }
    return { complete: true, action, digest: record.digest };
  } finally {
    if (path.dirname(directory) !== os.tmpdir()) fail("zooberiah_frontdoor_cleanup_invalid");
    fs.rmSync(directory, { recursive: true });
  }
}

function sourcePackageHash(root = path.resolve(__dirname, "..")) {
  const files = [
    "tools/zooberiah-production-frontdoor.js",
    "tools/thn-production-certificate-release.js",
    "tools/thn-production-retained-review.js",
    "config/environments.js",
    "lib/stacks/frontend-stack.js",
    "lib/project-helpers.js",
    ".github/workflows/zooberiah-production-frontdoor.yml",
    "package.json",
    "package-lock.json",
  ];
  return sha(canonical(Object.fromEntries(
    files.map((file) => [file, sha(fs.readFileSync(path.join(root, file)))])
  )));
}

module.exports = {
  OUTPUT_ID,
  RESOURCE_TYPES,
  assertZooberiahAliasPreflight,
  normalizeParameters,
  prepareZooberiahFrontDoor,
  projectZooberiahFrontDoor,
  reviewZooberiahChanges,
  runZooberiahOperation,
  sourcePackageHash,
  validateDesiredTemplate,
  zooberiahResourceEntries,
};

if (require.main === module) {
  (async () => {
    const [mode, releaseId, phase, target, generatedTarget] = process.argv.slice(2);
    if (mode === "prepare") {
      console.log(JSON.stringify(prepareZooberiahFrontDoor(releaseId, path.resolve(target), phase)));
      return;
    }
    if (mode !== "operate") fail("zooberiah_frontdoor_cli_invalid");
    if (!generatedTarget) fail("zooberiah_frontdoor_cli_invalid");
    const env = process.env;
    if (
      env.GITHUB_REPOSITORY !== "LynxPardelle/zoolandingpage-aws-infra"
      || env.GITHUB_REF !== "refs/heads/main"
      || env.GITHUB_EVENT_NAME !== "workflow_dispatch"
      || env.GITHUB_SHA !== env.EXPECTED_SOURCE_SHA
      || !/^[a-f0-9]{40}$/.test(env.EXPECTED_SOURCE_SHA || "")
      || !/^\d+$/.test(env.GITHUB_RUN_ID || "")
      || !/^\d+$/.test(env.GITHUB_RUN_ATTEMPT || "")
    ) fail("zooberiah_frontdoor_source_authority_invalid");
    const fingerprint = sourcePackageHash();
    if (fingerprint !== env.EXPECTED_SOURCE_PACKAGE_SHA256) {
      fail("zooberiah_frontdoor_source_package_changed");
    }
    const desired = JSON.parse(fs.readFileSync(path.resolve(target), "utf8"));
    const generatedDesired = JSON.parse(fs.readFileSync(path.resolve(generatedTarget), "utf8"));
    const record = env.EXECUTION === "review"
      ? undefined
      : JSON.parse(fs.readFileSync(path.resolve(env.REVIEW_FILE), "utf8"));
    const result = await runZooberiahOperation({
      action: env.ACTION,
      execution: env.EXECUTION,
      phase,
      releaseId,
      desired,
      generatedDesired,
      call: certificate.productionClients(env, `${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`),
      runId: `${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`,
      fingerprint,
      sourceSha: env.EXPECTED_SOURCE_SHA,
      approvedDigest: env.EXPECTED_REVIEW_DIGEST,
      record,
      outputPath: path.resolve(env.REVIEW_OUTPUT_FILE || "zooberiah-review.json"),
      verifySource: () => certificate.assertCurrentProductionSource(env.EXPECTED_SOURCE_SHA, env),
    });
    console.log(JSON.stringify(result));
  })().catch((error) => {
    console.error(JSON.stringify({
      error: /^[a-z0-9_]+$/.test(error.message)
        ? error.message
        : "zooberiah_frontdoor_operation_failed",
    }));
    process.exitCode = 1;
  });
}
