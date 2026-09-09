"use strict";

const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { createRoleClient } = require("./infra-test-aws");

const ADMIN_ORIGIN = "https://admin-test.thehairnarrative.com";
const STACK_NAME = "ZoolandingTest-Zoolandingpage-test-Frontend";
const SHA256 = /^[a-f0-9]{64}$/;
const fail = () => { throw new Error("thn_admin_release_invalid"); };
const digest = value => createHash("sha256").update(value).digest("hex");
const jsonBytes = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const exactKeys = (value, keys) => value && typeof value === "object" && !Array.isArray(value)
  && same(Object.keys(value).sort(), [...keys].sort());
const releaseIdValid = value => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)
  && !value.includes("..");

function isHashedStaticAssetPath(value) {
  if (typeof value !== "string" || value.length > 256 || !value.startsWith("/browser/")) return false;
  const segments = value.slice(1).split("/");
  const privateSegments = new Set(["server", ".git", ".github", "tools", "node_modules", "ai_notes",
    "findings", "errors-reports", "devonly", "logs", "reports", ".superpowers"]);
  if (segments.some(segment => !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(segment)
    || segment.includes("..") || privateSegments.has(segment.toLowerCase()))) return false;
  const fileName = segments.at(-1);
  return /\.(?:js|mjs|css|woff2?|ttf|otf|eot|png|jpe?g|webp|avif|gif|svg|ico)$/.test(fileName)
    && /(?:^|[._-])(?:[A-Fa-f0-9]{8,64}|[A-Z2-7]{8})(?=[._-])/.test(fileName);
}

// Environment inputs are public-safe, operator-selected bytes from an independently
// verified APP artifact. This job needs neither cloud credentials nor cross-repo tokens.
function selectThnAdminRelease(source = process.env) {
  if (!source.FRONTEND_TEST_THN_ADMIN_ORIGIN_ENABLED || source.FRONTEND_TEST_THN_ADMIN_ORIGIN_ENABLED === "false") return null;
  if (source.FRONTEND_TEST_THN_ADMIN_ORIGIN_ENABLED !== "true") fail();
  try {
    const encoded = source.FRONTEND_TEST_THN_ADMIN_MANIFEST_BASE64;
    const metadataJson = source.FRONTEND_TEST_THN_ADMIN_RELEASE_METADATA_JSON;
    if (typeof encoded !== "string" || encoded.length === 0 || encoded.length > 32768
      || typeof metadataJson !== "string" || metadataJson.length > 2048) fail();
    const raw = Buffer.from(encoded, "base64");
    if (raw.toString("base64") !== encoded) fail();
    const metadata = JSON.parse(metadataJson);
    if (JSON.stringify(metadata) !== metadataJson
      || !exactKeys(metadata, ["schemaVersion", "environment", "releaseId", "sourceCommit", "runId", "runAttempt", "deliverySha256", "manifestSha256"])
      || metadata.schemaVersion !== 1 || metadata.environment !== "test" || !releaseIdValid(metadata.releaseId)
      || !/^[a-f0-9]{40}$/.test(metadata.sourceCommit) || !/^[1-9][0-9]{0,19}$/.test(metadata.runId)
      || !/^[1-9][0-9]{0,9}$/.test(metadata.runAttempt) || typeof metadata.runId !== "string"
      || typeof metadata.runAttempt !== "string" || !SHA256.test(metadata.deliverySha256)
      || !SHA256.test(metadata.manifestSha256) || digest(raw) !== metadata.manifestSha256) fail();
    const manifest = JSON.parse(raw.toString("utf8"));
    if (!jsonBytes(manifest).equals(raw)
      || !exactKeys(manifest, ["version", "environment", "releaseId", "staticAssetPaths"])
      || manifest.version !== 1 || manifest.environment !== "test" || manifest.releaseId !== metadata.releaseId
      || !Array.isArray(manifest.staticAssetPaths) || manifest.staticAssetPaths.length < 1
      || manifest.staticAssetPaths.length > 64 || !manifest.staticAssetPaths.every(isHashedStaticAssetPath)
      || new Set(manifest.staticAssetPaths.map(value => value.toLowerCase())).size !== manifest.staticAssetPaths.length) fail();
    return { manifest, metadata, manifestBase64: encoded, originPrefix: `frontend/angular-ssr/test/releases/${metadata.releaseId}` };
  } catch { fail(); }
}

