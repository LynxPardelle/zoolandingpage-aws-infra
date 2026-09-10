"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const REGION = "us-east-1", HOST = "admin-test.thehairnarrative.com", DOMAIN = "thehairnarrative.com";
const HUMAN_PARAMETER = "ThnTestHumanOperatorPrincipalArn";
const OPERATIONS = Object.freeze({
  certificate: { stack: "ZoolandingTest-Zoolandingpage-test-Frontend", logical: "ThnAdminTestCertificate", type: "AWS::CertificateManager::Certificate" },
  "operator-role": { stack: "ZoolandingTest-Zoolandingpage-test-ServiceRepositoryBootstrap", logical: "ThnTestHumanOperatorRole", type: "AWS::IAM::Role" },
});
// Independent read-only anchors. No raw human principal is accepted as a public input.
const ANCHORS = Object.freeze({
  account: "3e19eeb25ac142d015c5a4d347dc58784b0a79a124f1353b5e92d90673810a8f",
  principal: "7f71e6c38aa02311a19567bf29585c5fd05ab8f08085700a46f8623a3bb596f7",
  zone: "4ae31fe900c3ab3c6e745fc9dbd8a94d0ffcfbf1bcdb10bd357c5d8111d6d55e",
  stacks: { certificate: "4fa6d31ee52124ea6dc21e58942cd724d4737054ce423ccae90302c650d93e87",
    "operator-role": "cfccbd3d73380d8df08b895eb571e72a7f7ed88dfe9ace7f353a5c3558a21e60" },
  lookup: "bdc228c3c0a205c9a4355574226e73095d49c8de62039674dfc799837f71f8aa",
  deploy: "917c31a7831123c4b704b7baab6c6ada06add02fe1eb682e2573423877074ab0",
  publisher: "a26d1378d23edf249b763d46c507a31bcfddfa450388762e25d1cec8ed35928e",
  cfn: "740e24b7b58c842319111818f6285e3a9653e8350368f53e6514df3162b8964d",
  bucket: "dc0ec3c3b1ed41b045a8ac18f8738d91948f09c6c9d06fd463f5cf66ace4bff3",
  kmsKey: "eca48ab275d9eec59f46235a548858df944263d1f7e6e25d68316ad530b17ca4",
  bucketPolicy: "2f4a0fac77d63c7b58948a03affe620377d6fa64c4bda8a7116f0206f1e17e20",
});
const fail = () => { throw new Error("thn_prerequisite_guard_failed"); };
const sha = value => createHash("sha256").update(value).digest("hex");
const isSha = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const canonical = value => JSON.stringify(stable(value));
const same = (left, right) => canonical(left) === canonical(right);
const object = value => value && typeof value === "object" && !Array.isArray(value);
const keys = (value, expected) => object(value) && same(Object.keys(value).sort(), [...expected].sort());
const jsonBytes = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);

function validateLedger(raw, externalSha256, config) {
  try {
    if (!Buffer.isBuffer(raw) || raw.length > 8192 || !isSha(externalSha256) || sha(raw) !== externalSha256) fail();
    const value = JSON.parse(raw), anchors = config.anchors || ANCHORS;
    if (!jsonBytes(value).equals(raw) || !keys(value, ["schemaVersion", "environment", "domain", "operation", "sourceSha",
      "stackIdSha256", "originalTemplateSha256", "processedTemplateSha256", "composedTemplateSha256",
      "principalSha256", "hostedZoneSha256", "dnsBaselineSha256"]) || value.schemaVersion !== 1 || value.environment !== "test"
      || value.domain !== DOMAIN || !Object.hasOwn(OPERATIONS, value.operation)
      || !/^[a-f0-9]{40}$/.test(value.sourceSha) || value.sourceSha !== config.sourceSha
      || !/^[0-9]{12}$/.test(config.account) || sha(config.account) !== anchors.account
      || value.stackIdSha256 !== anchors.stacks[value.operation]
      || ["originalTemplateSha256", "processedTemplateSha256", "composedTemplateSha256"].some(key => !isSha(value[key]))) fail();
    if (value.operation === "operator-role") {
      if (typeof config.principal !== "string" || !new RegExp(`^arn:aws:iam::${config.account}:user/[A-Za-z0-9+=,.@_/-]+$`).test(config.principal)
        || sha(config.principal) !== anchors.principal || value.principalSha256 !== anchors.principal
        || value.hostedZoneSha256 !== null || value.dnsBaselineSha256 !== null) fail();
    } else if (typeof config.zoneId !== "string" || !/^Z[A-Z0-9]+$/.test(config.zoneId) || sha(config.zoneId) !== anchors.zone
      || value.hostedZoneSha256 !== anchors.zone || value.principalSha256 !== null || !isSha(value.dnsBaselineSha256)) fail();
    return value;
  } catch { fail(); }
}

