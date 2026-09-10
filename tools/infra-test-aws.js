"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { spawnSync } = require("node:child_process");

const STACK = "ZoolandingTest-Zoolandingpage-test-Frontend";
const REGION = "us-east-1";
// Seals of the existing, read-verified bootstrap targets. No role ARN input is
// accepted. A bootstrap trust/qualifier migration requires a reviewed code change.
const ROLE_SEALS = Object.freeze({
  lookup: "bdc228c3c0a205c9a4355574226e73095d49c8de62039674dfc799837f71f8aa",
  deploy: "917c31a7831123c4b704b7baab6c6ada06add02fe1eb682e2573423877074ab0",
});
const digest = value => createHash("sha256").update(value).digest("hex");
const fail = code => { throw new Error(code); };

function loadArtifact(releaseRoot, env = process.env) {
  try {
    if (!/^[a-f0-9]{64}$/.test(env.EXPECTED_RELEASE_MANIFEST_SHA256)
      || !/^[a-f0-9]{40}$/.test(env.EXPECTED_RELEASE_SOURCE_SHA)
      || !/^[1-9][0-9]*$/.test(env.EXPECTED_RELEASE_RUN_ID)
      || !/^[0-9]{12}$/.test(env.EXPECTED_AWS_ACCOUNT_ID) || env.EXPECTED_AWS_REGION !== REGION) throw new Error();
    const root = path.resolve(releaseRoot);
    if (!fs.lstatSync(root).isDirectory() || fs.lstatSync(root).isSymbolicLink()) throw new Error();
    const manifest = fs.readFileSync(path.join(root, "..", "release-manifest.sha256"));
    if (digest(manifest) !== env.EXPECTED_RELEASE_MANIFEST_SHA256) throw new Error();
    const files = [];
    function walk(directory, relative = "") {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const name = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isSymbolicLink() || !/^[A-Za-z0-9._/-]+$/.test(name)
          || name.split("/").some(segment => segment === "." || segment === "..")) throw new Error();
        if (entry.isDirectory()) walk(path.join(directory, entry.name), name);
        else if (entry.isFile()) files.push(name); else throw new Error();
      }
    }
    walk(root);
    const expected = Buffer.from(files.sort().map(file => `${digest(fs.readFileSync(path.join(root, file)))}  ./${file}\n`).join(""));
    if (!expected.equals(manifest)) throw new Error();
    const metadata = JSON.parse(fs.readFileSync(path.join(root, "release-metadata.json")));
    if (metadata.schema !== "zoolanding-test-infra-release/v1" || metadata.service !== "zoolandingpage-aws-infra"
      || metadata.source_sha !== env.EXPECTED_RELEASE_SOURCE_SHA || metadata.run_id !== env.EXPECTED_RELEASE_RUN_ID
      || metadata.expected_aws_account_id !== env.EXPECTED_AWS_ACCOUNT_ID || metadata.expected_aws_region !== REGION
      || !/^[1-9][0-9]*$/.test(metadata.run_attempt) || !["true", "false"].includes(metadata.thn_admin_origin_enabled)) throw new Error();
    const assemblyRoot = path.join(root, "cdk.out", "assembly-ZoolandingTest");
    const assembly = JSON.parse(fs.readFileSync(path.join(assemblyRoot, "manifest.json")));
    const stacks = Object.values(assembly.artifacts || {}).filter(item => item.type === "aws:cloudformation:stack" && item.properties?.stackName === STACK);
    if (stacks.length !== 1 || !/^[A-Za-z0-9_-]+\.template\.json$/.test(stacks[0].properties.templateFile)) throw new Error();
    return { root, metadata, assembly, assemblyRoot, stack: stacks[0] };
  } catch { fail("test_infra_artifact_invalid"); }
}

