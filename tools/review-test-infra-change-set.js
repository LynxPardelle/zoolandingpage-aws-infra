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
  [/^FrontendDistributionThehairnarrativeAdminTestOrigin1FunctionUrlOriginAccessControl[A-F0-9]+$/, "AWS::CloudFront::OriginAccessControl"],
];

const ADMIN_PRIVATE_SSR_RULES = [
  [/^FrontendThnAdminSsrFunction[A-F0-9]+$/, "AWS::Lambda::Function"],
  [/^FrontendThnAdminSsrFunctionFunctionUrl[A-F0-9]+$/, "AWS::Lambda::Url"],
  [/^FrontendThnAdminSsrFunctionServiceRole[A-F0-9]+$/, "AWS::IAM::Role"],
  [/^FrontendThnAdminSsrLogGroup[A-F0-9]+$/, "AWS::Logs::LogGroup"],
  [/^FrontendThnAdminSsrFunctionAllowCloudFrontInvokeFunction(?:Url)?ThehairnarrativeAdminTest[A-F0-9]+$/, "AWS::Lambda::Permission"],
];

const ADMIN_ROUTE_RULES = [
  [/^FrontendSsrFunction[A-F0-9]+$/, "AWS::Lambda::Function"],
  [/^FrontendSsrFunctionAllowCloudFrontInvokeFunction(?:Url)?ThehairnarrativeAdminTest[A-F0-9]+$/, "AWS::Lambda::Permission"],
  [/^FrontendDistributionThehairnarrativeAdminTest[A-Za-z0-9]+InvokeFromApiFor[A-Za-z0-9]+$/, "AWS::Lambda::Permission"],
];

const RETIRED_ADMIN_SHARED_PERMISSIONS = new Set([
  "FrontendSsrFunctionAllowCloudFrontInvokeFunctionThehairnarrativeAdminTest0899BBD5",
  "FrontendSsrFunctionAllowCloudFrontInvokeFunctionUrlThehairnarrativeAdminTest8C77CFB7",
]);

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