function composeTemplate(original, operation, config) {
  if (!Object.hasOwn(OPERATIONS, operation) || !object(original) || !object(original.Resources)
    || original.Transform || original.Resources[OPERATIONS[operation].logical] || original.Parameters?.[HUMAN_PARAMETER]
    || Object.values(original.Resources).some(resource => resource.Type === "AWS::CloudFront::Distribution"
      && resource.Properties?.DistributionConfig?.Aliases?.includes(HOST))) fail();
  const result = structuredClone(original);
  const resource = { Type: OPERATIONS[operation].type, DeletionPolicy: "Retain", UpdateReplacePolicy: "Retain" };
  if (operation === "certificate") {
    if (typeof config.zoneId !== "string" || sha(config.zoneId) !== (config.anchors || ANCHORS).zone) fail();
    resource.Properties = { DomainName: HOST, ValidationMethod: "DNS",
      DomainValidationOptions: [{ DomainName: HOST, HostedZoneId: config.zoneId }], CertificateExport: "DISABLED" };
  } else {
    result.Parameters = { ...(result.Parameters || {}), [HUMAN_PARAMETER]: { Type: "String", NoEcho: true } };
    resource.Properties = { RoleName: "zoolanding-thn-registry-test-operator",
      AssumeRolePolicyDocument: { Version: "2012-10-17", Statement: [{ Effect: "Allow",
        Principal: { AWS: { Ref: HUMAN_PARAMETER } }, Action: "sts:AssumeRole" }] } };
  }
  result.Resources[OPERATIONS[operation].logical] = resource;
  return result;
}

function normalizedDns(records) {
  if (!Array.isArray(records) || records.length < 1 || records.length > 10000
    || records.some(record => !object(record) || typeof record.Name !== "string"
      || !(record.Name === `${DOMAIN}.` || record.Name.endsWith(`.${DOMAIN}.`)) || typeof record.Type !== "string")) fail();
  const normalized = records.map(record => ({ ...record, ...(record.ResourceRecords
    ? { ResourceRecords: [...record.ResourceRecords].sort((a, b) => a.Value < b.Value ? -1 : a.Value > b.Value ? 1 : 0) } : {}) }));
  return normalized.sort((a, b) => canonical(a) < canonical(b) ? -1 : canonical(a) > canonical(b) ? 1 : 0);
}

function verifyDnsDelta(before, after, cname) {
  const old = normalizedDns(before), current = normalizedDns(after);
  if (!keys(cname, ["Name", "Type", "Value"]) || cname.Type !== "CNAME"
    || !/^_[A-Za-z0-9-]+\.admin-test\.thehairnarrative\.com\.$/.test(cname.Name)
    || !/^_[A-Za-z0-9.-]+\.acm-validations\.aws\.$/.test(cname.Value)) fail();
  const selected = current.filter(record => record.Name === cname.Name && record.Type === "CNAME");
  if (selected.length !== 1 || !keys(selected[0], ["Name", "Type", "TTL", "ResourceRecords"])
    || !Number.isInteger(selected[0].TTL) || selected[0].TTL < 1 || selected[0].TTL > 604800
    || !same(selected[0].ResourceRecords, [{ Value: cname.Value }])) fail();
  const existing = old.filter(record => record.Name === cname.Name && record.Type === "CNAME");
  if (existing.length > 1 || (existing.length === 1 && !same(existing[0], selected[0]))) fail();
  if (!same(current, normalizedDns(existing.length ? old : [...old, selected[0]]))) fail();
  return { beforeCount: old.length, afterCount: current.length, addedValidationRecords: existing.length ? 0 : 1 };
}

function reviewPrerequisiteChangeSet(description, original, processed, expected) {
  const target = OPERATIONS[expected.operation];
  if (!target || description.StackName !== target.stack || description.StackId !== expected.stackId
    || description.ChangeSetName !== expected.name || description.ChangeSetId !== expected.id
    || !new RegExp(`^arn:aws:cloudformation:${REGION}:${expected.account}:changeSet/${expected.name}/[A-Za-z0-9-]+$`).test(description.ChangeSetId)
    || description.Status !== "CREATE_COMPLETE" || description.ExecutionStatus !== "AVAILABLE"
    || (Object.hasOwn(description, "ChangeSetType") && description.ChangeSetType !== "UPDATE")
    || description.IncludeNestedStacks === true
    || description.NextToken || !Array.isArray(description.Changes) || description.Changes.length !== 1
    || !same(original, expected.original) || !same(processed, expected.processed)) fail();
  const previous = parameterSnapshot(expected.previousParameters);
  if (!Array.isArray(description.Parameters)
    || !same(description.Parameters.map(item => item.ParameterKey).sort(), Object.keys(expected.original.Parameters || {}).sort())) fail();
  for (const parameter of description.Parameters) {
    if (parameter.ParameterKey === HUMAN_PARAMETER && expected.operation === "operator-role") {
      // NoEcho is intentionally opaque: this checks only its native mask, not the secret value.
      // The exact value is pinned in our authenticated CreateChangeSet request and final IAM trust.
      if (!same(parameter, { ParameterKey: HUMAN_PARAMETER, ParameterValue: "****" })) fail();
    } else {
      const old = previous.find(item => item.ParameterKey === parameter.ParameterKey);
      if (!old || !object(parameter) || Object.keys(parameter).some(key => !["ParameterKey", "ParameterValue", "ResolvedValue", "UsePreviousValue"].includes(key))
        || (Object.hasOwn(parameter, "UsePreviousValue") && parameter.UsePreviousValue !== true)
        || (parameter.ParameterValue === undefined ? parameter.UsePreviousValue !== true : parameter.ParameterValue !== old.ParameterValue)
        || parameter.ResolvedValue !== old.ResolvedValue) fail();
    }
  }
  const change = description.Changes[0];
  if (change.Type !== "Resource" || change.ResourceChange?.Action !== "Add"
    || change.ResourceChange.LogicalResourceId !== target.logical || change.ResourceChange.ResourceType !== target.type
    || ![undefined, "False"].includes(change.ResourceChange.Replacement)) fail();
}

