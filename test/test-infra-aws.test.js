"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { bytes, digest } = require("./fixtures/thn-admin-selection");
const helperPath = path.join(__dirname, "..", "tools", "infra-test-aws.js");
const helper = fs.existsSync(helperPath) ? require(helperPath) : {};
const stackName = "ZoolandingTest-Zoolandingpage-test-Frontend";
const account = "123456789012";
const roles = Object.fromEntries(["lookup", "deploy"].map(kind => [kind, `arn:aws:iam::${account}:role/cdk-fixture1-${kind}-role-${account}-us-east-1`]));
const seals = Object.fromEntries(Object.entries(roles).map(([kind, arn]) => [kind, digest(arn)]));

function artifact(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "thn-cdk-chain-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const root = path.join(directory, ".release");
  const assemblyRoot = path.join(root, "cdk.out", "assembly-ZoolandingTest");
  fs.mkdirSync(assemblyRoot, { recursive: true });
  const metadata = { schema: "zoolanding-test-infra-release/v1", service: "zoolandingpage-aws-infra",
    source_sha: "c".repeat(40), run_id: "123", run_attempt: "1", expected_aws_account_id: account,
    expected_aws_region: "us-east-1", thn_admin_origin_enabled: "false", frontend_release_id: "public-fixture" };
  const assembly = { artifacts: { stack: { type: "aws:cloudformation:stack", properties: {
    stackName, templateFile: "test.template.json", lookupRole: { arn: roles.lookup }, assumeRoleArn: roles.deploy,
  } } } };
  fs.writeFileSync(path.join(root, "release-metadata.json"), bytes(metadata));
  fs.writeFileSync(path.join(root, "thn-admin-selection.json"), bytes(null));
  fs.writeFileSync(path.join(assemblyRoot, "manifest.json"), bytes(assembly));
  fs.writeFileSync(path.join(assemblyRoot, "test.template.json"), bytes({ Resources: {} }));
  const env = { EXPECTED_RELEASE_SOURCE_SHA: metadata.source_sha, EXPECTED_RELEASE_RUN_ID: metadata.run_id,
    EXPECTED_AWS_ACCOUNT_ID: account, EXPECTED_AWS_REGION: "us-east-1",
    AWS_ACCESS_KEY_ID: "PARENT", AWS_SECRET_ACCESS_KEY: "parent-fixture", AWS_SESSION_TOKEN: "parent-session",
    AWS_PROFILE: "parent-profile", AWS_WEB_IDENTITY_TOKEN_FILE: "parent-token-file" };
  function seal() {
    const files = [];
    function walk(directory, relative = "") { for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relativePath = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(directory, entry.name), relativePath); else files.push(relativePath);
    } }
    walk(root);
    const manifest = Buffer.from(files.sort().map(file => `${digest(fs.readFileSync(path.join(root, file)))}  ./${file}\n`).join(""));
    fs.writeFileSync(path.join(directory, "release-manifest.sha256"), manifest);
    env.EXPECTED_RELEASE_MANIFEST_SHA256 = digest(manifest);
  }
  seal();
  return { root, assemblyRoot, assembly, metadata, env, seal };
}

function assumeResponse(roleArn, sessionName) {
  return bytes({ Credentials: { AccessKeyId: `ASIA${"A".repeat(16)}`, SecretAccessKey: "fixture-secret-not-real".repeat(2),
    SessionToken: "fixture-session-not-real", Expiration: new Date(Date.now() + 850000).toISOString() },
    AssumedRoleUser: { Arn: `arn:aws:sts::${account}:assumed-role/${roleArn.split("/").at(-1)}/${sessionName}` } });
}