function isPrivateOriginPermissionReplacement(resource) {
  if (resource.Action !== "Modify" || resource.Replacement !== "True"
    || resource.LogicalResourceId !== "FrontendDistributionThehairnarrativeAdminTestOrigin1InvokeFromApiForZoolandingTestZoolandingpagetestFrontendFrontendDistributionThehairnarrativeAdminTestOrigin16C8F5824458F999C"
    || resource.ResourceType !== "AWS::Lambda::Permission") return false;
  let before, after;
  try {
    before = parseContext(resource.BeforeContext);
    after = parseContext(resource.AfterContext);
  } catch { return false; }
  const beforeProperties = before.Properties || before;
  const afterProperties = after.Properties || after;
  const symbolic = JSON.stringify(beforeProperties.FunctionName) === JSON.stringify({
    "Fn::GetAtt": ["FrontendSsrFunctionFunctionUrlD978E4C7", "FunctionArn"],
  }) && JSON.stringify(afterProperties.FunctionName) === JSON.stringify({
    "Fn::GetAtt": ["FrontendThnAdminSsrFunctionFunctionUrlA847D4A7", "FunctionArn"],
  });
  const oldArn = "arn:aws:lambda:us-east-1:765932874577:function:zoolandingpage-test-frontend-ssr";
  const pending = "{{changeSet:KNOWN_AFTER_APPLY}}";
  const nativeTarget = {
    Attribute: "Properties", Name: "FunctionName", RequiresRecreation: "Always",
    Path: "/Properties/FunctionName", BeforeValue: oldArn, AfterValue: pending,
    AttributeChangeType: "Modify",
  };
  const nativeDetails = resource.Details;
  const native = beforeProperties.FunctionName === oldArn && afterProperties.FunctionName === pending
    && JSON.stringify(resource.Scope) === JSON.stringify(["Properties"])
    && Array.isArray(nativeDetails) && nativeDetails.length === 2
    && nativeDetails.some(detail => detail.Evaluation === "Dynamic"
      && detail.ChangeSource === "DirectModification" && detail.CausingEntity == null
      && JSON.stringify(canonicalize(detail.Target)) === JSON.stringify(canonicalize(nativeTarget)))
    && nativeDetails.some(detail => detail.Evaluation === "Static"
      && detail.ChangeSource === "ResourceAttribute"
      && detail.CausingEntity === "FrontendThnAdminSsrFunctionFunctionUrlA847D4A7.FunctionArn"
      && JSON.stringify(canonicalize(detail.Target)) === JSON.stringify(canonicalize(nativeTarget)))
    && beforeProperties.SourceArn === "arn:aws:cloudfront::765932874577:distribution/E3FIRFPVARY6BX";
  if (!symbolic && !native) return false;
  const normalizedBefore = structuredClone(before);
  const normalizedAfter = structuredClone(after);
  (normalizedBefore.Properties || normalizedBefore).FunctionName = null;
  (normalizedAfter.Properties || normalizedAfter).FunctionName = null;
  return JSON.stringify(canonicalize(normalizedBefore)) === JSON.stringify(canonicalize(normalizedAfter))
    && beforeProperties.Action === "lambda:InvokeFunctionUrl"
    && beforeProperties.Principal === "cloudfront.amazonaws.com"
    && (native || JSON.stringify(beforeProperties.SourceArn || {}).includes("FrontendDistributionThehairnarrativeAdminTest5B029562"));
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

function isOpaquePrivateOriginUpdate(resource, changeCount) {
  if (changeCount !== 1 || resource.Action !== "Modify" || resource.Replacement !== "False"
    || resource.LogicalResourceId !== "FrontendDistributionThehairnarrativeAdminTest5B029562"
    || resource.ResourceType !== "AWS::CloudFront::Distribution"
    || JSON.stringify(resource.Scope) !== JSON.stringify(["Properties"])) return false;
  let before, after;
  try {
    before = parseContext(resource.BeforeContext);
    after = parseContext(resource.AfterContext);
  } catch { return false; }
  const path = "ZoolandingTest/Zoolandingpage-test-Frontend/FrontendDistributionThehairnarrativeAdminTest/Resource";
  const exactContext = value => JSON.stringify(Object.keys(value).sort()) === JSON.stringify(["Metadata", "Properties"])
    && JSON.stringify(Object.keys(value.Properties || {}).sort()) === JSON.stringify(["DistributionConfig", "Tags"])
    && value.Metadata?.["aws:cdk:path"] === path
    && typeof value.Properties.DistributionConfig === "string" && value.Properties.DistributionConfig.length > 0;
  if (!exactContext(before) || !exactContext(after)
    || before.Properties.DistributionConfig === after.Properties.DistributionConfig
    || JSON.stringify(canonicalize(before.Metadata)) !== JSON.stringify(canonicalize(after.Metadata))
    || JSON.stringify(canonicalize(before.Properties.Tags)) !== JSON.stringify(canonicalize(after.Properties.Tags))) return false;
  const detail = resource.Details?.[0], target = detail?.Target;
  return resource.Details?.length === 1 && detail.Evaluation === "Static"
    && detail.ChangeSource === "DirectModification" && target?.Attribute === "Properties"
    && target.Name === "DistributionConfig" && target.Path === "/Properties/DistributionConfig"
    && target.RequiresRecreation === "Never" && target.AttributeChangeType === "Modify"
    && target.BeforeValue === before.Properties.DistributionConfig
    && target.AfterValue === after.Properties.DistributionConfig;
}

function isOpaquePrivateStaticRotation(changes) {
  if (changes.length !== 2) return false;
  const expected = new Map([
    ["FrontendDistributionThehairnarrativeAdminTest5B029562", ["AWS::CloudFront::Distribution", "DistributionConfig",
      ["DistributionConfig", "Tags"]]],
    ["FrontendViewerHostHeaderFunctionThehairnarrativeAdminTestD75B90C2", ["AWS::CloudFront::Function", "FunctionCode",
      ["AutoPublish", "FunctionCode", "FunctionConfig", "Name", "Tags"]]],
  ]);
  const seen = new Set();
  for (const change of changes) {
    const resource = change?.ResourceChange;
    const id = resource?.LogicalResourceId;
    const profile = expected.get(id);
    if (!profile || seen.has(id) || resource.Action !== "Modify" || resource.Replacement !== "False"
      || resource.ResourceType !== profile[0] || JSON.stringify(resource.Scope) !== JSON.stringify(["Properties"])) return false;
    let before, after;
    try { before = parseContext(resource.BeforeContext); after = parseContext(resource.AfterContext); }
    catch { return false; }
    const path = `ZoolandingTest/Zoolandingpage-test-Frontend/${id.replace(/[A-F0-9]{8}$/, "")}/Resource`;
    const contextValid = value => JSON.stringify(Object.keys(value).sort()) === JSON.stringify(["Metadata", "Properties"])
      && JSON.stringify(Object.keys(value.Properties || {}).sort()) === JSON.stringify(profile[2])
      && value.Metadata?.["aws:cdk:path"] === path;
    const oldValue = before.Properties?.[profile[1]], newValue = after.Properties?.[profile[1]];
    const signature = /^\(Truncated-Signature\):[a-f0-9]{64}$/;
    const normalizedAfter = structuredClone(after);
    if (!contextValid(before) || !contextValid(after) || !signature.test(oldValue) || !signature.test(newValue)
      || oldValue === newValue) return false;
    normalizedAfter.Properties[profile[1]] = oldValue;
    if (JSON.stringify(canonicalize(before)) !== JSON.stringify(canonicalize(normalizedAfter))) return false;
    const detail = resource.Details?.[0], target = detail?.Target;
    if (resource.Details?.length !== 1 || detail.Evaluation !== "Static"
      || detail.ChangeSource !== "DirectModification" || target?.Attribute !== "Properties"
      || target.Name !== profile[1] || target.Path !== `/Properties/${profile[1]}`
      || target.RequiresRecreation !== "Never" || target.AttributeChangeType !== "Modify"
      || target.BeforeValue !== oldValue || target.AfterValue !== newValue) return false;
    seen.add(id);
  }
  return seen.size === expected.size;
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
    adminOriginOnlyProof = false,
    adminStaticRotationProof = false,
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
  if (adminOriginOnlyProof && adminStaticRotationProof) {
    throw new ChangeSetReviewError("admin_proof_mode_invalid");
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
  const staticRotationEvidence = adminMode && adminStaticRotationProof === true
    && isOpaquePrivateStaticRotation(changes);
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
    const retiredAdminPermission = adminMode && action === "Remove"
      && resourceType === "AWS::Lambda::Permission"
      && RETIRED_ADMIN_SHARED_PERMISSIONS.has(logicalId);
    const privateOriginPermissionReplacement = adminMode
      && isPrivateOriginPermissionReplacement(resource);

    if ((!['Add', 'Modify'].includes(action) && !retiredAdminPermission)
      || (![undefined, null, "False"].includes(replacement)
      && !(isCdkAnalyticsMetadata && replacement === "Conditional")
      && !privateOriginPermissionReplacement)) {
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
    const isPrivateSsr = matchesRule(logicalId, resourceType, ADMIN_PRIVATE_SSR_RULES);
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
      if (!isInfrastructure && !isPrivateSsr && !isRouteAssociation) {
        throw new ChangeSetReviewError("non_admin_resource_change_forbidden");
      }
      if (isPrivateSsr && action !== "Add") {
        throw new ChangeSetReviewError("private_ssr_change_forbidden");
      }
      if (isSharedSsrFunction) {
        if (action !== "Modify") {
          throw new ChangeSetReviewError("non_admin_resource_change_forbidden");
        }
        assertOnlyAdminHostMembershipChanged(resource);
      }
      adminSurfaceChanges += 1;
      exactHostEvidence ||= contextText.includes(EXACT_ADMIN_HOST)
        || adminHostMembershipChanged
        || (adminOriginOnlyProof === true && isOpaquePrivateOriginUpdate(resource, changes.length))
        || staticRotationEvidence;
    } else if (
      isInfrastructure
      || isPrivateSsr
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

function reviewCompleteChangeSet(detailed, summary, options) {
  const decision = reviewChangeSet(detailed, options);
  if (options?.adminStaticRotationProof === true) {
    const reject = () => { throw new ChangeSetReviewError("admin_change_summary_invalid"); };
    if (!summary || typeof summary !== "object" || Array.isArray(summary)
      || detailed.NextToken || summary.NextToken
      || ["StackId", "StackName", "ChangeSetId", "ChangeSetName", "Status", "ExecutionStatus"]
        .some(key => detailed[key] !== summary[key])
      || !Array.isArray(summary.Changes) || summary.Changes.length !== 4) reject();
    const distributionId = "FrontendDistributionThehairnarrativeAdminTest5B029562";
    const edgeId = "FrontendViewerHostHeaderFunctionThehairnarrativeAdminTestD75B90C2";
    // Without property values CloudFormation also reports references to the
    // unchanged distribution domain and the updated function ARN as dynamic.
    const expected = new Map([
      ["FrontendAliasUpsertThehairnarrativeAdminTestThehairnarrativeComD6748622",
        ["Custom::ZoolandingFrontendAliasRecords", "Conditional", ["Create", "Conditionally", `${distributionId}.DomainName`]]],
      ["FrontendDistributionDomainParameterThehairnarrativeAdminTest95A70218",
        ["AWS::SSM::Parameter", "False", ["Value", "Never", `${distributionId}.DomainName`]]],
      [distributionId, ["AWS::CloudFront::Distribution", "False", ["DistributionConfig", "Never", `${edgeId}.FunctionARN`]]],
      [edgeId, ["AWS::CloudFront::Function", "False", ["FunctionCode", "Never"]]],
    ]);
    const seen = new Set();
    for (const change of summary.Changes) {
      const resource = change?.ResourceChange;
      const profile = expected.get(resource?.LogicalResourceId);
      if (change?.Type !== "Resource" || !profile || seen.has(resource.LogicalResourceId)
        || resource.Action !== "Modify" || resource.ResourceType !== profile[0]
        || resource.Replacement !== profile[1] || JSON.stringify(resource.Scope) !== JSON.stringify(["Properties"])
        || resource.Details?.length !== (resource.LogicalResourceId === distributionId ? 2 : 1)) reject();
      const [name, recreation, cause] = profile[2];
      const details = resource.Details;
      const dynamic = resource.LogicalResourceId !== edgeId;
      if (resource.LogicalResourceId === distributionId) {
        const inherited = details.find(detail => detail.ChangeSource === "ResourceAttribute");
        const direct = details.find(detail => detail.ChangeSource === "DirectModification");
        if (!inherited || !direct || inherited.Evaluation !== "Dynamic" || direct.Evaluation !== "Dynamic"
          || inherited.CausingEntity !== cause || direct.CausingEntity != null
          || [inherited, direct].some(detail => detail.Target?.Attribute !== "Properties"
            || detail.Target.Name !== name || detail.Target.RequiresRecreation !== recreation
            || detail.Target.Path != null || detail.Target.AttributeChangeType != null)) reject();
      } else {
        const detail = details[0], target = detail.Target;
        if (detail.Evaluation !== (dynamic ? "Dynamic" : "Static")
          || detail.ChangeSource !== (dynamic ? "ResourceAttribute" : "DirectModification")
          || detail.CausingEntity !== cause || target?.Attribute !== "Properties"
          || target.Name !== name || target.RequiresRecreation !== recreation
          || (dynamic && (target.Path != null || target.AttributeChangeType != null))
          || (!dynamic && target.Path != null && target.Path !== `/Properties/${name}`)) reject();
      }
      seen.add(resource.LogicalResourceId);
    }
    if (seen.size !== expected.size) reject();
    return decision;
  }
  if (options?.adminOriginOnlyProof !== true) return decision;
  const reject = () => { throw new ChangeSetReviewError("admin_change_summary_invalid"); };
  if (!summary || typeof summary !== "object" || Array.isArray(summary)
    || detailed.NextToken || summary.NextToken
    || ["StackId", "StackName", "ChangeSetId", "ChangeSetName", "Status", "ExecutionStatus"]
      .some(key => detailed[key] !== summary[key])
    || !Array.isArray(summary.Changes) || summary.Changes.length !== 3) reject();
  const distributionId = "FrontendDistributionThehairnarrativeAdminTest5B029562";
  const expected = new Map([
    ["FrontendAliasUpsertThehairnarrativeAdminTestThehairnarrativeComD6748622",
      ["Custom::ZoolandingFrontendAliasRecords", "Conditional", "Dynamic", "ResourceAttribute", "Create", "Conditionally"]],
    ["FrontendDistributionDomainParameterThehairnarrativeAdminTest95A70218",
      ["AWS::SSM::Parameter", "False", "Dynamic", "ResourceAttribute", "Value", "Never"]],
    [distributionId, ["AWS::CloudFront::Distribution", "False", "Static", "DirectModification", "DistributionConfig", "Never"]],
  ]);
  const seen = new Set();
  for (const change of summary.Changes) {
    const resource = change?.ResourceChange;
    const id = resource?.LogicalResourceId;
    const profile = expected.get(id), detail = resource?.Details?.[0], target = detail?.Target;
    if (change?.Type !== "Resource" || !profile || seen.has(id)
      || resource.Action !== "Modify" || resource.ResourceType !== profile[0]
      || resource.Replacement !== profile[1] || JSON.stringify(resource.Scope) !== JSON.stringify(["Properties"])
      || resource.Details?.length !== 1 || detail.Evaluation !== profile[2]
      || detail.ChangeSource !== profile[3] || target?.Attribute !== "Properties"
      || target.Name !== profile[4] || target.RequiresRecreation !== profile[5]) reject();
    if (id === distributionId) {
      const detailedResource = detailed.Changes?.[0]?.ResourceChange;
      if (detailed.Changes?.length !== 1 || detailedResource?.LogicalResourceId !== id
        || detailedResource.Action !== resource.Action || detailedResource.Replacement !== resource.Replacement
        || detailedResource.ResourceType !== resource.ResourceType) reject();
    } else if (detail.CausingEntity !== `${distributionId}.DomainName`
      || target.Path != null || target.AttributeChangeType != null) reject();
    seen.add(id);
  }
  if (seen.size !== expected.size) reject();
  return decision;
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
  const reviewOptions = {
    expectedStackName: values['expected-stack-name'],
    expectedChangeSetName: values['expected-change-set-name'],
    expectedChangeSetArn: values['expected-change-set-arn'],
    expectedChangeSetType: values['expected-change-set-type'],
    expectedAccountId: values['expected-account-id'],
    expectedRegion: values['expected-region'],
    expectedHost: values['expected-host'],
    adminInfrastructureApproved: parseApproval(values['admin-infrastructure-approved']),
    adminRouteAssociationApproved: parseApproval(values['admin-route-association-approved']),
    adminOriginOnlyProof: values['admin-origin-only-proof'] === undefined ? false : parseApproval(values['admin-origin-only-proof']),
    adminStaticRotationProof: values['admin-static-rotation-proof'] === undefined ? false : parseApproval(values['admin-static-rotation-proof']),
  };
  const summaryPath = values['summary-description-path'];
  if ((reviewOptions.adminOriginOnlyProof || reviewOptions.adminStaticRotationProof) && !summaryPath) {
    throw new ChangeSetReviewError("admin_change_summary_invalid");
  }
  const summary = summaryPath ? JSON.parse(fs.readFileSync(summaryPath, "utf8")) : undefined;
  const decision = reviewCompleteChangeSet(payload, summary, reviewOptions);
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
  reviewCompleteChangeSet,
};