function parameterSnapshot(parameters) {
  if (!Array.isArray(parameters) || parameters.some(item => !object(item) || typeof item.ParameterKey !== "string"
    || typeof item.ParameterValue !== "string" || (item.ResolvedValue !== undefined && typeof item.ResolvedValue !== "string")
    || Object.keys(item).some(key => !["ParameterKey", "ParameterValue", "ResolvedValue", "UsePreviousValue"].includes(key)))
    || new Set(parameters.map(item => item.ParameterKey)).size !== parameters.length) fail();
  return parameters.map(({ ParameterKey, ParameterValue, ResolvedValue }) => ({ ParameterKey, ParameterValue,
    ...(ResolvedValue === undefined ? {} : { ResolvedValue }) })).sort((a, b) => a.ParameterKey < b.ParameterKey ? -1 : a.ParameterKey > b.ParameterKey ? 1 : 0);
}

function validateAuthority(authority, operation, config) {
  const anchors = config.anchors || ANCHORS;
  if (!keys(authority, ["account", "region", "stackName", "lookup", "deploy", "publisher", "cfn", "bucket"])
    || authority.account !== config.account || sha(authority.account) !== anchors.account || authority.region !== REGION
    || !Object.hasOwn(OPERATIONS, operation) || authority.stackName !== OPERATIONS[operation].stack) fail();
  for (const [kind, roleKind] of [["lookup", "lookup"], ["deploy", "deploy"], ["publisher", "file-publishing"], ["cfn", "cfn-exec"]]) {
    if (typeof authority[kind] !== "string" || sha(authority[kind]) !== anchors[kind]
      || !new RegExp(`^arn:aws:iam::${config.account}:role/cdk-[a-z0-9]+-${roleKind}-role-${config.account}-${REGION}$`).test(authority[kind])) fail();
  }
  if (typeof authority.bucket !== "string" || sha(authority.bucket) !== anchors.bucket
    || !new RegExp(`^cdk-[a-z0-9]+-assets-${config.account}-${REGION}$`).test(authority.bucket)) fail();
  return authority;
}