test("private admin Lambda read uses only the pinned TEST OIDC session and function", () => {
  const calls = [];
  const env = { AWS_REGION: "us-east-1", AWS_DEFAULT_REGION: "us-east-1",
    AWS_ACCESS_KEY_ID: `ASIA${"A".repeat(16)}`, AWS_SECRET_ACCESS_KEY: "fixture-secret-not-real",
    AWS_SESSION_TOKEN: "fixture-session-not-real" };
  const identity = { Account: "765932874577",
    Arn: "arn:aws:sts::765932874577:assumed-role/zoolandingpage-infra-test-github-oidc-deploy/GitHubActions" };
  const lambda = { FunctionName: "zoolandingpage-test-frontend-thn-admin-ssr",
    Environment: { Variables: { ZLP_RELEASE_ID: "fixture-release" } } };
  const result = helper.readPrivateLambdaConfiguration({ env, runAws: (args, passedEnv) => {
    calls.push(args);
    assert.equal(passedEnv, env);
    return bytes(args[0] === "sts" ? identity : lambda);
  } });
  assert.deepEqual(result, lambda);
  assert.deepEqual(calls, [
    ["sts", "get-caller-identity", "--output", "json"],
    ["lambda", "get-function-configuration", "--function-name",
      "zoolandingpage-test-frontend-thn-admin-ssr", "--output", "json"],
  ]);
});

test("private admin Lambda read requires temporary OIDC credentials before STS", () => {
  let calls = 0;
  assert.throws(() => helper.readPrivateLambdaConfiguration({
    env: { AWS_REGION: "us-east-1", AWS_DEFAULT_REGION: "us-east-1" },
    runAws: () => { calls++; return bytes({ Account: "765932874577",
      Arn: "arn:aws:sts::765932874577:assumed-role/zoolandingpage-infra-test-github-oidc-deploy/GitHubActions" }); },
  }), /private_release_oidc_identity_invalid/);
  assert.equal(calls, 0);
});

test("private admin Lambda read rejects another caller before reading Lambda", () => {
  const env = { AWS_REGION: "us-east-1", AWS_DEFAULT_REGION: "us-east-1",
    AWS_ACCESS_KEY_ID: `ASIA${"A".repeat(16)}`, AWS_SECRET_ACCESS_KEY: "fixture-secret-not-real",
    AWS_SESSION_TOKEN: "fixture-session-not-real" };
  const calls = [];
  assert.throws(() => helper.readPrivateLambdaConfiguration({ env, runAws: args => {
    calls.push(args[0]);
    return bytes({ Account: "765932874577",
      Arn: "arn:aws:sts::765932874577:assumed-role/cdk-hnb659fds-lookup-role-765932874577-us-east-1/session" });
  } }), /private_release_oidc_identity_invalid/);
  assert.deepEqual(calls, ["sts"]);
});

test("private admin Lambda read hides KMS error details and fails closed", () => {
  const env = { AWS_REGION: "us-east-1", AWS_DEFAULT_REGION: "us-east-1",
    AWS_ACCESS_KEY_ID: `ASIA${"A".repeat(16)}`, AWS_SECRET_ACCESS_KEY: "fixture-secret-not-real",
    AWS_SESSION_TOKEN: "fixture-session-not-real" };
  const identity = { Account: "765932874577",
    Arn: "arn:aws:sts::765932874577:assumed-role/zoolandingpage-infra-test-github-oidc-deploy/GitHubActions" };
  assert.throws(() => helper.readPrivateLambdaConfiguration({ env, runAws: args => bytes(args[0] === "sts"
    ? identity : { FunctionName: "zoolandingpage-test-frontend-thn-admin-ssr",
      Environment: { Error: { ErrorCode: "AccessDeniedException", Message: "private-sentinel" } } }) }),
  error => error.message === "private_release_lambda_read_invalid"
    && !error.message.includes("private-sentinel"));
});

test("private admin Lambda read rejects a different function and absent variables", () => {
  const env = { AWS_REGION: "us-east-1", AWS_DEFAULT_REGION: "us-east-1",
    AWS_ACCESS_KEY_ID: `ASIA${"A".repeat(16)}`, AWS_SECRET_ACCESS_KEY: "fixture-secret-not-real",
    AWS_SESSION_TOKEN: "fixture-session-not-real" };
  const identity = { Account: "765932874577",
    Arn: "arn:aws:sts::765932874577:assumed-role/zoolandingpage-infra-test-github-oidc-deploy/GitHubActions" };
  for (const response of [
    { FunctionName: "unrelated-function", Environment: { Variables: { KEY: "value" } } },
    { FunctionName: "zoolandingpage-test-frontend-thn-admin-ssr", Environment: {} },
  ]) {
    assert.throws(() => helper.readPrivateLambdaConfiguration({ env, runAws: args => bytes(args[0] === "sts"
      ? identity : response) }), /private_release_lambda_read_invalid/);
  }
});

