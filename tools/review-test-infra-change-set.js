#!/usr/bin/env node
"use strict";

const fs = require("node:fs");

const EXACT_ADMIN_HOST = "admin-test.thehairnarrative.com";
const EXACT_TEST_STACK = "ZoolandingTest-Zoolandingpage-test-Frontend";
const EXACT_AWS_ACCOUNT_ID = "765932874577";
const EXACT_AWS_REGION = "us-east-1";
const NO_CHANGE_REASON =
  "The submitted information didn't contain changes. Submit different information to create a change set.";

class ChangeSetReviewError extends Error {}

const ADMIN_INFRASTRUCTURE_RULES = [
  [/^FrontendViewerHostHeaderFunctionThehairnarrativeAdminTest[A-F0-9]+$/, "AWS::CloudFront::Function"],
  [/^FrontendResponseHeadersPolicyThehairnarrativeAdminTest[A-F0-9]+$/, "AWS::CloudFront::ResponseHeadersPolicy"],
  [/^FrontendDistributionThehairnarrativeAdminTest[A-F0-9]+$/, "AWS::CloudFront::Distribution"],
  [/^FrontendAliasUpsertThehairnarrativeAdminTest[A-Za-z0-9]+$/, "Custom::ZoolandingFrontendAliasRecords"],
  [/^FrontendAliasUpsertThehairnarrativeAdminTest[A-Za-z0-9]+CustomResourcePolicy[A-F0-9]+$/, "AWS::IAM::Policy"],
  [/^FrontendDistributionDomainParameterThehairnarrativeAdminTest[A-F0-9]+$/, "AWS::SSM::Parameter"],
];

const ADMIN_ROUTE_RULES = [
  [/^FrontendSsrFunction[A-F0-9]+$/, "AWS::Lambda::Function"],
  [/^FrontendSsrFunctionAllowCloudFrontInvokeFunction(?:Url)?ThehairnarrativeAdminTest[A-F0-9]+$/, "AWS::Lambda::Permission"],
  [/^FrontendDistributionThehairnarrativeAdminTest[A-Za-z0-9]+InvokeFromApiFor[A-Za-z0-9]+$/, "AWS::Lambda::Permission"],
];

function requireString(value, code) {
  if (typeof value !== "string" || value.length === 0) {
    throw new ChangeSetReviewError(code);
  }
  return value;
}

function matchesRule(logicalId, resourceType, rules) {
  return rules.some(([pattern, expectedType]) => (
    pattern.test(logicalId) && resourceType === expectedType
  ));
}

function parseContext(value) {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new ChangeSetReviewError("change_set_context_invalid");
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ChangeSetReviewError("change_set_context_invalid");
  }
  return parsed;
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])])
    );
  }
  return value;
}

function allowedHostSnapshot(value) {
  const context = parseContext(value);
  const clone = JSON.parse(JSON.stringify(context));
  const root = clone.Properties?.Environment ? clone.Properties : clone;
  const allowedHosts = root.Environment?.Variables?.NG_ALLOWED_HOSTS;
  if (typeof allowedHosts !== "string") {
    throw new ChangeSetReviewError("shared_ssr_change_forbidden");
  }
  const hosts = [...new Set(
    allowedHosts.split(",").map((host) => host.trim().toLowerCase()).filter(Boolean)
  )].sort();
  delete root.Environment.Variables.NG_ALLOWED_HOSTS;
  return {
    hosts,
    remainder: JSON.stringify(canonicalize(clone)),
  };
}

function hostMembershipChanged(resource, host) {
  try {
    const before = allowedHostSnapshot(resource.BeforeContext);
    const after = allowedHostSnapshot(resource.AfterContext);
    return before.hosts.includes(host) !== after.hosts.includes(host);
  } catch {
    const contextText = JSON.stringify({
      before: resource.BeforeContext,
      after: resource.AfterContext,
      details: resource.Details,
    });
    return contextText.includes(host);
  }
}

function assertOnlyAdminHostMembershipChanged(resource) {
  const before = allowedHostSnapshot(resource.BeforeContext);
  const after = allowedHostSnapshot(resource.AfterContext);
  const beforeHosts = new Set(before.hosts);
  const afterHosts = new Set(after.hosts);
  const changedHosts = [...new Set([...before.hosts, ...after.hosts])]
    .filter((host) => beforeHosts.has(host) !== afterHosts.has(host));
  if (
    before.remainder !== after.remainder
    || changedHosts.length !== 1
    || changedHosts[0] !== EXACT_ADMIN_HOST
  ) {
    throw new ChangeSetReviewError("shared_ssr_change_forbidden");
  }
}