function awsCli(service, operation, input, env, outputFile, spawn = spawnSync) {
  const parameters = { ...input };
  const bodyArgs = service === "s3api" && operation === "put-object" ? ["--body", parameters.Body] : [];
  if (bodyArgs.length) {
    if (typeof parameters.Body !== "string" || !path.isAbsolute(parameters.Body)) fail();
    delete parameters.Body;
  }
  const args = [service, operation, ...(outputFile ? [outputFile] : []), "--cli-input-json", "file:///dev/stdin",
    ...bodyArgs,
    "--region", REGION, "--output", "json", "--no-cli-pager",
    ...(service === "route53" && operation === "list-resource-record-sets" ? ["--no-paginate"] : [])];
  // Node's stdin socket cannot be reopened as /dev/stdin on Linux. Bash supplies
  // a real anonymous pipe; exec keeps the AWS process under spawnSync's timeout.
  // -p ignores inherited startup files/functions/tracing, not an elevation.
  // JSON stays on stdin; the fixed script never interpolates argument contents.
  const result = spawn("bash", ["--noprofile", "--norc", "-p", "-c", 'exec aws "$@" < <(cat)', "thn-aws-cli", ...args],
    { input: JSON.stringify(parameters), env: { ...env, AWS_PAGER: "", AWS_MAX_ATTEMPTS: "1" },
    timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) fail();
  try { return result.stdout.length ? JSON.parse(result.stdout) : {}; } catch { fail(); }
}

function createClients(authority, operation, config) {
  validateAuthority(authority, operation, config);
  const anchors = config.anchors || ANCHORS, env = config.env || process.env, aws = config.aws || awsCli;
  if (typeof config.authenticate !== "function" || !/^[1-9][0-9]*$/.test(config.runId) || !/^[1-9][0-9]*$/.test(config.runAttempt)) fail();
  const sessions = new Map();
  const allowed = {
    lookup: new Set(["cloudformation:describe-stacks", "cloudformation:get-template", "cloudformation:describe-stack-resource",
      "route53:get-hosted-zone", "route53:list-resource-record-sets", "acm:describe-certificate", "iam:get-role",
      "iam:list-role-policies", "iam:list-attached-role-policies", "kms:describe-key",
      "s3api:get-bucket-acl", "s3api:get-bucket-encryption", "s3api:get-bucket-policy"]),
    deploy: new Set(["cloudformation:update-termination-protection", "cloudformation:create-change-set", "cloudformation:describe-change-set",
      "cloudformation:execute-change-set", "cloudformation:get-template", "cloudformation:describe-stacks", "s3api:get-object"]),
    publisher: new Set(["s3api:put-object", "s3api:get-object"]),
  };
  return (kind, service, action, input, outputFile) => {
    try {
      if (!allowed[kind]?.has(`${service}:${action}`) || !object(input)) fail();
      if (service === "cloudformation" && input.StackName !== authority.stackName
        && sha(input.StackName || "") !== anchors.stacks[operation]) fail();
      if (action === "update-termination-protection" && (input.EnableTerminationProtection !== true
        || sha(input.StackName || "") !== anchors.stacks[operation])) fail();
      if (service === "route53" && input.Id !== config.zoneId && input.HostedZoneId !== config.zoneId) fail();
      if (service === "s3api" && (input.Bucket !== authority.bucket || input.ExpectedBucketOwner !== config.account)) fail();
      if (["get-object", "put-object"].includes(action) && !new RegExp(`^thn-prerequisites/${operation}/${config.runId}/${config.runAttempt}/${config.sourceSha}/[a-f0-9]{64}\\.json$`).test(input.Key || "")) fail();
      if (service === "kms" && input.KeyId !== "alias/aws/s3") fail();
      if (service === "iam" && ![authority.cfn.split("/").at(-1), "zoolanding-thn-registry-test-operator"].includes(input.RoleName)) fail();
      if (service === "acm" && !new RegExp(`^arn:aws:acm:${REGION}:${config.account}:certificate/[A-Za-z0-9-]+$`).test(input.CertificateArn || "")) fail();
      if (!sessions.has(kind)) {
        config.authenticate();
        const sessionName = `thn-prereq-${kind}-${config.runId}-${config.runAttempt}`;
        const result = aws("sts", "assume-role", { RoleArn: authority[kind], RoleSessionName: sessionName, DurationSeconds: 3600 }, env);
        const credentials = result.Credentials, expiration = Date.parse(credentials?.Expiration);
        if (result.AssumedRoleUser?.Arn !== `arn:aws:sts::${config.account}:assumed-role/${authority[kind].split("/").at(-1)}/${sessionName}`
          || !/^ASIA[A-Z0-9]{16}$/.test(credentials?.AccessKeyId) || typeof credentials.SecretAccessKey !== "string" || credentials.SecretAccessKey.length < 20
          || typeof credentials.SessionToken !== "string" || !credentials.SessionToken || !Number.isFinite(expiration)
          || expiration <= Date.now() || expiration > Date.now() + 3600000) fail();
        const isolated = { ...env, AWS_ACCESS_KEY_ID: credentials.AccessKeyId, AWS_SECRET_ACCESS_KEY: credentials.SecretAccessKey,
          AWS_SESSION_TOKEN: credentials.SessionToken, AWS_REGION: REGION, AWS_DEFAULT_REGION: REGION };
        for (const key of ["AWS_PROFILE", "AWS_DEFAULT_PROFILE", "AWS_WEB_IDENTITY_TOKEN_FILE", "AWS_ROLE_ARN", "AWS_ROLE_SESSION_NAME"]) delete isolated[key];
        sessions.set(kind, isolated);
      }
      if (["put-object", "create-change-set", "execute-change-set", "update-termination-protection"].includes(action)) config.authenticate();
      return aws(service, action, input, sessions.get(kind), outputFile);
    } catch { fail(); }
  };
}

const TRANSPORT_FILES = ["authority.json", "coordinates.json", "infra-test-aws.js", "ledger.json", "thn-admin-release.js", "thn-test-prerequisites.js"];

function writeTransport(directory, ledgerRaw, ledgerSha256, authority, config) {
  const ledger = validateLedger(ledgerRaw, ledgerSha256, config);
  validateAuthority(authority, ledger.operation, config);
  if (fs.existsSync(directory) || !/^[1-9][0-9]*$/.test(config.runId) || !/^[1-9][0-9]*$/.test(config.runAttempt)) fail();
  const files = { "authority.json": jsonBytes(authority), "ledger.json": ledgerRaw,
    "coordinates.json": jsonBytes({ sourceSha: config.sourceSha, runId: config.runId, runAttempt: config.runAttempt, ledgerSha256 }) };
  for (const name of TRANSPORT_FILES.filter(file => file.endsWith(".js"))) files[name] = fs.readFileSync(path.join(__dirname, name));
  if (config.principal && Object.values(files).some(raw => raw.includes(Buffer.from(config.principal)))) fail();
  fs.mkdirSync(directory, { recursive: false, mode: 0o700 });
  for (const name of TRANSPORT_FILES) fs.writeFileSync(path.join(directory, name), files[name], { flag: "wx", mode: 0o600 });
  const manifest = Buffer.from(TRANSPORT_FILES.map(name => `${sha(files[name])}  ${name}\n`).join(""));
  fs.writeFileSync(path.join(directory, "manifest.sha256"), manifest, { flag: "wx", mode: 0o600 });
  return { manifestSha256: sha(manifest) };
}

function verifyTransport(directory, externalSha256, config) {
  try {
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || !isSha(externalSha256)
      || !same(fs.readdirSync(directory).sort(), [...TRANSPORT_FILES, "manifest.sha256"].sort())) fail();
    const files = {};
    for (const name of [...TRANSPORT_FILES, "manifest.sha256"]) {
      const file = path.join(directory, name), info = fs.lstatSync(file);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 2 * 1024 * 1024) fail();
      files[name] = fs.readFileSync(file);
    }
    if (sha(files["manifest.sha256"]) !== externalSha256
      || !files["manifest.sha256"].equals(Buffer.from(TRANSPORT_FILES.map(name => `${sha(files[name])}  ${name}\n`).join("")))) fail();
    const coordinates = JSON.parse(files["coordinates.json"]);
    if (!keys(coordinates, ["sourceSha", "runId", "runAttempt", "ledgerSha256"]) || coordinates.sourceSha !== config.sourceSha
      || coordinates.runId !== config.runId || coordinates.runAttempt !== config.runAttempt) fail();
    const ledger = validateLedger(files["ledger.json"], coordinates.ledgerSha256, config);
    const authority = validateAuthority(JSON.parse(files["authority.json"]), ledger.operation, config);
    if (config.operation && config.operation !== ledger.operation) fail();
    if (config.principal && Object.values(files).some(raw => raw.includes(Buffer.from(config.principal)))) fail();
    return { ledger, authority, coordinates };
  } catch { fail(); }
}