function validateSelection(selection) {
  if (!selection) fail();
  const normalized = selectThnAdminRelease({
    FRONTEND_TEST_THN_ADMIN_ORIGIN_ENABLED: "true",
    FRONTEND_TEST_THN_ADMIN_MANIFEST_BASE64: selection.manifestBase64,
    FRONTEND_TEST_THN_ADMIN_RELEASE_METADATA_JSON: JSON.stringify(selection.metadata),
  });
  if (!same(normalized, selection)) fail();
  return normalized;
}

const pagePaths = ["/admin/journal/access", "/admin/journal/mfa", "/admin/journal", "/admin/journal/new",
  "/admin/journal/:articleId/edit", "/admin/journal/:articleId/preview"];
const backendSignatures = ["GET,POST /auth-v2/runtime-config", "POST /auth-v2/session/signin",
  "POST /auth-v2/session/challenge/respond", "POST /auth-v2/session/mfa/setup", "POST /auth-v2/session/mfa/verify",
  "GET /auth-v2/session/me", "POST /auth-v2/session/logout", "POST /features/content-hub-v2/read", "POST /features/content-hub-v2/action"];
function routeSignatures(routes) {
  if (!Array.isArray(routes)) fail();
  return routes.map(route => {
    if (!Array.isArray(route.methods) || new Set(route.methods).size !== route.methods.length) fail();
    return `${[...route.methods].sort().join(",")} ${route.path}`;
  }).sort();
}

async function verifyPublishedAdminRelease(selection, readObject) {
  try {
    const selected = validateSelection(selection);
    const { metadata, originPrefix } = selected;
    const names = ["manifest.json", "delivery.json", "thn-admin-release.json", "thn-route-manifest.json"];
    const objects = new Map();
    for (const name of names) {
      const data = await readObject(`${originPrefix}/${name}`);
      if (!Buffer.isBuffer(data) || data.length < 2 || data.length > 2 * 1024 * 1024) fail();
      objects.set(name, data);
    }
    if (digest(objects.get("delivery.json")) !== metadata.deliverySha256
      || digest(objects.get("thn-admin-release.json")) !== metadata.manifestSha256
      || objects.get("thn-admin-release.json").toString("base64") !== selected.manifestBase64) fail();
    const delivery = JSON.parse(objects.get("delivery.json"));
    if (!exactKeys(delivery, ["schemaVersion", "environment", "releaseId", "sourceCommit", "runId", "runAttempt", "deployed", "thnAdmin", "files"])
      || delivery.schemaVersion !== 1 || delivery.environment !== "test" || delivery.deployed !== false
      || !exactKeys(delivery.thnAdmin, ["enabled", "origin"]) || delivery.thnAdmin.enabled !== true
      || delivery.thnAdmin.origin !== ADMIN_ORIGIN
      || ["releaseId", "sourceCommit", "runId", "runAttempt"].some(key => delivery[key] !== metadata[key])
      || !Array.isArray(delivery.files) || delivery.files.length < 5 || delivery.files.length > 20000) fail();
    const inventory = new Map();
    const caseFolded = new Set();
    for (const item of delivery.files) {
      if (!exactKeys(item, ["path", "sha256"]) || typeof item.path !== "string"
        || item.path.length > 512 || !SHA256.test(item.sha256)
        || !/^(?:manifest\.json|ssr-handler\.zip|thn-admin-release\.json|thn-route-manifest\.json|staging\/browser\/[A-Za-z0-9_./-]+)$/.test(item.path)
        || item.path.split("/").some(segment => !segment || segment === "." || segment === "..")
        || caseFolded.has(item.path.toLowerCase())) fail();
      inventory.set(item.path, item.sha256);
      caseFolded.add(item.path.toLowerCase());
    }
    if (!same([...inventory.keys()], [...inventory.keys()].sort())) fail();
    for (const name of ["manifest.json", "thn-admin-release.json", "thn-route-manifest.json"]) {
      if (inventory.get(name) !== digest(objects.get(name))) fail();
    }
    if (selected.manifest.staticAssetPaths.some(asset => !inventory.has(`staging${asset}`))) fail();
    const source = JSON.parse(objects.get("manifest.json"));
    if (source.schemaVersion !== 1 || source.app !== "zoolandingpage" || source.environment !== "test"
      || source.releaseId !== metadata.releaseId || source.sourceCommit !== metadata.sourceCommit
      || source.browserPrefix !== `${originPrefix}/browser`
      || source.serverBundleKey !== `${originPrefix}/server/ssr-handler.zip`
      || !inventory.has("ssr-handler.zip") || source.checksums?.["server/ssr-handler.zip"] !== inventory.get("ssr-handler.zip")) fail();
    const routes = JSON.parse(objects.get("thn-route-manifest.json"));
    const admin = routes.origins?.admin;
    if (routes.version !== 1 || routes.environment !== "test" || routes.domain !== "thehairnarrative.com"
      || admin?.host !== "admin-test.thehairnarrative.com" || admin.originRole !== "protected-admin"
      || admin.defaultDecision !== "deny" || admin.staticAssets?.mode !== "selected-release-manifest-only"
      || !same(routeSignatures(admin.pageRoutes), pagePaths.map(value => `GET ${value}`).sort())
      || !same(routeSignatures(admin.backendRoutes), [...backendSignatures].sort())) fail();
    return true;
  } catch { throw new Error("thn_admin_published_release_invalid"); }
}

