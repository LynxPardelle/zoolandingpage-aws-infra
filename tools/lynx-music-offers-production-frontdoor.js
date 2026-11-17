"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const certificate = require("./thn-production-certificate-release");
const retained = require("./thn-production-retained-review");
const { assertReleaseBinding, runLynxMusicOffersOperation } = require("./zooberiah-production-frontdoor");
const { certificateArnPattern, distributionId, viewerId, hosts, matchingStaticOrigin, outputId, tlsDomain } = require("./lynx-music-offers-contract");
const { ACCOUNT, REGION, STACK, canonical, sha } = certificate;

const same = (left, right) => canonical(left) === canonical(right);
const fail = (reason) => { throw new Error(`lynx_music_offers_${reason}`); };
const parameterId = "FrontendDistributionDomainParameterLynxMusicOffers2CA8054A";
const permissions = new Map([
  ["FrontendSsrFunctionAllowCloudFrontInvokeFunctionUrlLynxMusicOffersFF2A2C5B", "lambda:InvokeFunctionUrl"],
  ["FrontendSsrFunctionAllowCloudFrontInvokeFunctionLynxMusicOffers6775D630", "lambda:InvokeFunction"],
  ["FrontendDistributionLynxMusicOffersOrigin1InvokeFromApiForZoolandingProductionZoolandingpageproductionFrontendFrontendDistributionLynxMusicOffersOrigin179C825D970247E3F", "lambda:InvokeFunctionUrl"],
]);
const resourceTypes = new Map([
  [distributionId, "AWS::CloudFront::Distribution"],
  [viewerId, "AWS::CloudFront::Function"],
  [parameterId, "AWS::SSM::Parameter"],
  ...[...permissions.keys()].map((id) => [id, "AWS::Lambda::Permission"]),
]);
const aliasIds = [distributionId, viewerId];
const transportCertificate = `arn:aws:acm:${REGION}:${ACCOUNT}:certificate/00000000-0000-4000-8000-000000000000`;

function purpose(action, phase) {
  if (!["deploy", "rollback"].includes(action) || !["generated", "aliases"].includes(phase)) fail("invalid_operation");
  return `lynx-music-offers-frontdoor-${phase}${action === "rollback" ? "-rollback" : ""}`;
}

function validateTemplate(template, releaseId, phase) {
  const ssr = assertReleaseBinding(template, releaseId);
  const ssrId = Object.keys(template.Resources).find((id) => template.Resources[id] === ssr);
  const resources = template.Resources;
  for (const [id, type] of resourceTypes) {
    if (resources[id]?.Type !== type) fail("invalid_template");
  }
  const distribution = resources[distributionId].Properties.DistributionConfig;
  const viewer = resources[viewerId].Properties.FunctionCode;
  const parameter = resources[parameterId].Properties;
  const expectedDomainReference = { "Fn::GetAtt": [distributionId, "DomainName"] };
  if (
    !matchingStaticOrigin(distribution, releaseId, phase)
    || distribution.DefaultCacheBehavior.ViewerProtocolPolicy !== "redirect-to-https"
    || !same(distribution.DefaultCacheBehavior.FunctionAssociations, [{ EventType: "viewer-request", FunctionARN: { "Fn::GetAtt": [viewerId, "FunctionARN"] } }])
    || typeof viewer !== "string"
    || !viewer.includes('request.headers["x-forwarded-host"]')
    || !viewer.includes(phase === "generated" ? `var forwardedHost = "${hosts[0]}";` : "(request.headers.host && request.headers.host.value)")
    || parameter.Name !== "/zoolandingpage/production/frontend/distributions/lynx-music-offers/domain-name"
    || !same(parameter.Value, expectedDomainReference)
    || !same(template.Outputs?.[outputId]?.Value, expectedDomainReference)
  ) fail("invalid_template");
  const distributionArn = { "Fn::Join": ["", ["arn:", { Ref: "AWS::Partition" }, `:cloudfront::${ACCOUNT}:distribution/`, { Ref: distributionId }]] };
  // The CDK-generated Function URL permission can retain an account pseudo-parameter.
  const pseudoAccountArn = { "Fn::Join": ["", ["arn:", { Ref: "AWS::Partition" }, ":cloudfront::", { Ref: "AWS::AccountId" }, ":distribution/", { Ref: distributionId }]] };
  const sharedFunctionArn = { "Fn::GetAtt": [ssrId, "Arn"] };
  for (const [id, action] of permissions) {
    const grant = resources[id].Properties;
    const urlId = grant.FunctionName?.["Fn::GetAtt"]?.[0];
    const url = resources[urlId];
    const matchesSharedUrl = url?.Type === "AWS::Lambda::Url" && url.Properties.AuthType === "AWS_IAM"
      && same(url.Properties.TargetFunctionArn, sharedFunctionArn)
      && same(grant.FunctionName, { "Fn::GetAtt": [urlId, "FunctionArn"] });
    if (grant.Action !== action || grant.Principal !== "cloudfront.amazonaws.com"
      || (id.includes("Origin1InvokeFromApiFor")
        ? !matchesSharedUrl || !same(grant.SourceArn, pseudoAccountArn)
        : !same(grant.FunctionName, sharedFunctionArn) || !same(grant.SourceArn, distributionArn))) fail("invalid_scope");
  }
}