function deriveAuthority(operation) {
  if (!Object.hasOwn(OPERATIONS, operation)) fail();
  const cdk = require("aws-cdk-lib"), { environments } = require("../config/environments");
  const environment = environments.find(item => item.name === "test");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "thn-prerequisite-authority-"));
  try {
    const app = new cdk.App({ outdir: directory });
    const env = { account: environment.account, region: environment.region };
    const stage = new cdk.Stage(app, "ZoolandingTest", { env });
    const Stack = operation === "certificate" ? require("../lib/stacks/frontend-stack").FrontendStack
      : require("../lib/stacks/service-repository-bootstrap-stack").ServiceRepositoryBootstrapStack;
    new Stack(stage, OPERATIONS[operation].stack.replace(/^ZoolandingTest-/, ""), { environment, env });
    const assembly = stage.synth(), stacks = assembly.stacks.filter(stack => stack.stackName === OPERATIONS[operation].stack);
    if (stacks.length !== 1) fail();
    const stack = stacks[0], properties = stack.manifest.properties;
    const dependencies = stack.dependencies.filter(item => item.manifest.type === "cdk:asset-manifest");
    if (dependencies.length !== 1) fail();
    const assets = JSON.parse(fs.readFileSync(path.join(assembly.directory, dependencies[0].manifest.properties.file)));
    const templates = Object.values(assets.files || {}).filter(file => file.source?.path === properties.templateFile);
    if (templates.length !== 1 || Object.keys(templates[0].destinations).length !== 1) fail();
    const destination = Object.values(templates[0].destinations)[0];
    if (destination.region !== REGION || !/^[a-f0-9]{64}\.json$/.test(destination.objectKey)) fail();
    return { account: environment.account, region: REGION, stackName: properties.stackName,
      ...Object.fromEntries(Object.entries({ lookup: properties.lookupRole?.arn, deploy: properties.assumeRoleArn,
        publisher: destination.assumeRoleArn, cfn: properties.cloudFormationExecutionRoleArn, bucket: destination.bucketName })
        .map(([key, value]) => [key, value.replaceAll("${AWS::Partition}", "aws")])) };
  } finally {
    if (path.dirname(directory) !== os.tmpdir()) fail();
    fs.rmSync(directory, { recursive: true });
  }
}