function runAws(args, env) {
  const waiter = args[1] === "wait";
  const result = spawnSync("aws", [...args, "--region", REGION], {
    env: { ...env, AWS_PAGER: "" }, maxBuffer: 4 * 1024 * 1024, timeout: waiter ? 1800000 : 30000,
  });
  if (result.error || result.status !== 0) fail("test_infra_aws_operation_failed");
  return result.stdout;
}

function validChangeSetName(value) { return /^(release|rollback)-[1-9][0-9]*-[1-9][0-9]*$/.test(value); }
function validChangeSetArn(value, account, name) {
  return typeof value === "string" && validChangeSetName(name)
    && new RegExp(`^arn:aws:cloudformation:${REGION}:${account}:changeSet/${name}/[A-Za-z0-9-]+$`).test(value);
}

function createRoleClient(releaseRoot, kind, options = {}) {
  const env = options.env || process.env;
  const call = options.runAws || runAws;
  const seals = options.seals || ROLE_SEALS;
  const artifact = loadArtifact(releaseRoot, env);
  const account = artifact.metadata.expected_aws_account_id;
  const rawArn = kind === "lookup" ? artifact.stack.properties.lookupRole?.arn : kind === "deploy" ? artifact.stack.properties.assumeRoleArn : null;
  const arn = typeof rawArn === "string" ? rawArn.replaceAll("${AWS::Partition}", "aws") : "";
  if (!["lookup", "deploy"].includes(kind) || !new RegExp(`^arn:aws:iam::${account}:role/cdk-[a-z0-9]+-${kind}-role-${account}-${REGION}$`).test(arn)
    || digest(arn) !== seals[kind]) fail("test_infra_role_invalid");
  const sessionName = `thn-test-${kind}-${artifact.metadata.run_id}-${artifact.metadata.run_attempt}`;
  let childEnv;
  try {
    const response = JSON.parse(call(["sts", "assume-role", "--role-arn", arn, "--role-session-name", sessionName,
      "--duration-seconds", "3600", "--output", "json"], env));
    const credentials = response.Credentials;
    const expectedPrincipal = `arn:aws:sts::${account}:assumed-role/${arn.split("/").at(-1)}/${sessionName}`;
    const expiration = Date.parse(credentials?.Expiration);
    if (response.AssumedRoleUser?.Arn !== expectedPrincipal || !/^ASIA[A-Z0-9]{16}$/.test(credentials?.AccessKeyId)
      || typeof credentials.SecretAccessKey !== "string" || credentials.SecretAccessKey.length < 20
      || typeof credentials.SessionToken !== "string" || credentials.SessionToken.length < 1
      || !Number.isFinite(expiration) || expiration <= Date.now() || expiration > Date.now() + 3600000) throw new Error();
    childEnv = { ...env, AWS_ACCESS_KEY_ID: credentials.AccessKeyId, AWS_SECRET_ACCESS_KEY: credentials.SecretAccessKey,
      AWS_SESSION_TOKEN: credentials.SessionToken, AWS_REGION: REGION, AWS_DEFAULT_REGION: REGION };
    for (const key of ["AWS_PROFILE", "AWS_DEFAULT_PROFILE", "AWS_WEB_IDENTITY_TOKEN_FILE", "AWS_ROLE_ARN", "AWS_ROLE_SESSION_NAME"]) delete childEnv[key];
  } catch { fail("test_infra_role_assumption_failed"); }

  return args => {
    const operation = args.slice(0, 2).join(" ");
    const value = flag => args[args.indexOf(flag) + 1];
    const lookup = new Set(["cloudformation describe-stacks", "cloudformation describe-change-set", "cloudformation list-stack-resources",
      "cloudformation get-template", "cloudformation describe-stack-resource",
      "acm describe-certificate", "s3 cp", "cloudfront get-distribution-config", "cloudfront wait"]);
    const deploy = new Set(["cloudformation describe-change-set", "cloudformation execute-change-set", "cloudformation wait"]);
    if (!(kind === "lookup" ? lookup : deploy).has(operation) || args.includes("--profile") || args.includes("--endpoint-url")) fail("test_infra_operation_invalid");
    if (args[0] === "cloudformation" && value("--stack-name") !== STACK) fail("test_infra_operation_invalid");
    if (operation === "cloudformation get-template" && (value("--template-stage") !== "Original" || args.includes("--change-set-name"))) fail("test_infra_operation_invalid");
    if (operation === "cloudformation describe-stack-resource" && value("--logical-resource-id") !== "ThnAdminTestCertificate") fail("test_infra_operation_invalid");
    if (operation === "cloudformation wait" && args[2] !== "stack-update-complete") fail("test_infra_operation_invalid");
    if (operation.endsWith("change-set")) {
      const coordinate = value("--change-set-name");
      const name = coordinate?.startsWith("arn:") ? coordinate.split("/")[1] : coordinate;
      if (!validChangeSetName(name) || (coordinate.startsWith("arn:") && !validChangeSetArn(coordinate, account, name))) fail("test_infra_operation_invalid");
    }
    if (operation === "acm describe-certificate" && (digest(value("--certificate-arn") || "") !== artifact.metadata.thn_admin_certificate_sha256
      || !new RegExp(`^arn:aws:acm:${REGION}:${account}:certificate/[A-Za-z0-9-]+$`).test(value("--certificate-arn")))) fail("test_infra_operation_invalid");
    if (operation === "s3 cp") {
      const selection = JSON.parse(fs.readFileSync(path.join(artifact.root, "thn-admin-selection.json")));
      const prefix = `s3://zoolandingpage-test-frontend-artifacts-${account}/${selection?.originPrefix}/`;
      if (args[3] !== "-" || !args[2]?.startsWith(prefix)
        || !["manifest.json", "delivery.json", "thn-admin-release.json", "thn-route-manifest.json"].includes(args[2].slice(prefix.length))) fail("test_infra_operation_invalid");
    }
    if (args[0] === "cloudfront" && (!/^[A-Z0-9]+$/.test(value("--id")) || (args[1] === "wait" && args[2] !== "distribution-deployed"))) fail("test_infra_operation_invalid");
    // Authenticate the same independent artifact again at the mutation boundary.
    if (operation === "cloudformation execute-change-set") loadArtifact(releaseRoot, env);
    try { return call(args, childEnv); } catch { fail("test_infra_aws_operation_failed"); }
  };
}