function assertOnlyCdkAnalyticsChanged(resource) {
  if (resource.Action !== "Modify") {
    throw new ChangeSetReviewError("cdk_metadata_change_forbidden");
  }
  const before = parseContext(resource.BeforeContext);
  const after = parseContext(resource.AfterContext);
  const native = Object.hasOwn(before, "Properties") || Object.hasOwn(after, "Properties");
  const beforeProperties = native ? parseContext(before.Properties) : before;
  const afterProperties = native ? parseContext(after.Properties) : after;
  if (
    JSON.stringify(Object.keys(beforeProperties).sort()) !== JSON.stringify(["Analytics"])
    || JSON.stringify(Object.keys(afterProperties).sort()) !== JSON.stringify(["Analytics"])
    || typeof beforeProperties.Analytics !== "string"
    || typeof afterProperties.Analytics !== "string"
    || beforeProperties.Analytics.length === 0
    || afterProperties.Analytics.length === 0
    || beforeProperties.Analytics === afterProperties.Analytics
  ) {
    throw new ChangeSetReviewError("cdk_metadata_change_forbidden");
  }
  if (native) {
    assertMetadataDetail(resource, "Properties", "Analytics", "/Properties/Analytics",
      "Conditionally", beforeProperties.Analytics, afterProperties.Analytics);
    const strippedBefore = structuredClone(before), strippedAfter = structuredClone(after);
    delete strippedBefore.Properties.Analytics;
    delete strippedAfter.Properties.Analytics;
    if (JSON.stringify(canonicalize(strippedBefore)) !== JSON.stringify(canonicalize(strippedAfter))) {
      throw new ChangeSetReviewError("cdk_metadata_change_forbidden");
    }
  } else if (resource.Replacement === "Conditional") {
    // Conditional is accepted only with the complete native Analytics proof.
    throw new ChangeSetReviewError("cdk_metadata_change_forbidden");
  }
}

function assertMetadataDetail(resource, attribute, name, targetPath, recreation, before, after) {
  const detail = resource.Details?.[0], target = detail?.Target;
  if (JSON.stringify(resource.Scope) !== JSON.stringify([attribute])
    || !Array.isArray(resource.Details) || resource.Details.length !== 1 || detail.Evaluation !== "Static"
    || detail.ChangeSource !== "DirectModification" || target?.Attribute !== attribute
    || (name ? target.Name !== name : target.Name != null)
    || target.Path !== targetPath || target.RequiresRecreation !== recreation
    || target.AttributeChangeType !== "Modify" || target.BeforeValue !== before || target.AfterValue !== after) {
    throw new ChangeSetReviewError("cdk_metadata_change_forbidden");
  }
}

function isAssetPathMetadata(resource) {
  return resource.ResourceType === "AWS::Lambda::Function" && (
    JSON.stringify(resource.Scope) === JSON.stringify(["Metadata"])
    || resource.Details?.length === 1 && resource.Details[0].Target?.Path === "/Metadata/aws:asset:path"
  );
}

function assertOnlyAssetPathMetadataChanged(resource) {
  if (resource.Action !== "Modify" || resource.Replacement !== "False") {
    throw new ChangeSetReviewError("cdk_metadata_change_forbidden");
  }
  const before = structuredClone(parseContext(resource.BeforeContext));
  const after = structuredClone(parseContext(resource.AfterContext));
  for (const value of [before, after]) {
    if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(["Metadata", "Properties"])
      || !value.Properties || typeof value.Properties !== "object" || Array.isArray(value.Properties)
      || Object.keys(value.Properties).length === 0 || !value.Metadata || typeof value.Metadata !== "object"
      || Array.isArray(value.Metadata) || typeof value.Metadata["aws:asset:path"] !== "string"
      || value.Metadata["aws:asset:path"].length === 0 || value.Metadata["aws:asset:property"] !== "Code") {
      throw new ChangeSetReviewError("cdk_metadata_change_forbidden");
    }
  }
  const beforePath = before.Metadata["aws:asset:path"], afterPath = after.Metadata["aws:asset:path"];
  assertMetadataDetail(resource, "Metadata", null, "/Metadata/aws:asset:path", "Never", beforePath, afterPath);
  delete before.Metadata["aws:asset:path"];
  delete after.Metadata["aws:asset:path"];
  if (beforePath === afterPath || JSON.stringify(canonicalize(before)) !== JSON.stringify(canonicalize(after))) {
    throw new ChangeSetReviewError("cdk_metadata_change_forbidden");
  }
}

function domainTokens(value) {
  if (typeof value !== "string") {
    return [];
  }
  return value.match(/(?:[a-z0-9*_-]+\.)*thehairnarrative\.com\.?/gi) || [];
}