function frontendTemplateFromAssembly(assembly, readTemplate) {
  const stacks = Object.values(assembly.artifacts || {}).filter(item => item.type === "aws:cloudformation:stack"
    && item.properties?.stackName === STACK_NAME);
  if (stacks.length !== 1 || !/^[A-Za-z0-9_-]+\.template\.json$/.test(stacks[0].properties.templateFile)) fail();
  return readTemplate(stacks[0].properties.templateFile);
}

function adminTemplateFromAssembly(assembly, readTemplate) {
  const template = frontendTemplateFromAssembly(assembly, readTemplate);
  const distributions = Object.values(template.Resources || {}).filter(item => item.Type === "AWS::CloudFront::Distribution"
    && item.Properties?.DistributionConfig?.Aliases?.includes("admin-test.thehairnarrative.com"));
  if (distributions.length !== 1) fail();
  const config = distributions[0].Properties.DistributionConfig;
  if (!same(config.Aliases, ["admin-test.thehairnarrative.com"])) fail();
  return { template, config };
}

function adminCertificateFromAssembly(assembly, readTemplate) {
  const { config } = adminTemplateFromAssembly(assembly, readTemplate);
  if (typeof config.ViewerCertificate?.AcmCertificateArn !== "string") fail();
  return config.ViewerCertificate.AcmCertificateArn;
}

function verifyAdminAssemblyQuotas(assembly, readTemplate) {
  try {
    const { config, template } = adminTemplateFromAssembly(assembly, readTemplate);
    const associations = config.DefaultCacheBehavior?.FunctionAssociations?.filter(item => item.EventType === "viewer-request");
    if (associations?.length !== 1 || !Array.isArray(config.CacheBehaviors) || config.CacheBehaviors.length + 1 > 75) fail();
    const reference = associations[0].FunctionARN?.["Fn::GetAtt"];
    if (!Array.isArray(reference) || reference.length !== 2 || reference[1] !== "FunctionARN") fail();
    const edge = template.Resources[reference[0]];
    if (edge?.Type !== "AWS::CloudFront::Function" || typeof edge.Properties?.FunctionCode !== "string") fail();
    const functionBytes = Buffer.byteLength(edge.Properties.FunctionCode, "utf8");
    if (functionBytes > 10240 || functionBytes === 0) fail();
    return { functionBytes, orderedBehaviors: config.CacheBehaviors.length };
  } catch { throw new Error("thn_admin_assembly_quota_invalid"); }
}