function validateChangeSetIdentity(description, account, name, arn) {
  if (description.StackName !== STACK || description.ChangeSetName !== name
    || !new RegExp(`^arn:aws:cloudformation:${REGION}:${account}:stack/${STACK}/[A-Za-z0-9-]+$`).test(description.StackId)
    || !validChangeSetArn(description.ChangeSetId, account, name)
    || (arn && description.ChangeSetId !== arn)) fail("test_infra_change_set_identity_invalid");
}

function main(args, options = {}) {
  const [operation, root, changeSetName, changeSetArn] = args;
  const counts = { "verify-public-release": 2, "describe-change-set": 3, "execute-change-set": 4, "wait-stack": 2, smoke: 2 };
  if (args.length !== counts[operation]) fail("test_infra_operation_invalid");
  const env = options.env || process.env;
  const artifact = loadArtifact(root, env);
  const account = artifact.metadata.expected_aws_account_id;
  if (operation.includes("change-set") && (!validChangeSetName(changeSetName)
    || (operation === "execute-change-set" && !validChangeSetArn(changeSetArn, account, changeSetName)))) fail("test_infra_operation_invalid");
  if (operation === "execute-change-set" && (!["true", "false"].includes(env.ADMIN_INFRASTRUCTURE_APPROVED)
    || env.ADMIN_INFRASTRUCTURE_APPROVED !== env.ADMIN_ROUTE_ASSOCIATION_APPROVED)) fail("test_infra_operation_invalid");
  const mode = ["execute-change-set", "wait-stack"].includes(operation) ? "deploy" : "lookup";
  const client = createRoleClient(root, mode, options);
  if (operation.includes("change-set")) {
    const response = client(["cloudformation", "describe-change-set", "--stack-name", STACK,
      "--change-set-name", changeSetArn || changeSetName, "--include-property-values", "--output", "json"]);
    const description = JSON.parse(response);
    validateChangeSetIdentity(description, account, changeSetName, changeSetArn);
    if (operation === "describe-change-set") return response;
    if (!["true", "false"].includes(env.ADMIN_INFRASTRUCTURE_APPROVED)
      || !["true", "false"].includes(env.ADMIN_ROUTE_ASSOCIATION_APPROVED)) fail("test_infra_operation_invalid");
    const review = options.review || require("./review-test-infra-change-set").reviewChangeSet;
    const decision = review(description, { expectedStackName: STACK, expectedChangeSetName: changeSetName,
      expectedChangeSetArn: changeSetArn, expectedChangeSetType: "UPDATE", expectedAccountId: account, expectedRegion: REGION,
      adminInfrastructureApproved: env.ADMIN_INFRASTRUCTURE_APPROVED === "true",
      adminRouteAssociationApproved: env.ADMIN_ROUTE_ASSOCIATION_APPROVED === "true" });
    if (decision !== "execute") fail("test_infra_execution_not_approved");
    client(["cloudformation", "execute-change-set", "--stack-name", STACK, "--change-set-name", changeSetArn]);
    return;
  }
  if (operation === "wait-stack") {
    client(["cloudformation", "wait", "stack-update-complete", "--stack-name", STACK]);
    return;
  }
  const stacks = JSON.parse(client(["cloudformation", "describe-stacks", "--stack-name", STACK, "--output", "json"])).Stacks;
  if (stacks?.length !== 1 || stacks[0].StackName !== STACK) fail("test_infra_stack_invalid");
  if (operation === "verify-public-release") {
    const releases = (stacks[0].Outputs || []).filter(item => item.OutputKey === "FrontendReleaseId");
    if (releases.length !== 1 || !artifact.metadata.frontend_release_id
      || releases[0].OutputValue !== artifact.metadata.frontend_release_id) fail("public_frontend_release_drift");
    return;
  }
  if (!["CREATE_COMPLETE", "UPDATE_COMPLETE"].includes(stacks[0].StackStatus)) fail("test_stack_not_ready");
  if (env.ADMIN_INFRASTRUCTURE_APPROVED === "true") {
    if (artifact.metadata.thn_admin_origin_enabled !== "true") fail("test_infra_operation_invalid");
    const resources = JSON.parse(client(["cloudformation", "list-stack-resources", "--stack-name", STACK, "--output", "json"]));
    const distributions = (resources.StackResourceSummaries || []).filter(item => item.ResourceType === "AWS::CloudFront::Distribution"
      && item.LogicalResourceId.includes("ThehairnarrativeAdminTest"));
    if (distributions.length !== 1 || !/^[A-Z0-9]+$/.test(distributions[0].PhysicalResourceId)) fail("test_admin_distribution_invalid");
    const id = distributions[0].PhysicalResourceId;
    client(["cloudfront", "wait", "distribution-deployed", "--id", id]);
    const distribution = JSON.parse(client(["cloudfront", "get-distribution-config", "--id", id, "--output", "json"]));
    if (JSON.stringify(distribution.DistributionConfig?.Aliases?.Items) !== JSON.stringify(["admin-test.thehairnarrative.com"])) fail("test_admin_distribution_invalid");
  }
}

if (require.main === module) {
  try { const result = main(process.argv.slice(2)); if (result) process.stdout.write(result); }
  catch { process.stderr.write("test_infra_aws_guard_failed\n"); process.exitCode = 1; }
}
module.exports = { loadArtifact, createRoleClient, validChangeSetArn, validChangeSetName, main };