function validateAliasDelta(generated, aliases, releaseId) {
  validateTemplate(generated, releaseId, "generated");
  validateTemplate(aliases, releaseId, "aliases");
  const changed = [...resourceTypes.keys()].filter((id) => !same(generated.Resources[id], aliases.Resources[id]));
  const expected = structuredClone(generated.Resources[distributionId]);
  const target = aliases.Resources[distributionId].Properties.DistributionConfig;
  Object.assign(expected.Properties.DistributionConfig, { Aliases: target.Aliases, ViewerCertificate: target.ViewerCertificate });
  if (changed.length !== 2 || changed.some((id) => !aliasIds.includes(id))
    || !same(expected, aliases.Resources[distributionId])
    || !same(generated.Outputs[outputId], aliases.Outputs[outputId])) fail("invalid_phase_delta");
}

function assertReferencesExist(before, desired) {
  const available = new Set([...Object.keys(before.Resources), ...Object.keys(before.Parameters || {}), ...resourceTypes.keys()]);
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    const reference = node.Ref || node["Fn::GetAtt"]?.[0];
    if (typeof reference === "string" && !reference.startsWith("AWS::") && !available.has(reference)) fail("unknown_reference");
    for (const child of Object.values(node)) visit(child);
  };
  for (const id of resourceTypes.keys()) visit(desired.Resources[id]);
  visit(desired.Outputs[outputId]);
}

function project(before, desired, releaseId, action, phase, generated) {
  purpose(action, phase);
  const ssr = assertReleaseBinding(before, releaseId);
  if (!ssr.Properties.Environment?.Variables?.NG_ALLOWED_HOSTS?.split(",").includes("*.lynxpardelle.com")) fail("invalid_ssr_hosts");
  validateTemplate(desired, releaseId, phase);
  if (phase === "aliases") validateAliasDelta(generated, desired, releaseId);
  const entering = phase === "generated" && action === "deploy";
  const leaving = phase === "generated" && action === "rollback";
  const expectedLive = phase === "aliases" && action === "deploy" ? generated : desired;
  for (const id of resourceTypes.keys()) {
    if (!same(before.Resources[id], entering ? undefined : expectedLive.Resources[id])) fail("live_scope_drift");
  }
  if (!same(before.Outputs?.[outputId], entering ? undefined : expectedLive.Outputs[outputId])) fail("live_scope_drift");
  assertReferencesExist(before, desired);
  const candidate = structuredClone(before);
  candidate.Outputs ??= {};
  if (entering) {
    for (const id of resourceTypes.keys()) candidate.Resources[id] = structuredClone(desired.Resources[id]);
    candidate.Outputs[outputId] = structuredClone(desired.Outputs[outputId]);
  } else if (leaving) {
    for (const id of resourceTypes.keys()) delete candidate.Resources[id];
    delete candidate.Outputs[outputId];
  } else {
    const next = action === "deploy" ? desired : generated;
    for (const id of aliasIds) candidate.Resources[id] = structuredClone(next.Resources[id]);
  }
  return candidate;
}

function expectedInventory(action, phase) {
  purpose(action, phase);
  const change = phase === "aliases" ? "Modify" : action === "deploy" ? "Add" : "Remove";
  return new Map((phase === "aliases" ? aliasIds : [...resourceTypes.keys()]).map((id) => [id, change]));
}