test("private admin IAM read policy grants only the named TEST Lambda configuration", () => {
  const policy = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "tools",
    "thn-admin-private-lambda-read-policy.json"), "utf8"));
  assert.deepEqual(policy, { Version: "2012-10-17", Statement: [{
    Sid: "ReadThnAdminTestSsrConfiguration",
    Effect: "Allow",
    Action: "lambda:GetFunctionConfiguration",
    Resource: "arn:aws:lambda:us-east-1:765932874577:function:zoolandingpage-test-frontend-thn-admin-ssr",
  }] });
});

test("role chain authenticates independent artifact digest, source and exact TEST stack before STS", t => {
  assert.equal(typeof helper.loadArtifact, "function");
  const f = artifact(t);
  assert.equal(helper.loadArtifact(f.root, f.env).stack.properties.stackName, stackName);
  for (const env of [{ ...f.env, EXPECTED_RELEASE_MANIFEST_SHA256: "0".repeat(64) },
    { ...f.env, EXPECTED_RELEASE_SOURCE_SHA: "d".repeat(40) }, { ...f.env, EXPECTED_RELEASE_RUN_ID: "999" },
    { ...f.env, EXPECTED_AWS_ACCOUNT_ID: "999999999999" }]) {
    assert.throws(() => helper.loadArtifact(f.root, env), /test_infra_artifact_invalid/);
  }
  fs.appendFileSync(path.join(f.assemblyRoot, "test.template.json"), " ");
  assert.throws(() => helper.loadArtifact(f.root, f.env), /test_infra_artifact_invalid/);
  f.assembly.artifacts.stack.properties.stackName = "production";
  fs.writeFileSync(path.join(f.assemblyRoot, "manifest.json"), bytes(f.assembly)); f.seal();
  assert.throws(() => helper.loadArtifact(f.root, f.env), /test_infra_artifact_invalid/);
});

test("lookup credentials stay in child memory, preserve parent environment and cannot mutate", t => {
  assert.equal(typeof helper.createRoleClient, "function");
  const f = artifact(t);
  const parent = { ...f.env };
  const calls = [];
  const client = helper.createRoleClient(f.root, "lookup", { env: f.env, seals, runAws: (args, env) => {
    calls.push(args);
    if (args[0] === "sts") {
      assert.equal(env.AWS_ACCESS_KEY_ID, "PARENT");
      assert.equal(args[args.indexOf("--role-arn") + 1], roles.lookup);
      return assumeResponse(roles.lookup, args[args.indexOf("--role-session-name") + 1]);
    }
    assert.equal(env.AWS_ACCESS_KEY_ID, `ASIA${"A".repeat(16)}`);
    assert.equal(env.AWS_PROFILE, undefined);
    assert.equal(env.AWS_WEB_IDENTITY_TOKEN_FILE, undefined);
    assert.ok(!JSON.stringify(args).includes("fixture-secret-not-real"));
    return bytes({ Stacks: [{ StackName: stackName }] });
  } });
  client(["cloudformation", "describe-stacks", "--stack-name", stackName, "--output", "json"]);
  assert.deepEqual(f.env, parent);
  assert.equal(calls.length, 2);
  assert.throws(() => client(["cloudformation", "execute-change-set", "--stack-name", stackName]), /test_infra_operation_invalid/);
  assert.throws(() => client(["cloudformation", "describe-stacks", "--stack-name", "production"]), /test_infra_operation_invalid/);
  assert.equal(calls.length, 2);
});