async function executePrerequisite(ledger, authority, config) {
  validateLedger(jsonBytes(ledger), config.ledgerSha256, config);
  config.authenticate();
  const operation = ledger.operation, target = OPERATIONS[operation], anchors = config.anchors || ANCHORS;
  const client = createClients(authority, operation, config);
  const readStack = () => {
    const response = client("lookup", "cloudformation", "describe-stacks", { StackName: target.stack });
    if (response.Stacks?.length !== 1) fail();
    const stack = response.Stacks[0];
    if (stack.StackName !== target.stack || sha(stack.StackId || "") !== ledger.stackIdSha256
      || !new RegExp(`^arn:aws:cloudformation:${REGION}:${config.account}:stack/${target.stack}/[A-Za-z0-9-]+$`).test(stack.StackId)
      || !["CREATE_COMPLETE", "UPDATE_COMPLETE", "UPDATE_ROLLBACK_COMPLETE"].includes(stack.StackStatus)
      || (stack.RoleARN && stack.RoleARN !== authority.cfn)) fail();
    return stack;
  };
  const stack = readStack(), stackId = stack.StackId;
  const readTemplate = (stage, changeSet, kind = "lookup") => {
    const response = client(kind, "cloudformation", "get-template", { StackName: stackId, TemplateStage: stage,
      ...(changeSet ? { ChangeSetName: changeSet } : {}) });
    const value = typeof response.TemplateBody === "string" ? JSON.parse(response.TemplateBody) : response.TemplateBody;
    if (!object(value) || !object(value.Resources)) fail();
    return value;
  };
  const original = readTemplate("Original"), processed = readTemplate("Processed"), previousParameters = parameterSnapshot(stack.Parameters || []);
  if (sha(canonical(original)) !== ledger.originalTemplateSha256 || sha(canonical(processed)) !== ledger.processedTemplateSha256) fail();
  if (!same(previousParameters.map(item => item.ParameterKey), Object.keys(original.Parameters || {}).sort())) fail();
  const prepared = composeTemplate(original, operation, config), preparedProcessed = composeTemplate(processed, operation, config);
  const body = Buffer.from(canonical(prepared));
  if (body.length > 1024 * 1024 || sha(body) !== ledger.composedTemplateSha256 || (config.principal && body.includes(Buffer.from(config.principal)))) fail();
  const checkBaseline = () => {
    config.authenticate();
    const current = readStack();
    if (current.StackId !== stackId || !same(parameterSnapshot(current.Parameters || []), previousParameters)
      || sha(canonical(readTemplate("Original"))) !== ledger.originalTemplateSha256
      || sha(canonical(readTemplate("Processed"))) !== ledger.processedTemplateSha256) fail();
    return current;
  };
  const readDns = () => {
    const records = [], seen = new Set();
    let cursor = {};
    for (let page = 0; page < 100; page++) {
      const response = client("lookup", "route53", "list-resource-record-sets", { HostedZoneId: config.zoneId, MaxItems: "100", ...cursor });
      if (!Array.isArray(response.ResourceRecordSets) || response.NextToken || typeof response.IsTruncated !== "boolean") fail();
      records.push(...response.ResourceRecordSets);
      if (records.length > 10000) fail();
      if (!response.IsTruncated) return normalizedDns(records);
      if (!response.NextRecordName || !response.NextRecordType) fail();
      cursor = { StartRecordName: response.NextRecordName, StartRecordType: response.NextRecordType,
        ...(response.NextRecordIdentifier ? { StartRecordIdentifier: response.NextRecordIdentifier } : {}) };
      if (seen.has(canonical(cursor))) fail();
      seen.add(canonical(cursor));
    }
    fail();
  };
  let beforeDns;
  if (operation === "certificate") {
    const zone = client("lookup", "route53", "get-hosted-zone", { Id: config.zoneId }).HostedZone;
    if (zone?.Id !== `/hostedzone/${config.zoneId}` || zone.Name !== `${DOMAIN}.` || zone.Config?.PrivateZone !== false) fail();
    beforeDns = readDns();
    if (sha(canonical(beforeDns)) !== ledger.dnsBaselineSha256) fail();
  }
  const bucketInput = { Bucket: authority.bucket, ExpectedBucketOwner: config.account };
  const acl = client("lookup", "s3api", "get-bucket-acl", bucketInput);
  if (!acl.Owner?.ID || acl.Grants?.length !== 1 || acl.Grants[0].Grantee?.ID !== acl.Owner.ID || acl.Grants[0].Permission !== "FULL_CONTROL") fail();
  const bucketPolicy = client("lookup", "s3api", "get-bucket-policy", bucketInput);
  if (sha(canonical(JSON.parse(bucketPolicy.Policy))) !== anchors.bucketPolicy) fail();
  const encryption = client("lookup", "s3api", "get-bucket-encryption", bucketInput).ServerSideEncryptionConfiguration;
  const key = client("lookup", "kms", "describe-key", { KeyId: "alias/aws/s3" }).KeyMetadata;
  if (sha(key?.Arn || "") !== anchors.kmsKey || key.KeyManager !== "AWS" || key.Enabled !== true || key.KeyState !== "Enabled"
    || encryption?.Rules?.length !== 1 || encryption.Rules[0].ApplyServerSideEncryptionByDefault?.SSEAlgorithm !== "aws:kms"
    || ![undefined, "alias/aws/s3", key.Arn, key.KeyId].includes(encryption.Rules[0].ApplyServerSideEncryptionByDefault.KMSMasterKeyID)) fail();
  const cfnRole = client("lookup", "iam", "get-role", { RoleName: authority.cfn.split("/").at(-1) }).Role;
  if (cfnRole?.Arn !== authority.cfn || !same(cfnRole.AssumeRolePolicyDocument, { Version: "2012-10-17",
    Statement: [{ Effect: "Allow", Principal: { Service: "cloudformation.amazonaws.com" }, Action: "sts:AssumeRole" }] })) fail();
  if (!checkBaseline().EnableTerminationProtection) {
    client("deploy", "cloudformation", "update-termination-protection", { StackName: stackId, EnableTerminationProtection: true });
  }
  if (checkBaseline().EnableTerminationProtection !== true) fail();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "thn-prerequisite-template-"));
  try {
    const localTemplate = path.join(directory, "template.json"), localReadback = path.join(directory, "readback.json");
    fs.writeFileSync(localTemplate, body, { flag: "wx", mode: 0o600 });
    const objectKey = `thn-prerequisites/${operation}/${config.runId}/${config.runAttempt}/${config.sourceSha}/${ledger.composedTemplateSha256}.json`;
    const objectInput = { ...bucketInput, Key: objectKey };
    checkBaseline();
    client("publisher", "s3api", "put-object", { ...objectInput, Body: localTemplate, IfNoneMatch: "*",
      ServerSideEncryption: "aws:kms", SSEKMSKeyId: key.Arn, ChecksumSHA256: Buffer.from(ledger.composedTemplateSha256, "hex").toString("base64") });
    const verifyObject = (kind = "publisher") => {
      const metadata = client(kind, "s3api", "get-object", { ...objectInput, ChecksumMode: "ENABLED" }, localReadback);
      if (metadata.ServerSideEncryption !== "aws:kms" || metadata.SSEKMSKeyId !== key.Arn
        || metadata.ChecksumSHA256 !== Buffer.from(ledger.composedTemplateSha256, "hex").toString("base64")
        || sha(fs.readFileSync(localReadback)) !== ledger.composedTemplateSha256) fail();
    };
    verifyObject();
    const templateUrl = `https://${authority.bucket}.s3.${REGION}.amazonaws.com/${objectKey}`;
    const parameters = Object.keys(original.Parameters || {}).sort().map(ParameterKey => ({ ParameterKey, UsePreviousValue: true }));
    if (operation === "operator-role") parameters.push({ ParameterKey: HUMAN_PARAMETER, ParameterValue: config.principal });
    const name = `thn-prerequisite-${operation}-${config.runId}-${config.runAttempt}`;
    checkBaseline();
    const created = client("deploy", "cloudformation", "create-change-set", { StackName: stackId, ChangeSetName: name,
      ChangeSetType: "UPDATE", TemplateURL: templateUrl, RoleARN: authority.cfn, Parameters: parameters,
      Capabilities: ["CAPABILITY_NAMED_IAM"], IncludeNestedStacks: false, ClientToken: name });
    if (created.StackId !== stackId || !new RegExp(`^arn:aws:cloudformation:${REGION}:${config.account}:changeSet/${name}/[A-Za-z0-9-]+$`).test(created.Id || "")) fail();
    const changeSetInput = { StackName: stackId, ChangeSetName: created.Id, IncludePropertyValues: true };
    const delay = config.delay || (() => new Promise(resolve => setTimeout(resolve, 10000)));
    const waitFor = async (read, ready) => {
      for (let attempt = 0; attempt < (config.maxPolls || 180); attempt++) {
        const value = read();
        if (ready(value)) return value;
        await delay();
      }
      fail();
    };
    await waitFor(() => client("deploy", "cloudformation", "describe-change-set", changeSetInput), value => {
      if (["FAILED", "DELETE_COMPLETE", "DELETE_FAILED"].includes(value.Status)) fail();
      return value.Status === "CREATE_COMPLETE";
    });
    const review = () => reviewPrerequisiteChangeSet(client("deploy", "cloudformation", "describe-change-set", changeSetInput),
      readTemplate("Original", created.Id, "deploy"), readTemplate("Processed", created.Id, "deploy"), {
        operation, account: config.account, stackId, name, id: created.Id, cfnRole: authority.cfn, original: prepared,
        processed: preparedProcessed, previousParameters });
    review();
    if (checkBaseline().EnableTerminationProtection !== true) fail();
    if (beforeDns && sha(canonical(readDns())) !== ledger.dnsBaselineSha256) fail();
    verifyObject();
    verifyObject("deploy");
    review();
    client("deploy", "cloudformation", "execute-change-set", { StackName: stackId, ChangeSetName: created.Id, ClientRequestToken: name });
    await waitFor(() => client("deploy", "cloudformation", "describe-change-set", changeSetInput), value => {
      if (value.ExecutionStatus === "UNAVAILABLE" || value.Status === "FAILED") fail();
      return value.ExecutionStatus === "EXECUTE_COMPLETE";
    });
    const finalStack = readStack();
    if (finalStack.StackStatus !== "UPDATE_COMPLETE" || finalStack.EnableTerminationProtection !== true || finalStack.RoleARN !== authority.cfn) fail();
    const resource = client("lookup", "cloudformation", "describe-stack-resource", { StackName: stackId, LogicalResourceId: target.logical }).StackResourceDetail;
    if (resource?.StackId !== stackId || resource.StackName !== target.stack || resource.LogicalResourceId !== target.logical
      || resource.ResourceType !== target.type || resource.ResourceStatus !== "CREATE_COMPLETE") fail();
    const result = { status: "verified", operation, addedResources: 1, terminationProtection: true,
      templateSha256: ledger.composedTemplateSha256, stackIdSha256: ledger.stackIdSha256 };
    if (operation === "certificate") {
      const arn = resource.PhysicalResourceId, certificate = client("lookup", "acm", "describe-certificate", { CertificateArn: arn });
      require("./thn-admin-release").verifyAdminCertificate(certificate, { arn, arnSha256: sha(arn), accountId: config.account });
      const validation = certificate.Certificate.DomainValidationOptions;
      if (validation?.length !== 1 || validation[0].DomainName !== HOST || validation[0].ValidationStatus !== "SUCCESS") fail();
      result.dns = verifyDnsDelta(beforeDns, readDns(), validation[0].ResourceRecord);
      result.certificateArnSha256 = sha(arn);
    } else {
      if (resource.PhysicalResourceId !== "zoolanding-thn-registry-test-operator") fail();
      const roleInput = { RoleName: resource.PhysicalResourceId }, role = client("lookup", "iam", "get-role", roleInput).Role;
      if (role?.Arn !== `arn:aws:iam::${config.account}:role/${roleInput.RoleName}` || !same(role.AssumeRolePolicyDocument,
        { Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: { AWS: config.principal }, Action: "sts:AssumeRole" }] })) fail();
      const inline = client("lookup", "iam", "list-role-policies", roleInput), attached = client("lookup", "iam", "list-attached-role-policies", roleInput);
      if (inline.IsTruncated || attached.IsTruncated || inline.PolicyNames?.length !== 0 || attached.AttachedPolicies?.length !== 0) fail();
      result.roleArnSha256 = sha(role.Arn);
    }
    return result;
  } finally {
    if (path.dirname(directory) !== os.tmpdir()) fail();
    fs.rmSync(directory, { recursive: true });
  }
}