function verifyAdminCertificate(response, { arn, arnSha256, accountId }) {
  const certificate = response?.Certificate;
  if (!/^[0-9]{12}$/.test(accountId) || typeof arn !== "string"
    || !new RegExp(`^arn:aws:acm:us-east-1:${accountId}:certificate/[A-Za-z0-9-]+$`).test(arn)
    || !SHA256.test(arnSha256) || digest(arn) !== arnSha256
    || certificate?.CertificateArn !== arn || certificate.Status !== "ISSUED"
    || certificate.DomainName !== "admin-test.thehairnarrative.com"
    || !same(certificate.SubjectAlternativeNames, ["admin-test.thehairnarrative.com"])) {
    throw new Error("thn_admin_certificate_invalid");
  }
  return true;
}

function verifyCertificatePreservation(desired, live, metadata, detail, selectedArn) {
  const reject = () => { throw new Error("thn_admin_certificate_preservation_invalid"); };
  const logical = "ThnAdminTestCertificate", host = "admin-test.thehairnarrative.com";
  const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
  const equivalent = (left, right) => same(stable(left), stable(right));
  if (!desired?.Resources || !live?.Resources) reject();
  for (const template of [desired, live]) {
    if (Object.entries(template.Resources).some(([id, item]) => id !== logical && item.Type === "AWS::CertificateManager::Certificate"
      && item.Properties?.DomainName === host)) reject();
  }
  const after = desired.Resources[logical], before = live.Resources[logical];
  if (!after && !before) {
    if (selectedArn || metadata.thn_admin_certificate_sha256 !== digest("")) reject();
    return null;
  }
  if (!after || !before) reject();
  const zoneId = after.Properties?.DomainValidationOptions?.[0]?.HostedZoneId;
  if (typeof zoneId !== "string" || !/^Z[A-Z0-9]+$/.test(zoneId) || digest(zoneId) !== metadata.thn_admin_hosted_zone_sha256) reject();
  const expected = { Type: "AWS::CertificateManager::Certificate", DeletionPolicy: "Retain", UpdateReplacePolicy: "Retain", Properties: {
    DomainName: host, ValidationMethod: "DNS", CertificateExport: "DISABLED", DomainValidationOptions: [{ DomainName: host, HostedZoneId: zoneId }],
  } };
  for (const item of [before, after]) {
    const { Metadata: ignoredMetadata, ...resource } = item;
    if (!equivalent(resource, expected)) reject();
  }
  if (detail?.StackName !== STACK_NAME || detail.LogicalResourceId !== logical || detail.ResourceType !== expected.Type
    || !["CREATE_COMPLETE", "UPDATE_COMPLETE"].includes(detail.ResourceStatus) || typeof detail.PhysicalResourceId !== "string"
    || digest(detail.PhysicalResourceId) !== metadata.thn_admin_certificate_sha256
    || (selectedArn && detail.PhysicalResourceId !== selectedArn)) reject();
  return detail.PhysicalResourceId;
}