function assertNoProductionAlias(value, path = "root") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoProductionAlias(entry, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      assertNoProductionAlias(entry, `${path}.${key}`);
    }
    return;
  }
  if (typeof value !== "string") {
    return;
  }

  const trimmed = value.trim();
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (
    trimmed.startsWith("[") && trimmed.endsWith("]")
  )) {
    try {
      assertNoProductionAlias(JSON.parse(trimmed), `${path}.json`);
      return;
    } catch (error) {
      if (error instanceof ChangeSetReviewError) {
        throw error;
      }
    }
  }

  for (const token of domainTokens(value)) {
    const normalized = token.toLowerCase().replace(/\.$/, "");
    if (normalized === EXACT_ADMIN_HOST) {
      continue;
    }
    if (
      normalized === "thehairnarrative.com"
      && /hostedzone(name)?$/i.test(path.split(".").at(-1) || "")
    ) {
      continue;
    }
    throw new ChangeSetReviewError("production_alias_forbidden");
  }
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function requireChangeSetArn(value, expectedName, expectedAccountId, expectedRegion) {
  const arn = requireString(value, "change_set_arn_invalid");
  const pattern = new RegExp(
    `^arn:aws:cloudformation:${escapeRegex(expectedRegion)}:${escapeRegex(expectedAccountId)}`
      + `:changeSet/${escapeRegex(expectedName)}/[A-Za-z0-9-]+$`
  );
  if (!pattern.test(arn)) {
    throw new ChangeSetReviewError("change_set_arn_invalid");
  }
}

function requireStackArn(value, expectedStackName, expectedAccountId, expectedRegion) {
  const arn = requireString(value, "stack_arn_invalid");
  const pattern = new RegExp(
    `^arn:aws:cloudformation:${escapeRegex(expectedRegion)}:${escapeRegex(expectedAccountId)}`
      + `:stack/${escapeRegex(expectedStackName)}/[A-Za-z0-9-]+$`
  );
  if (!pattern.test(arn)) {
    throw new ChangeSetReviewError("stack_arn_invalid");
  }
}