function assertInventory(changes, action, phase) {
  const expected = expectedInventory(action, phase);
  if (!Array.isArray(changes) || changes.length !== expected.size) fail("invalid_inventory");
  for (const change of changes) {
    const resource = change?.ResourceChange;
    const id = resource?.LogicalResourceId;
    if (change?.Type !== "Resource" || !expected.has(id) || expected.get(id) !== resource.Action
      || resourceTypes.get(id) !== resource.ResourceType || ![undefined, "False"].includes(resource.Replacement)
      || resource.Scope?.some((scope) => scope !== "Properties")
      || resource.Details?.some((detail) => detail.Target?.Attribute !== undefined && detail.Target.Attribute !== "Properties")) fail("invalid_inventory");
    expected.delete(id);
  }
}

function reviewChanges(before, candidate, description, action, phase) {
  const expected = expectedInventory(action, phase);
  const allIds = new Set([...Object.keys(before.Resources), ...Object.keys(candidate.Resources)]);
  for (const id of allIds) {
    if (same(before.Resources[id], candidate.Resources[id]) === expected.has(id)) fail("invalid_inventory");
  }
  if (description?.Status !== "CREATE_COMPLETE" || description.ExecutionStatus !== "AVAILABLE" || description.NextToken || description.IncludeNestedStacks) fail("invalid_inventory");
  assertInventory(description.Changes, action, phase);
}

function validIssuedCertificate(certificateDetail) {
  return certificateDetail?.Status === "ISSUED"
    && certificateDetail.DomainName === tlsDomain
    && same(certificateDetail.SubjectAlternativeNames, [tlsDomain])
    && certificateDetail.DomainValidationOptions?.length === 1
    && certificateDetail.DomainValidationOptions[0].DomainName === tlsDomain
    && certificateDetail.DomainValidationOptions[0].ValidationStatus === "SUCCESS";
}

function resolveCertificate(call, action) {
  if (action === "rollback") {
    const body = call("lookup", "cloudformation", "get-template", { StackName: STACK, TemplateStage: "Original" }).TemplateBody;
    const live = typeof body === "string" ? JSON.parse(body) : body;
    const arn = live?.Resources?.[distributionId]?.Properties?.DistributionConfig?.ViewerCertificate?.AcmCertificateArn;
    if (!certificateArnPattern.test(arn || "")) fail("missing_live_certificate");
    return arn;
  }
  const result = call("lookup", "acm", "list-certificates", { CertificateStatuses: ["ISSUED"], MaxItems: 1000 });
  const matching = result.CertificateSummaryList?.filter((entry) => entry.DomainName === tlsDomain);
  if (result.NextToken || matching?.length !== 1) fail("missing_exact_certificate");
  const arn = matching[0].CertificateArn;
  if (!certificateArnPattern.test(arn || "") || arn === transportCertificate) fail("invalid_certificate");
  return arn;
}

function assertOfferDnsAbsent(call) {
  const zoneId = require("../config/environments").hostedZones.lynxPardelle.hostedZoneId;
  const zone = call("lookup", "route53", "get-hosted-zone", { Id: zoneId }).HostedZone;
  if (zone?.Id !== `/hostedzone/${zoneId}` || zone.Name !== "lynxpardelle.com." || zone.Config?.PrivateZone !== false) fail("invalid_zone");
  const reserved = new Set([...hosts.map((host) => `${host}.`), `${tlsDomain}.`, "\\052.music.lynxpardelle.com."]);
  let cursor = {};
  const observed = new Set();
  for (let page = 0; page < 100; page += 1) {
    const records = call("lookup", "route53", "list-resource-record-sets", { HostedZoneId: zoneId, MaxItems: "100", ...cursor });
    if (!Array.isArray(records.ResourceRecordSets) || typeof records.IsTruncated !== "boolean") fail("incomplete_dns_inventory");
    if (records.ResourceRecordSets.some(({ Name, Type }) => Name === "music.lynxpardelle.com." && Type === "NS")) fail("invalid_zone");
    if (records.ResourceRecordSets.some(({ Name }) => reserved.has(Name))) fail("offer_dns_already_present");
    if (!records.IsTruncated) return;
    cursor = { StartRecordName: records.NextRecordName, StartRecordType: records.NextRecordType, ...(records.NextRecordIdentifier ? { StartRecordIdentifier: records.NextRecordIdentifier } : {}) };
    const key = canonical(cursor);
    if (!cursor.StartRecordName || !cursor.StartRecordType || observed.has(key)) fail("incomplete_dns_inventory");
    observed.add(key);
  }
  fail("incomplete_dns_inventory");
}