test("query fence adds only pinned read and change-set cleanup commands", t => {
  const f = artifact(t);
  const name = "release-123-1";
  const arn = `arn:aws:cloudformation:us-east-1:${account}:changeSet/${name}/fixture`;
  const functionName = "zoolanding-test-admin-viewer";
  const outputPath = path.join(f.root, "live-function.js");
  const calls = [];
  const options = { env: f.env, seals, queryFence: { changeSetArn: arn, functionName, outputPath },
    runAws: args => {
      if (args[0] === "sts") return assumeResponse(roles.lookup, args[args.indexOf("--role-session-name") + 1]);
      calls.push(args.slice(0, 2).join(" "));
      return bytes({});
    } };
  const lookup = helper.createRoleClient(f.root, "lookup", options);
  lookup(["cloudfront", "describe-function", "--name", functionName, "--stage", "LIVE"]);
  lookup(["cloudfront", "get-function", "--name", functionName, "--stage", "LIVE", outputPath]);
  lookup(["cloudformation", "get-template", "--stack-name", stackName, "--change-set-name", arn,
    "--template-stage", "Original"]);
  assert.throws(() => lookup(["cloudfront", "get-function", "--name", "other", "--stage", "LIVE", outputPath]), /test_infra_operation_invalid/);
  assert.throws(() => lookup(["cloudformation", "get-template", "--stack-name", stackName,
    "--change-set-name", "other", "--template-stage", "Original"]), /test_infra_operation_invalid/);
  assert.throws(() => lookup(["cloudformation", "delete-change-set", "--stack-name", stackName,
    "--change-set-name", arn]), /test_infra_operation_invalid/);
  assert.deepEqual(calls, ["cloudfront describe-function", "cloudfront get-function", "cloudformation get-template"]);
  const deploy = helper.createRoleClient(f.root, "deploy", { ...options, runAws: args => {
    if (args[0] === "sts") return assumeResponse(roles.deploy, args[args.indexOf("--role-session-name") + 1]);
    calls.push(args.slice(0, 2).join(" "));
    return bytes({});
  } });
  assert.throws(() => deploy(["cloudformation", "execute-change-set", "--stack-name", stackName,
    "--change-set-name", "release-999-1"]), /test_infra_operation_invalid/);
  deploy(["cloudformation", "execute-change-set", "--stack-name", stackName, "--change-set-name", arn]);
  assert.equal(calls.at(-1), "cloudformation execute-change-set");
});

test("private rotation lookup permits exact admin DNS reads but no Lambda configuration", t => {
  const f = artifact(t);
  const zone = "ZTHNADMINTEST";
  f.metadata.thn_admin_hosted_zone_sha256 = digest(zone);
  fs.writeFileSync(path.join(f.root, "release-metadata.json"), bytes(f.metadata)); f.seal();
  const functionName = "zoolanding-test-admin-viewer";
  const lambdaName = "zoolanding-test-private-ssr";
  const options = { env: f.env, seals, queryFence: { functionName,
    outputPath: path.join(f.root, "live-function.js") }, privateRotation: { lambdaName, hostedZoneId: zone },
  runAws: args => args[0] === "sts" ? assumeResponse(roles.lookup, args[args.indexOf("--role-session-name") + 1]) : bytes({}) };
  const read = helper.createRoleClient(f.root, "lookup", options);
  assert.throws(() => read(["lambda", "get-function-configuration", "--function-name", lambdaName,
    "--output", "json"]), /test_infra_operation_invalid/);
  read(["route53", "list-resource-record-sets", "--hosted-zone-id", zone,
    "--start-record-name", "admin-test.thehairnarrative.com.", "--start-record-type", "A",
    "--max-items", "2", "--no-paginate", "--output", "json"]);
  assert.throws(() => read(["lambda", "get-function-configuration", "--function-name", "other"]),
    /test_infra_operation_invalid/);
  assert.throws(() => read(["lambda", "get-function-configuration", "--function-name", lambdaName,
    "--qualifier", "another-version", "--output", "json"]), /test_infra_operation_invalid/);
  assert.throws(() => read(["route53", "list-resource-record-sets", "--hosted-zone-id", zone,
    "--start-record-name", "example.com.", "--start-record-type", "A", "--max-items", "2", "--no-paginate"]),
  /test_infra_operation_invalid/);
});