function reviewChangeSet(changeSet, options) {
  if (!changeSet || typeof changeSet !== "object" || Array.isArray(changeSet)) {
    throw new ChangeSetReviewError("change_set_description_invalid");
  }
  const {
    expectedStackName,
    expectedChangeSetName,
    expectedChangeSetArn,
    expectedChangeSetType,
    expectedAccountId,
    expectedRegion,
    expectedHost = EXACT_ADMIN_HOST,
    adminInfrastructureApproved = false,
    adminRouteAssociationApproved = false,
  } = options || {};

  if (
    expectedStackName !== EXACT_TEST_STACK
    || expectedHost !== EXACT_ADMIN_HOST
    || expectedAccountId !== EXACT_AWS_ACCOUNT_ID
    || expectedRegion !== EXACT_AWS_REGION
  ) {
    throw new ChangeSetReviewError("test_target_invalid");
  }
  if (expectedChangeSetType !== "UPDATE") {
    throw new ChangeSetReviewError("change_set_type_invalid");
  }
  requireChangeSetArn(
    expectedChangeSetArn,
    expectedChangeSetName,
    expectedAccountId,
    expectedRegion
  );
  requireStackArn(
    changeSet.StackId,
    expectedStackName,
    expectedAccountId,
    expectedRegion
  );
  if (
    changeSet.StackName !== expectedStackName
    || changeSet.ChangeSetName !== expectedChangeSetName
    || changeSet.ChangeSetId !== expectedChangeSetArn
    // DescribeChangeSet omits the request type; reject it only if explicitly conflicting.
    || (Object.hasOwn(changeSet, "ChangeSetType") && changeSet.ChangeSetType !== expectedChangeSetType)
  ) {
    throw new ChangeSetReviewError("change_set_identity_invalid");
  }
  if (adminInfrastructureApproved !== adminRouteAssociationApproved) {
    throw new ChangeSetReviewError("admin_approval_pair_invalid");
  }
  const adminMode = adminInfrastructureApproved && adminRouteAssociationApproved;

  const { Status: status, ExecutionStatus: executionStatus, StatusReason: statusReason } = changeSet;
  const changes = changeSet.Changes;
  if (
    status === "FAILED"
    && executionStatus === "UNAVAILABLE"
    && statusReason === NO_CHANGE_REASON
    && (changes === undefined || (Array.isArray(changes) && changes.length === 0))
  ) {
    return "noop";
  }
  if (status !== "CREATE_COMPLETE" || executionStatus !== "AVAILABLE") {
    throw new ChangeSetReviewError("change_set_not_available");
  }
  if (!Array.isArray(changes) || changes.length === 0) {
    throw new ChangeSetReviewError("change_set_changes_invalid");
  }

  let adminSurfaceChanges = 0;
  let metadataOnlyChanges = 0;
  let exactHostEvidence = false;
  for (const change of changes) {
    if (!change || change.Type !== "Resource" || !change.ResourceChange) {
      throw new ChangeSetReviewError("change_set_entry_invalid");
    }
    const resource = change.ResourceChange;
    const action = requireString(resource.Action, "change_set_action_invalid");
    const logicalId = requireString(resource.LogicalResourceId, "logical_resource_id_invalid");
    const resourceType = requireString(resource.ResourceType, "resource_type_invalid");
    const replacement = resource.Replacement;
    const isCdkAnalyticsMetadata = logicalId === "CDKMetadata"
      && resourceType === "AWS::CDK::Metadata";

    if (!['Add', 'Modify'].includes(action) || (![undefined, null, "False"].includes(replacement)
      && !(isCdkAnalyticsMetadata && replacement === "Conditional"))) {
      throw new ChangeSetReviewError("stateful_resource_change_forbidden");
    }
    if (logicalId === "ThnAdminTestCertificate" || resourceType === "AWS::CertificateManager::Certificate") {
      throw new ChangeSetReviewError("thn_certificate_prerequisite_change_forbidden");
    }
    if (/production|prod/i.test(logicalId)) {
      throw new ChangeSetReviewError("production_alias_forbidden");
    }
    assertNoProductionAlias(resource, `change.${logicalId}`);

    const isInfrastructure = matchesRule(logicalId, resourceType, ADMIN_INFRASTRUCTURE_RULES);
    const isRouteAssociation = matchesRule(logicalId, resourceType, ADMIN_ROUTE_RULES);
    if (logicalId === "CDKMetadata" || resourceType === "AWS::CDK::Metadata") {
      if (!isCdkAnalyticsMetadata) {
        throw new ChangeSetReviewError("cdk_metadata_change_forbidden");
      }
      assertOnlyCdkAnalyticsChanged(resource);
      metadataOnlyChanges += 1;
      continue;
    }
    if (isAssetPathMetadata(resource)) {
      assertOnlyAssetPathMetadataChanged(resource);
      metadataOnlyChanges += 1;
      continue;
    }
    const contextText = JSON.stringify({
      before: resource.BeforeContext,
      after: resource.AfterContext,
      details: resource.Details,
    });
    const isSharedSsrFunction = isRouteAssociation
      && resourceType === "AWS::Lambda::Function";
    const adminHostMembershipChanged = isSharedSsrFunction
      && hostMembershipChanged(resource, EXACT_ADMIN_HOST);

    if (adminMode) {
      if (!isInfrastructure && !isRouteAssociation) {
        throw new ChangeSetReviewError("non_admin_resource_change_forbidden");
      }
      if (isSharedSsrFunction) {
        if (action !== "Modify") {
          throw new ChangeSetReviewError("non_admin_resource_change_forbidden");
        }
        assertOnlyAdminHostMembershipChanged(resource);
      }
      adminSurfaceChanges += 1;
      exactHostEvidence ||= contextText.includes(EXACT_ADMIN_HOST)
        || adminHostMembershipChanged;
    } else if (
      isInfrastructure
      || isRouteAssociation && logicalId.includes("ThehairnarrativeAdminTest")
      || adminHostMembershipChanged
    ) {
      throw new ChangeSetReviewError("admin_change_requires_approvals");
    }
  }

  if (adminMode && (adminSurfaceChanges === 0 || !exactHostEvidence)) {
    throw new ChangeSetReviewError("admin_change_evidence_missing");
  }
  // Do not execute a stack update solely for CDK bookkeeping. Every entry has
  // still passed identity, production, context, scope and replacement checks.
  if (metadataOnlyChanges === changes.length) return "noop";
  return "execute";
}

function parseArguments(argv) {
  if (argv.length < 1) {
    throw new ChangeSetReviewError("description_path_required");
  }
  const values = { descriptionPath: argv[0] };
  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined) {
      throw new ChangeSetReviewError("arguments_invalid");
    }
    values[flag.slice(2)] = value;
  }
  return values;
}

function parseApproval(value) {
  if (!['true', 'false'].includes(value)) {
    throw new ChangeSetReviewError("approval_value_invalid");
  }
  return value === "true";
}

function main(argv = process.argv.slice(2)) {
  const values = parseArguments(argv);
  const payload = JSON.parse(fs.readFileSync(values.descriptionPath, "utf8"));
  const decision = reviewChangeSet(payload, {
    expectedStackName: values['expected-stack-name'],
    expectedChangeSetName: values['expected-change-set-name'],
    expectedChangeSetArn: values['expected-change-set-arn'],
    expectedChangeSetType: values['expected-change-set-type'],
    expectedAccountId: values['expected-account-id'],
    expectedRegion: values['expected-region'],
    expectedHost: values['expected-host'],
    adminInfrastructureApproved: parseApproval(values['admin-infrastructure-approved']),
    adminRouteAssociationApproved: parseApproval(values['admin-route-association-approved']),
  });
  process.stdout.write(`${decision}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : "change_set_review_failed";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  ChangeSetReviewError,
  reviewChangeSet,
};