async function verifyPublishedOffers(fetchPage = fetch) {
  for (let start = 0; start < hosts.length; start += 6) {
    await Promise.all(hosts.slice(start, start + 6).map(async (host) => {
      const url = new URL("https://api.zoolandingpage.com.mx/runtime-bundle");
      url.search = new URLSearchParams({ domain: host, path: "/", lang: "es" });
      const response = await fetchPage(url, { signal: AbortSignal.timeout(15_000), redirect: "error" });
      if (!response.ok) fail("offer_scope_not_published");
      const bundle = await response.json();
      if (bundle.domain !== host || bundle.environment !== "production" || bundle.pageId !== "default"
        || bundle.metadata?.notFound === true || (bundle.metadata?.statusCode || 200) !== 200) fail("offer_scope_not_published");
    }));
  }
}

const operationContract = Object.freeze({
  key: "lynx-music-offers",
  label: "Lynx music offers",
  purpose,
  resourceTypes,
  validateTemplate,
  captureBaseline: (call) => certificate.readProductionBaseline(call, { certificateAbsent: false, adminMustAbsent: false }),
  project,
  reviewChanges,
  async preflight(call, action, phase, desired) {
    assertOfferDnsAbsent(call);
    if (action !== "deploy") return;
    if (phase === "aliases") {
      const arn = desired.Resources[distributionId].Properties.DistributionConfig.ViewerCertificate.AcmCertificateArn;
      if (!validIssuedCertificate(call("lookup", "acm", "describe-certificate", { CertificateArn: arn }).Certificate)) fail("invalid_certificate");
    }
    await verifyPublishedOffers();
  },
  expectedPresence: (action, phase) => action === "deploy" || phase === "aliases",
  validateCleanup(record, options) {
    if (record.sourceSha !== options.sourceSha || record.sourcePackageSha256 !== options.fingerprint) fail("invalid_review");
    assertInventory(record.changes, options.action, options.phase);
  },
});

function sourcePackageHash(root = path.resolve(__dirname, "..")) {
  const files = [
    "tools/lynx-music-offers-production-frontdoor.js", "tools/lynx-music-offers-contract.js",
    "tools/zooberiah-production-frontdoor.js", "tools/thn-production-certificate-release.js",
    "tools/thn-production-retained-review.js", "tools/thn-admin-release.js",
    "config/environments.js", "config/lynx-music-offer-hosts.json", "lib/stacks/frontend-stack.js",
    "lib/project-helpers.js", ".github/workflows/lynx-music-offers-production-frontdoor.yml",
    "package.json", "package-lock.json",
  ];
  return sha(canonical(Object.fromEntries(files.map((file) => [file, sha(fs.readFileSync(path.join(root, file)))]))));
}

function prepare(releaseId, phase, destination) {
  purpose("deploy", phase);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(releaseId || "") || releaseId.includes("..")) fail("invalid_release");
  process.env.FRONTEND_PRODUCTION_RELEASE_ID = releaseId;
  process.env.FRONTEND_PRODUCTION_CUSTOM_DOMAIN_NAMES_ENABLED = "true";
  process.env.FRONTEND_PRODUCTION_LYNX_MUSIC_OFFERS_CERTIFICATE_ARN = transportCertificate;
  const cdk = require("aws-cdk-lib");
  const { FrontendStack } = require("../lib/stacks/frontend-stack");
  const configPath = require.resolve("../config/environments");
  function synthesize(targetPhase) {
    process.env.FRONTEND_PRODUCTION_LYNX_MUSIC_OFFERS_PHASE = targetPhase;
    delete require.cache[configPath];
    const { environments } = require(configPath);
    const environment = environments.find(({ name }) => name === "production");
    const app = new cdk.App({ outdir: path.join(destination, `assembly-${targetPhase}`) });
    const env = { account: ACCOUNT, region: REGION };
    const stage = new cdk.Stage(app, "ZoolandingProduction", { env });
    const stack = new FrontendStack(stage, "Zoolandingpage-production-Frontend", { env, environment, stackName: STACK });
    const template = stage.synth().getStackArtifact(stack.artifactId).template;
    validateTemplate(template, releaseId, targetPhase);
    return template;
  }
  const generated = synthesize("generated");
  const desired = phase === "generated" ? generated : synthesize("aliases");
  if (phase === "aliases") validateAliasDelta(generated, desired, releaseId);
  fs.writeFileSync(path.join(destination, "desired-template.json"), `${canonical(desired)}\n`, { flag: "wx" });
  fs.writeFileSync(path.join(destination, "generated-template.json"), `${canonical(generated)}\n`, { flag: "wx" });
  return { desiredTemplateSha256: sha(canonical(desired)), generatedTemplateSha256: sha(canonical(generated)) };
}