test("swapped, unsealed, wrong-account, wrong-region and wrong-partition roles fail before STS", t => {
  assert.equal(typeof helper.createRoleClient, "function");
  for (const replacement of [roles.deploy, roles.lookup.replace("fixture1", "other"),
    roles.lookup.replaceAll(account, "999999999999"), roles.lookup.replaceAll("us-east-1", "us-west-2"),
    roles.lookup.replace("arn:aws:", "arn:aws-cn:")]) {
    const f = artifact(t);
    f.assembly.artifacts.stack.properties.lookupRole.arn = replacement;
    fs.writeFileSync(path.join(f.assemblyRoot, "manifest.json"), bytes(f.assembly)); f.seal();
    let calls = 0;
    assert.throws(() => helper.createRoleClient(f.root, "lookup", { env: f.env, seals,
      runAws: () => { calls++; throw new Error("unexpected assume"); } }), /test_infra_role_invalid/);
    assert.equal(calls, 0);
  }
});

test("denied trust and invalid STS responses fail generically without credential leakage", t => {
  assert.equal(typeof helper.createRoleClient, "function");
  const f = artifact(t);
  for (const result of [() => { throw new Error("AccessDenied fixture-secret-not-real"); }, () => bytes({}),
    () => assumeResponse(roles.deploy, "wrong-session")]) {
    assert.throws(() => helper.createRoleClient(f.root, "lookup", { env: f.env, seals, runAws: result }), error => {
      assert.equal(error.message, "test_infra_role_assumption_failed");
      assert.ok(!String(error).includes("fixture-secret-not-real"));
      return true;
    });
  }
});

test("exact change-set execution rechecks identity, review and artifact before mutation", t => {
  assert.equal(typeof helper.main, "function");
  const f = artifact(t);
  const name = "release-123-1";
  const arn = `arn:aws:cloudformation:us-east-1:${account}:changeSet/${name}/fixture`;
  const description = { StackName: stackName, StackId: `arn:aws:cloudformation:us-east-1:${account}:stack/${stackName}/fixture`,
    ChangeSetName: name, ChangeSetId: arn, Status: "CREATE_COMPLETE", ExecutionStatus: "AVAILABLE", Changes: [] };
  const calls = [];
  const runAws = args => {
    calls.push(args.slice(0, 2).join(" "));
    if (args[0] === "sts") return assumeResponse(roles.deploy, args[args.indexOf("--role-session-name") + 1]);
    if (args[1] === "describe-change-set") return bytes(description);
    return Buffer.from("");
  };
  const env = { ...f.env, ADMIN_INFRASTRUCTURE_APPROVED: "false", ADMIN_ROUTE_ASSOCIATION_APPROVED: "false" };
  const options = { env, seals, runAws, review: (value, expected) => {
    assert.equal(value.ChangeSetId, arn); assert.equal(expected.expectedChangeSetArn, arn); return "execute";
  } };
  helper.main(["execute-change-set", f.root, name, arn], options);
  assert.deepEqual(calls, ["sts assume-role", "cloudformation describe-change-set", "cloudformation execute-change-set"]);
  calls.length = 0;
  assert.throws(() => helper.main(["execute-change-set", f.root, name, arn.replace(account, "999999999999")], options), /test_infra_operation_invalid/);
  assert.equal(calls.length, 0);
  description.StackName = "production";
  assert.throws(() => helper.main(["execute-change-set", f.root, name, arn], options), /test_infra_change_set_identity_invalid/);
  assert.ok(!calls.includes("cloudformation execute-change-set"));
  description.StackName = stackName; calls.length = 0;
  assert.throws(() => helper.main(["execute-change-set", f.root, name, arn], { ...options, review: () => {
    fs.appendFileSync(path.join(f.assemblyRoot, "test.template.json"), " "); return "execute";
  } }), /test_infra_artifact_invalid/);
  assert.ok(!calls.includes("cloudformation execute-change-set"));
});

