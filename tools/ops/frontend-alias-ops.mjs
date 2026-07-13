#!/usr/bin/env node
"use strict";

const { execFileSync } = await import("node:child_process");
const { mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { fileURLToPath } = await import("node:url");

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const environmentModule = await import(
  new URL("../../config/environments.js", import.meta.url)
);
const { environments, hostedZones, retiredZoolandingpageComMxAliases } =
  environmentModule.default || environmentModule;

const cleanupConfirmation = "remove-retired-zoolandingpage-aliases";
const retiredAliases = retiredZoolandingpageComMxAliases;

const args = parseArgs(process.argv.slice(2));
const applyCleanup = args.applyCleanup === "true";
const runConflictPreflight = args.preflightCustomAliases !== "false";

if (applyCleanup && args.confirmCleanup !== cleanupConfirmation) {
  fail(`--confirm-cleanup must be ${cleanupConfirmation} when --apply-cleanup=true`);
}

console.log(`mode=${applyCleanup ? "apply" : "dry-run"}`);
console.log(`repoRoot=${repoRoot}`);
console.log(`retiredAliases=${retiredAliases.join(",")}`);

const modeledRetiredAliases = findModeledRetiredAliases();
if (modeledRetiredAliases.length > 0) {
  fail(`Retired aliases are still modeled in production front doors: ${modeledRetiredAliases.join(", ")}`);
}
console.log("config.retiredAliasesModeled=false");

await auditAndMaybeRemoveRoute53Records();
await auditAndMaybeRemoveCloudFrontAliases();

if (runConflictPreflight) {
  await auditCustomAliasConflicts();
}

function parseArgs(rawArgs) {
  const parsed = {};
  for (const arg of rawArgs) {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (!match) {
      fail(`Unsupported argument: ${arg}`);
    }
    const key = match[1].replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    parsed[key] = match[2];
  }
  return parsed;
}

function aws(args, options = {}) {
  const output = execFileSync("aws", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  return output.trim();
}

function awsJson(args) {
  const output = aws([...args, "--output", "json"]);
  return output ? JSON.parse(output) : {};
}

function tryAwsJson(args) {
  try {
    return { ok: true, data: awsJson(args) };
  } catch (error) {
    return {
      ok: false,
      error,
      message: `${error.stderr || error.message || error}`,
    };
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function normalizeRecordName(domainName) {
  return domainName.endsWith(".") ? domainName : `${domainName}.`;
}

function findModeledRetiredAliases() {
  const production = environments.find((environment) => environment.name === "production");
  const frontDoors = production?.frontendHosting?.frontDoors || [];
  const configured = new Set(
    frontDoors
      .flatMap((frontDoor) => [
        frontDoor.domainName,
        ...(frontDoor.alternateDomainNames || []),
        ...(frontDoor.aliasRecordGroups || []).flatMap((group) => group.domainNames || []),
      ])
      .filter(Boolean)
  );
  return retiredAliases.filter((domainName) => configured.has(domainName));
}

async function auditAndMaybeRemoveRoute53Records() {
  const hostedZoneId = hostedZones.zoolandingpageComMx.hostedZoneId;
  const retiredRecordNames = new Set(retiredAliases.map(normalizeRecordName));
  const recordSets = awsJson([
    "route53",
    "list-resource-record-sets",
    "--hosted-zone-id",
    hostedZoneId,
  ]).ResourceRecordSets || [];
  const matches = recordSets.filter(
    (recordSet) =>
      retiredRecordNames.has(recordSet.Name) &&
      recordSet.Type !== "NS" &&
      recordSet.Type !== "SOA"
  );

  console.log(`route53.retiredRecordSetCount=${matches.length}`);
  for (const recordSet of matches) {
    console.log(`route53.retiredRecordSet=${recordSet.Name} ${recordSet.Type}`);
  }

  if (!applyCleanup || matches.length === 0) {
    return;
  }

  const changeBatch = {
    Comment: "Remove retired Zoolandingpage aliases during EC2 to serverless frontend migration.",
    Changes: matches.map((recordSet) => ({
      Action: "DELETE",
      ResourceRecordSet: recordSet,
    })),
  };
  const tempDir = mkdtempSync(join(tmpdir(), "zlp-route53-cleanup-"));
  const changeBatchPath = join(tempDir, "change-batch.json");
  try {
    writeFileSync(changeBatchPath, JSON.stringify(changeBatch, null, 2));
    const result = awsJson([
      "route53",
      "change-resource-record-sets",
      "--hosted-zone-id",
      hostedZoneId,
      "--change-batch",
      `file://${changeBatchPath}`,
    ]);
    const changeId = result.ChangeInfo?.Id || "";
    console.log(`route53.cleanupChangeId=${changeId || "unknown"}`);
    console.log(`route53.cleanupStatus=${result.ChangeInfo?.Status || "unknown"}`);
    if (changeId) {
      aws(["route53", "wait", "resource-record-sets-changed", "--id", changeId]);
      console.log("route53.cleanupWait=INSYNC");
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function auditAndMaybeRemoveCloudFrontAliases() {
  const distributions = awsJson(["cloudfront", "list-distributions"]).DistributionList?.Items || [];
  const retiredAliasSet = new Set(retiredAliases);
  const matches = distributions.flatMap((distribution) =>
    (distribution.Aliases?.Items || [])
      .filter((alias) => retiredAliasSet.has(alias))
      .map((alias) => ({
        id: distribution.Id,
        domainName: distribution.DomainName,
        status: distribution.Status,
        alias,
      }))
  );

  console.log(`cloudfront.retiredAliasCount=${matches.length}`);
  for (const match of matches) {
    console.log(`cloudfront.retiredAlias=${match.alias} distribution=${match.id} domain=${match.domainName} status=${match.status}`);
  }

  if (!applyCleanup || matches.length === 0) {
    return;
  }

  for (const distributionId of [...new Set(matches.map((match) => match.id))]) {
    const details = awsJson(["cloudfront", "get-distribution-config", "--id", distributionId]);
    const config = details.DistributionConfig;
    const originalAliases = config.Aliases?.Items || [];
    const remainingAliases = originalAliases.filter((alias) => !retiredAliasSet.has(alias));
    config.Aliases = { Quantity: remainingAliases.length };
    if (remainingAliases.length > 0) {
      config.Aliases.Items = remainingAliases;
    }
    const tempDir = mkdtempSync(join(tmpdir(), "zlp-cf-cleanup-"));
    const configPath = join(tempDir, "distribution-config.json");
    try {
      writeFileSync(configPath, JSON.stringify(config, null, 2));
      const result = awsJson([
        "cloudfront",
        "update-distribution",
        "--id",
        distributionId,
        "--if-match",
        details.ETag,
        "--distribution-config",
        `file://${configPath}`,
      ]);
      console.log(`cloudfront.cleanupDistribution=${distributionId} status=${result.Distribution?.Status || "unknown"}`);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

async function auditCustomAliasConflicts() {
  const production = environments.find((environment) => environment.name === "production");
  const frontDoors = production?.frontendHosting?.frontDoors || [];
  const distributions = awsJson(["cloudfront", "list-distributions"]).DistributionList?.Items || [];
  const distributionByComment = new Map(
    distributions.map((distribution) => [distribution.Comment || "", distribution])
  );
  const aliasOwners = new Map();
  for (const distribution of distributions) {
    for (const alias of distribution.Aliases?.Items || []) {
      const owners = aliasOwners.get(alias) || [];
      owners.push(distribution);
      aliasOwners.set(alias, owners);
    }
  }

  console.log("cloudfront.customAliasPreflight=start");
  let sameAccountConflictCount = 0;
  for (const frontDoor of frontDoors) {
    const comment = `Zoolandingpage Angular SSR frontend (production/${frontDoor.id || "default"})`;
    const distribution = distributionByComment.get(comment);
    const domainNames = [frontDoor.domainName, ...(frontDoor.alternateDomainNames || [])].filter(Boolean);
    if (!distribution) {
      console.log(`cloudfront.customAliasPreflightMissingDistribution=${frontDoor.id || frontDoor.domainName}`);
      continue;
    }
    for (const domainName of domainNames) {
      const sameAccountConflicts = (aliasOwners.get(domainName) || []).filter(
        (ownerDistribution) => ownerDistribution.Id !== distribution.Id
      );
      for (const sameAccountConflict of sameAccountConflicts) {
        sameAccountConflictCount += 1;
        console.log(
          `cloudfront.customAliasSameAccountConflict alias=${domainName} target=${distribution.Id} conflictingDistribution=${sameAccountConflict.Id} conflictingDomain=${sameAccountConflict.DomainName}`
        );
      }
      if (distribution.ViewerCertificate?.CloudFrontDefaultCertificate === true) {
        console.log(
          `cloudfront.customAliasConflictSkipped alias=${domainName} target=${distribution.Id} reason=target-distribution-has-default-certificate`
        );
        continue;
      }
      const conflictResult = tryAwsJson([
        "cloudfront",
        "list-conflicting-aliases",
        "--distribution-id",
        distribution.Id,
        "--alias",
        domainName,
      ]);
      if (!conflictResult.ok) {
        if (conflictResult.message.includes("must attach a trusted certificate")) {
          console.log(
            `cloudfront.customAliasConflictSkipped alias=${domainName} target=${distribution.Id} reason=target-distribution-needs-trusted-certificate`
          );
          continue;
        }
        throw conflictResult.error;
      }
      const conflicts = conflictResult.data.ConflictingAliasesList;
      const quantity = conflicts?.Quantity || 0;
      console.log(`cloudfront.customAliasConflict alias=${domainName} target=${distribution.Id} quantity=${quantity}`);
      for (const item of conflicts?.Items || []) {
        console.log(
          `cloudfront.customAliasConflictItem alias=${domainName} conflictingAlias=${item.Alias} distribution=${item.DistributionId} account=${item.AccountId}`
        );
      }
    }
  }
  if (sameAccountConflictCount > 0) {
    fail(`Found ${sameAccountConflictCount} same-account CloudFront alias conflict(s).`);
  }
  console.log("cloudfront.customAliasPreflight=end");
}