async function main(args, readAws) {
  const [operation, target] = args;
  if (args.length !== 2 || !["prepare", "compare", "verify"].includes(operation)) fail();
  if (operation === "prepare") {
    const selected = selectThnAdminRelease();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, jsonBytes(selected), { flag: "wx" });
    return;
  }
  const raw = fs.readFileSync(target);
  if (raw.length > 65536) fail();
  const selected = JSON.parse(raw);
  if (!jsonBytes(selected).equals(raw)) fail();
  if (operation === "compare") {
    if (!same(selectThnAdminRelease(), selected)) fail();
    return;
  }
  if (!['true', 'false'].includes(process.env.THN_ADMIN_ORIGIN_ENABLED)
    || (process.env.THN_ADMIN_ORIGIN_ENABLED === "true") !== Boolean(selected)) fail();
  if (selected) validateSelection(selected);
  const releaseRoot = path.dirname(target);
  const releaseMetadata = JSON.parse(fs.readFileSync(path.join(releaseRoot, "release-metadata.json")));
  const assemblyRoot = path.join(releaseRoot, "cdk.out", "assembly-ZoolandingTest");
  const assembly = JSON.parse(fs.readFileSync(path.join(assemblyRoot, "manifest.json")));
  const readTemplate = file => JSON.parse(fs.readFileSync(path.join(assemblyRoot, file)));
  if (selected) verifyAdminAssemblyQuotas(assembly, readTemplate);
  const desiredTemplate = frontendTemplateFromAssembly(assembly, readTemplate);
  const selectedArn = selected ? adminCertificateFromAssembly(assembly, readTemplate) : undefined;
  if (releaseMetadata.expected_aws_account_id !== process.env.EXPECTED_AWS_ACCOUNT_ID
    || releaseMetadata.expected_aws_region !== "us-east-1" || releaseMetadata.thn_admin_origin_enabled !== process.env.THN_ADMIN_ORIGIN_ENABLED) fail();
  const read = readAws || createRoleClient(releaseRoot, "lookup");
  const response = JSON.parse(read(["cloudformation", "get-template", "--stack-name", STACK_NAME, "--template-stage", "Original", "--output", "json"]));
  const liveTemplate = typeof response.TemplateBody === "string" ? JSON.parse(response.TemplateBody) : response.TemplateBody;
  const resource = desiredTemplate.Resources?.ThnAdminTestCertificate || liveTemplate?.Resources?.ThnAdminTestCertificate
    ? JSON.parse(read(["cloudformation", "describe-stack-resource", "--stack-name", STACK_NAME,
      "--logical-resource-id", "ThnAdminTestCertificate", "--output", "json"])).StackResourceDetail : undefined;
  const certificateArn = verifyCertificatePreservation(desiredTemplate, liveTemplate, releaseMetadata, resource, selectedArn);
  if (!certificateArn) return;
  verifyAdminCertificate(JSON.parse(read(["acm", "describe-certificate", "--certificate-arn", certificateArn, "--output", "json"])), {
    arn: certificateArn, arnSha256: releaseMetadata.thn_admin_certificate_sha256,
    accountId: process.env.EXPECTED_AWS_ACCOUNT_ID,
  });
  if (!selected) return;
  // Use the owned TEST stack output, never an operator-supplied bucket or URL.
  const stack = JSON.parse(read(["cloudformation", "describe-stacks", "--stack-name", STACK_NAME, "--output", "json"]));
  if (stack.Stacks?.length !== 1 || stack.Stacks[0].StackName !== STACK_NAME) fail();
  const buckets = (stack.Stacks[0].Outputs || []).filter(item => item.OutputKey === "FrontendArtifactBucketName");
  if (buckets.length !== 1 || buckets[0].OutputValue !== `zoolandingpage-test-frontend-artifacts-${process.env.EXPECTED_AWS_ACCOUNT_ID}`) fail();
  await verifyPublishedAdminRelease(selected, async key => read([
    "s3", "cp", `s3://${buckets[0].OutputValue}/${key}`, "-", "--only-show-errors",
  ]));
}

if (require.main === module) {
  main(process.argv.slice(2)).catch(() => { process.stderr.write("thn_admin_release_preflight_failed\n"); process.exitCode = 1; });
}
module.exports = { selectThnAdminRelease, verifyPublishedAdminRelease, isHashedStaticAssetPath, validateSelection,
  verifyAdminCertificate, verifyCertificatePreservation, adminCertificateFromAssembly, verifyAdminAssemblyQuotas, main };