test("opaque admin evidence is retried only after an independent exact-origin proof", () => {
  assert.equal(typeof helper.reviewWithOriginProof, "function");
  const calls = [];
  const review = (_description, options) => {
    calls.push(options.adminOriginOnlyProof === true);
    if (!options.adminOriginOnlyProof) throw new Error("admin_change_evidence_missing");
    return "execute";
  };
  assert.equal(helper.reviewWithOriginProof({}, {}, review, () => true, () => { calls.push("complete-inventory"); }), "execute");
  assert.deepEqual(calls, [false, "complete-inventory", true]);
  calls.length = 0;
  assert.throws(() => helper.reviewWithOriginProof({}, {}, review, () => false, () => { throw new Error("unexpected"); }), /admin_change_evidence_missing/);
  assert.deepEqual(calls, [false]);
  assert.throws(() => helper.reviewWithOriginProof({}, {}, review, () => true,
    () => { throw new Error("admin_change_summary_invalid"); }), /admin_change_summary_invalid/);
  assert.throws(() => helper.reviewWithOriginProof({}, {}, () => { throw new Error("unrelated"); }, () => true,
    () => { throw new Error("unexpected"); }), /unrelated/);
});

test("opaque static rotation is re-reviewed with its complete summary before execution", () => {
  assert.equal(typeof helper.reviewWithAdminProof, "function");
  const calls = [];
  const review = (_description, options) => {
    calls.push(options.adminStaticRotationProof === true ? "static" : "ordinary");
    if (!options.adminStaticRotationProof) throw new Error("admin_change_evidence_missing");
    return "execute";
  };
  const decision = helper.reviewWithAdminProof({}, {}, review, () => "static-rotation", options => {
    assert.equal(options.adminStaticRotationProof, true);
    calls.push("summary");
  });
  assert.equal(decision, "execute");
  assert.deepEqual(calls, ["ordinary", "summary", "static"]);
  assert.throws(() => helper.reviewWithAdminProof({}, {}, review, () => "none", () => {
    throw new Error("unexpected summary");
  }), /admin_change_evidence_missing/);
});

test("summary description reads the same immutable change set without property-value filtering", t => {
  const f = artifact(t);
  const name = "release-123-1";
  const description = { StackName: stackName, StackId: `arn:aws:cloudformation:us-east-1:${account}:stack/${stackName}/fixture`,
    ChangeSetName: name, ChangeSetId: `arn:aws:cloudformation:us-east-1:${account}:changeSet/${name}/fixture`,
    Status: "CREATE_COMPLETE", ExecutionStatus: "AVAILABLE", Changes: [] };
  const calls = [];
  const result = helper.main(["describe-change-set-summary", f.root, name], { env: f.env, seals, runAws: args => {
    if (args[0] === "sts") return assumeResponse(roles.lookup, args[args.indexOf("--role-session-name") + 1]);
    calls.push(args);
    return bytes(description);
  } });
  assert.deepEqual(JSON.parse(result), description);
  assert.equal(calls.length, 1);
  assert.ok(!calls[0].includes("--include-property-values"));
});

test("public release drift remains blocked through the existing lookup chain", t => {
  assert.equal(typeof helper.main, "function");
  const f = artifact(t);
  const env = { ...f.env, ADMIN_INFRASTRUCTURE_APPROVED: "true", ADMIN_ROUTE_ASSOCIATION_APPROVED: "true" };
  const options = { env, seals, runAws: args => args[0] === "sts"
    ? assumeResponse(roles.lookup, args[args.indexOf("--role-session-name") + 1])
    : bytes({ Stacks: [{ StackName: stackName, Outputs: [{ OutputKey: "FrontendReleaseId", OutputValue: "different-release" }] }] }) };
  assert.throws(() => helper.main(["verify-public-release", f.root], options), /public_frontend_release_drift/);
  assert.throws(() => helper.main(["unrestricted-aws", f.root], options), /test_infra_operation_invalid/);
});