async function runPrerequisite(ledger, authority, config) {
  try { return await executePrerequisite(ledger, authority, config); } catch { fail(); }
}

async function main(args, env = process.env) {
  if (args.length !== 2 || !["prepare", "verify", "run"].includes(args[0]) || env.GITHUB_ACTIONS !== "true"
    || env.GITHUB_EVENT_NAME !== "workflow_dispatch" || env.GITHUB_REF !== "refs/heads/test"
    || env.GITHUB_REPOSITORY !== "LynxPardelle/zoolandingpage-aws-infra" || env.APPROVE_EXACT_PREREQUISITE !== "true"
    || !Object.hasOwn(OPERATIONS, env.PREREQUISITE_OPERATION)) fail();
  const [mode, directory] = args;
  const authority = mode === "prepare" ? deriveAuthority(env.PREREQUISITE_OPERATION) : JSON.parse(fs.readFileSync(path.join(directory, "authority.json")));
  const config = { account: authority.account, sourceSha: env.GITHUB_SHA, runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT,
    operation: env.PREREQUISITE_OPERATION, principal: env.THN_TEST_OPERATOR_PRINCIPAL_ARN,
    zoneId: env.FRONTEND_TEST_THN_ADMIN_HOSTED_ZONE_ID, env };
  if (mode === "prepare") {
    const encoded = env.REVIEWED_LEDGER_BASE64;
    if (typeof encoded !== "string" || encoded.length > 16384 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) fail();
    const raw = Buffer.from(encoded, "base64");
    if (raw.toString("base64") !== encoded || JSON.parse(raw).operation !== config.operation) fail();
    return writeTransport(directory, raw, env.REVIEWED_LEDGER_SHA256, authority, config);
  }
  const authenticate = () => verifyTransport(directory, env.EXPECTED_PREREQUISITE_MANIFEST_SHA256, config);
  const artifact = authenticate();
  if (mode === "verify") return { status: "verified", operation: artifact.ledger.operation, cloudCalls: 0 };
  const caller = awsCli("sts", "get-caller-identity", {}, env);
  if (caller.Account !== config.account || !new RegExp(`^arn:aws:sts::${config.account}:assumed-role/[A-Za-z0-9+=,.@_-]+/[A-Za-z0-9+=,.@_-]+$`).test(caller.Arn || "")) fail();
  return runPrerequisite(artifact.ledger, artifact.authority, { ...config, authenticate, ledgerSha256: artifact.coordinates.ledgerSha256 });
}

if (require.main === module) {
  main(process.argv.slice(2)).then(result => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch(() => { process.stderr.write('{"status":"blocked","reason":"thn_prerequisite_guard_failed","reconciliationRequired":true}\n'); process.exitCode = 1; });
}

module.exports = { validateLedger, composeTemplate, verifyDnsDelta, normalizedDns, canonical, sha, ANCHORS, OPERATIONS,
  reviewPrerequisiteChangeSet, validateAuthority, createClients, writeTransport, verifyTransport, deriveAuthority, runPrerequisite, main, awsCli };