function assertAuthority(env = process.env) {
  if (env.GITHUB_REPOSITORY !== "LynxPardelle/zoolandingpage-aws-infra" || env.GITHUB_REF !== "refs/heads/main"
    || env.GITHUB_EVENT_NAME !== "workflow_dispatch" || env.GITHUB_SHA !== env.EXPECTED_SOURCE_SHA
    || !/^[a-f0-9]{40}$/.test(env.EXPECTED_SOURCE_SHA || "")
    || !/^\d+$/.test(env.GITHUB_RUN_ID || "") || !/^\d+$/.test(env.GITHUB_RUN_ATTEMPT || "")) fail("invalid_authority");
  certificate.assertCurrentProductionSource(env.EXPECTED_SOURCE_SHA, env);
  const read = (suffix) => {
    const result = spawnSync("gh", ["api", `repos/${env.GITHUB_REPOSITORY}/environments/production${suffix}`], { env, encoding: "utf8", timeout: 30_000, maxBuffer: 32_768 });
    if (result.error || result.status !== 0) fail("invalid_environment_protection");
    return JSON.parse(result.stdout);
  };
  const environment = read("");
  const policies = read("/deployment-branch-policies");
  if (environment.name !== "production" || environment.deployment_branch_policy?.custom_branch_policies !== true
    || environment.deployment_branch_policy.protected_branches !== false || policies.total_count !== 1
    || policies.branch_policies?.length !== 1 || policies.branch_policies[0].name !== "main" || policies.branch_policies[0].type !== "branch") fail("invalid_environment_protection");
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const [mode, releaseId, phase, target, generatedTarget] = argv;
  if (mode === "prepare" && argv.length === 4) return prepare(releaseId, phase, path.resolve(target));
  if (mode !== "operate" || argv.length !== 5) fail("invalid_command");
  purpose(env.ACTION, phase);
  const execution = env.EXECUTION;
  if (!["review", "execute", "cleanup"].includes(execution)) fail("invalid_operation");
  assertAuthority(env);
  const fingerprint = sourcePackageHash();
  const load = (file) => JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
  const desired = load(target), generatedDesired = load(generatedTarget);
  if (fingerprint !== env.EXPECTED_SOURCE_PACKAGE_SHA256 || sha(canonical(desired)) !== env.EXPECTED_DESIRED_SHA256
    || sha(canonical(generatedDesired)) !== env.EXPECTED_GENERATED_SHA256) fail("invalid_transport");
  const record = execution === "review" ? undefined : retained.validateReview(load(env.REVIEW_FILE));
  if (record && (record.purpose !== purpose(env.ACTION, phase) || record.digest !== env.EXPECTED_REVIEW_DIGEST
    || record.sourceSha !== env.EXPECTED_SOURCE_SHA || record.sourcePackageSha256 !== fingerprint)) fail("invalid_review");
  const runId = `${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}`;
  const call = certificate.productionClients(env, runId);
  if (phase === "aliases" && execution !== "cleanup") {
    validateAliasDelta(generatedDesired, desired, releaseId);
    const viewerCertificate = desired.Resources[distributionId].Properties.DistributionConfig.ViewerCertificate;
    if (viewerCertificate.AcmCertificateArn !== transportCertificate) fail("invalid_transport");
    viewerCertificate.AcmCertificateArn = resolveCertificate(call, env.ACTION);
  }
  const outcome = await runLynxMusicOffersOperation({
    action: env.ACTION, execution, phase, releaseId, desired, generatedDesired, call, runId, fingerprint,
    sourceSha: env.EXPECTED_SOURCE_SHA, approvedDigest: env.EXPECTED_REVIEW_DIGEST, record,
    outputPath: path.resolve(env.REVIEW_OUTPUT_FILE || "lynx-music-offers-review.json"),
    verifySource: () => assertAuthority(env),
  });
  return execution === "review" ? { digest: outcome.digest, resourceCount: outcome.changes.length } : { complete: true };
}

module.exports = { assertAuthority, assertInventory, assertOfferDnsAbsent, operationContract, project, purpose, reviewChanges, sourcePackageHash, validIssuedCertificate, validateAliasDelta, validateTemplate, verifyPublishedOffers };

if (require.main === module) main().then((result) => console.log(JSON.stringify(result))).catch((error) => {
  console.error(JSON.stringify({ error: /^[a-z0-9_]+$/.test(error.message) ? error.message : "lynx_music_offers_operation_failed" }));
  process.exitCode = 1;
});
