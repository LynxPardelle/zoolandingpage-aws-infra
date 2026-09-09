"use strict";
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const prerequisite = require("./thn-test-prerequisites");
const { sha, canonical, ANCHORS, validateAuthority, deriveAuthority, awsCli } = prerequisite;
const { TARGETS, POLICY_NAME, supplementalResources } = require("./thn-test-permission-policy");
const STACK = "ZoolandingTest-Zoolandingpage-test-ServiceRepositoryBootstrap", REGION = "us-east-1";
const fail = () => { throw new Error("thn_permission_guard_failed"); };
const object = value => value && typeof value === "object" && !Array.isArray(value);
const same = (a, b) => canonical(a) === canonical(b);
const exactKeys = (value, keys) => object(value) && same(Object.keys(value).sort(), [...keys].sort());
const isHash = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + "\n");
const logicals = Object.keys(TARGETS);

function composeTemplate(original) {
  if (!object(original) || !object(original.Resources) || original.Transform
    || logicals.some(key => Object.hasOwn(original.Resources, key))
    || Object.values(original.Resources).some(r => r.Properties?.PolicyName === POLICY_NAME)) fail();
  const result = structuredClone(original), additions = supplementalResources();
  for (const logical of logicals.slice(1)) {
    const roles = Object.entries(original.Resources).filter(([, r]) => r.Type === "AWS::IAM::Role" && r.Properties?.RoleName === TARGETS[logical]);
    if (roles.length !== 1) fail();
    additions[logical].DependsOn = [roles[0][0]];
  }
  Object.assign(result.Resources, additions);
  return result;
}

function validateLedger(raw, externalSha256, config) {
  try {
    if (!Buffer.isBuffer(raw) || raw.length > 8192 || !isHash(externalSha256) || sha(raw) !== externalSha256) fail();
    const value = JSON.parse(raw), anchors = config.anchors || ANCHORS;
    if (!jsonBytes(value).equals(raw) || !exactKeys(value, ["schemaVersion", "environment", "domain", "sourceSha", "stackIdSha256",
      "originalTemplateSha256", "processedTemplateSha256", "composedTemplateSha256", "composedProcessedTemplateSha256",
      "policyResourcesSha256", "roleBaselinesSha256"]) || value.schemaVersion !== 1 || value.environment !== "test"
      || value.domain !== "thehairnarrative.com" || !/^[a-f0-9]{40}$/.test(value.sourceSha) || value.sourceSha !== config.sourceSha
      || !/^[0-9]{12}$/.test(config.account) || sha(config.account) !== anchors.account
      || value.stackIdSha256 !== anchors.stacks["operator-role"]
      || ["originalTemplateSha256", "processedTemplateSha256", "composedTemplateSha256", "composedProcessedTemplateSha256"].some(key => !isHash(value[key]))
      || value.policyResourcesSha256 !== sha(canonical(supplementalResources()))
      || !exactKeys(value.roleBaselinesSha256, logicals) || logicals.some(key => !isHash(value.roleBaselinesSha256[key]))) fail();
    return value;
  } catch { fail(); }
}

function parametersSnapshot(parameters) {
  if (!Array.isArray(parameters) || parameters.some(p => !object(p) || typeof p.ParameterKey !== "string" || typeof p.ParameterValue !== "string"
    || (p.ResolvedValue !== undefined && typeof p.ResolvedValue !== "string")
    || Object.keys(p).some(k => !["ParameterKey", "ParameterValue", "ResolvedValue", "UsePreviousValue"].includes(k)))
    || new Set(parameters.map(p => p.ParameterKey)).size !== parameters.length) fail();
  return parameters.map(({ ParameterKey, ParameterValue, ResolvedValue }) => ({ ParameterKey, ParameterValue,
    ...(ResolvedValue === undefined ? {} : { ResolvedValue }) })).sort((a, b) => a.ParameterKey < b.ParameterKey ? -1 : a.ParameterKey > b.ParameterKey ? 1 : 0);
}

function reviewChangeSet(description, original, processed, expected) {
  if (description.StackName !== STACK || description.StackId !== expected.stackId || description.ChangeSetName !== expected.name
    || description.ChangeSetId !== expected.id || !/^thn-permissions-[1-9][0-9]*-[1-9][0-9]*$/.test(expected.name)
    || !new RegExp(`^arn:aws:cloudformation:${REGION}:${expected.account}:changeSet/${expected.name}/[A-Za-z0-9-]+$`).test(description.ChangeSetId)
    || description.Status !== "CREATE_COMPLETE" || description.ExecutionStatus !== "AVAILABLE" || description.IncludeNestedStacks === true
    || (description.ChangeSetType !== undefined && description.ChangeSetType !== "UPDATE") || description.NextToken
    || !Array.isArray(description.Changes) || description.Changes.length !== logicals.length
    || !same(original, expected.original) || !same(processed, expected.processed)) fail();
  const seen = new Set();
  for (const change of description.Changes) {
    const resource = change.ResourceChange;
    if (change.Type !== "Resource" || resource?.Action !== "Add" || !logicals.includes(resource.LogicalResourceId)
      || resource.ResourceType !== "AWS::IAM::RolePolicy" || ![undefined, "False"].includes(resource.Replacement)
      || resource.ChangeSetId || resource.ModuleInfo || seen.has(resource.LogicalResourceId)) fail();
    seen.add(resource.LogicalResourceId);
  }
  const previous = parametersSnapshot(expected.previousParameters);
  if (!Array.isArray(description.Parameters) || !same(description.Parameters.map(p => p.ParameterKey).sort(), Object.keys(expected.original.Parameters || {}).sort())) fail();
  for (const parameter of description.Parameters) {
    const old = previous.find(p => p.ParameterKey === parameter.ParameterKey);
    if (!old || Object.keys(parameter).some(k => !["ParameterKey", "ParameterValue", "ResolvedValue", "UsePreviousValue"].includes(k))
      || (parameter.UsePreviousValue !== undefined && parameter.UsePreviousValue !== true)
      || (parameter.ParameterValue === undefined ? parameter.UsePreviousValue !== true : parameter.ParameterValue !== old.ParameterValue)
      || parameter.ResolvedValue !== old.ResolvedValue) fail();
  }
}

function roleSnapshot(input, roleName, account) {
  const role = input?.Role;
  if (!Object.values(TARGETS).includes(roleName) || role?.RoleName !== roleName || role.Arn !== `arn:aws:iam::${account}:role/${roleName}`
    || role.Path !== "/" || !/^AROA[A-Z0-9]{16,}$/.test(role.RoleId) || !object(role.AssumeRolePolicyDocument)
    || role.PermissionsBoundary || !object(input.inline) || Object.keys(input.inline).length !== 1
    || Object.hasOwn(input.inline, POLICY_NAME) || !Array.isArray(input.attached) || input.attached.length !== 0
    || Object.values(input.inline).some(document => !object(document) || !Array.isArray(document.Statement))) fail();
  const stableRole = structuredClone(role);
  delete stableRole.RoleLastUsed;
  if (stableRole.Tags) {
    if (!Array.isArray(stableRole.Tags)) fail();
    stableRole.Tags.sort((a, b) => canonical(a) < canonical(b) ? -1 : canonical(a) > canonical(b) ? 1 : 0);
  }
  return { Role: stableRole, inline: structuredClone(input.inline), attached: [] };
}

const TRANSPORT_FILES = ["authority.json", "coordinates.json", "ledger.json", "thn-test-permission-policy.js",
  "thn-test-permissions.js", "thn-test-prerequisites.js"];

function writeTransport(directory, raw, ledgerSha256, authority, config) {
  validateLedger(raw, ledgerSha256, config);
  validateAuthority(authority, "operator-role", config);
  if (fs.existsSync(directory) || !/^[1-9][0-9]*$/.test(config.runId) || !/^[1-9][0-9]*$/.test(config.runAttempt)) fail();
  const files = { "authority.json": jsonBytes(authority), "ledger.json": raw,
    "coordinates.json": jsonBytes({ sourceSha: config.sourceSha, runId: config.runId, runAttempt: config.runAttempt, ledgerSha256 }) };
  for (const name of TRANSPORT_FILES.filter(n => n.endsWith(".js"))) files[name] = fs.readFileSync(path.join(__dirname, name));
  fs.mkdirSync(directory, { mode: 0o700 });
  for (const name of TRANSPORT_FILES) fs.writeFileSync(path.join(directory, name), files[name], { flag: "wx", mode: 0o600 });
  const manifest = Buffer.from(TRANSPORT_FILES.map(name => `${sha(files[name])}  ${name}\n`).join(""));
  fs.writeFileSync(path.join(directory, "manifest.sha256"), manifest, { flag: "wx", mode: 0o600 });
  return { manifestSha256: sha(manifest) };
}

function verifyTransport(directory, externalSha256, config) {
  try {
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || !isHash(externalSha256)
      || !same(fs.readdirSync(directory).sort(), [...TRANSPORT_FILES, "manifest.sha256"].sort())) fail();
    const files = {};
    for (const name of [...TRANSPORT_FILES, "manifest.sha256"]) {
      const file = path.join(directory, name), info = fs.lstatSync(file);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 2 * 1024 * 1024) fail();
      files[name] = fs.readFileSync(file);
    }
    if (sha(files["manifest.sha256"]) !== externalSha256 || !files["manifest.sha256"].equals(
      Buffer.from(TRANSPORT_FILES.map(name => `${sha(files[name])}  ${name}\n`).join("")))) fail();
    const coordinates = JSON.parse(files["coordinates.json"]);
    if (!exactKeys(coordinates, ["sourceSha", "runId", "runAttempt", "ledgerSha256"]) || coordinates.sourceSha !== config.sourceSha
      || coordinates.runId !== config.runId || coordinates.runAttempt !== config.runAttempt) fail();
    const ledger = validateLedger(files["ledger.json"], coordinates.ledgerSha256, config);
    const authority = validateAuthority(JSON.parse(files["authority.json"]), "operator-role", config);
    return { ledger, authority, coordinates };
  } catch { fail(); }
}

function createClients(authority, config) {
  validateAuthority(authority, "operator-role", config);
  if (typeof config.authenticate !== "function" || !/^[1-9][0-9]*$/.test(config.runId) || !/^[1-9][0-9]*$/.test(config.runAttempt)) fail();
  const env = config.env || process.env, aws = config.aws || awsCli, anchors = config.anchors || ANCHORS, sessions = new Map();
  const allowed = {
    lookup: new Set(["cloudformation:describe-stacks", "cloudformation:get-template", "cloudformation:describe-stack-resource",
      "iam:get-role", "iam:list-role-policies", "iam:get-role-policy", "iam:list-attached-role-policies", "kms:describe-key",
      "s3api:get-bucket-acl", "s3api:get-bucket-encryption", "s3api:get-bucket-policy"]),
    deploy: new Set(["cloudformation:update-termination-protection", "cloudformation:create-change-set", "cloudformation:describe-change-set",
      "cloudformation:execute-change-set", "cloudformation:get-template", "cloudformation:describe-stacks", "s3api:get-object"]),
    publisher: new Set(["s3api:put-object", "s3api:get-object"]),
  };
  const name = `thn-permissions-${config.runId}-${config.runAttempt}`;
  const keyPattern = new RegExp(`^thn-permissions/${config.runId}/${config.runAttempt}/${config.sourceSha}/[a-f0-9]{64}\\.json$`);
  const changeArn = value => typeof value === "string" && new RegExp(`^arn:aws:cloudformation:${REGION}:${config.account}:changeSet/${name}/[A-Za-z0-9-]+$`).test(value);
  return (kind, service, action, input, outputFile) => {
    try {
      if (!allowed[kind]?.has(`${service}:${action}`) || !object(input)) fail();
      if (service === "cloudformation") {
        const keys = {
          "describe-stacks": ["StackName"],
          "describe-stack-resource": ["StackName", "LogicalResourceId"],
          "get-template": ["StackName", "TemplateStage", ...(input.ChangeSetName === undefined ? [] : ["ChangeSetName"])],
          "describe-change-set": ["StackName", "ChangeSetName", "IncludePropertyValues"],
          "update-termination-protection": ["StackName", "EnableTerminationProtection"],
          "create-change-set": ["StackName", "ChangeSetName", "ChangeSetType", "TemplateURL", "RoleARN", "Parameters", "Capabilities", "IncludeNestedStacks", "ClientToken"],
          "execute-change-set": ["StackName", "ChangeSetName", "ClientRequestToken"],
        }[action];
        if (!keys || !exactKeys(input, keys)) fail();
        if (input.StackName !== STACK && sha(input.StackName || "") !== anchors.stacks["operator-role"]) fail();
        if (input.ChangeSetName !== undefined && input.ChangeSetName !== name && !changeArn(input.ChangeSetName)) fail();
        if (action === "update-termination-protection" && (!exactKeys(input, ["StackName", "EnableTerminationProtection"])
          || input.EnableTerminationProtection !== true || sha(input.StackName) !== anchors.stacks["operator-role"])) fail();
        if (action === "describe-stack-resource" && !logicals.includes(input.LogicalResourceId)) fail();
        if (action === "describe-change-set" && input.IncludePropertyValues !== true) fail();
        if (action === "get-template" && !["Original", "Processed"].includes(input.TemplateStage)) fail();
        if (action === "create-change-set" && (input.ChangeSetType !== "UPDATE" || input.RoleARN !== authority.cfn
          || input.ChangeSetName !== name || input.ClientToken !== name || input.IncludeNestedStacks !== false
          || sha(input.StackName) !== anchors.stacks["operator-role"] || !same(input.Capabilities, ["CAPABILITY_NAMED_IAM"])
          || typeof input.TemplateURL !== "string" || !input.TemplateURL.startsWith(`https://${authority.bucket}.s3.${REGION}.amazonaws.com/`)
          || !keyPattern.test(input.TemplateURL.split(".amazonaws.com/")[1] || "")
          || !Array.isArray(input.Parameters) || input.Parameters.some(p => !exactKeys(p, ["ParameterKey", "UsePreviousValue"])
            || typeof p.ParameterKey !== "string" || !p.ParameterKey || p.UsePreviousValue !== true)
          || new Set(input.Parameters.map(p => p.ParameterKey)).size !== input.Parameters.length)) fail();
        if (action === "execute-change-set" && (!changeArn(input.ChangeSetName) || input.ClientRequestToken !== name
          || sha(input.StackName) !== anchors.stacks["operator-role"])) fail();
      }
      if (service === "iam" && (!exactKeys(input, action === "get-role-policy" ? ["RoleName", "PolicyName"] : ["RoleName"])
        || (action === "get-role-policy" && (typeof input.PolicyName !== "string" || !/^[\w+=,.@-]{1,128}$/.test(input.PolicyName)))
        || (!Object.values(TARGETS).includes(input.RoleName)
          && !(action === "get-role" && input.RoleName === authority.cfn.split("/").at(-1))))) fail();
      if (service === "kms" && (!exactKeys(input, ["KeyId"]) || action !== "describe-key" || input.KeyId !== "alias/aws/s3")) fail();
      if (service === "s3api") {
        const keys = ["Bucket", "ExpectedBucketOwner", ...(["put-object", "get-object"].includes(action) ? ["Key"] : []),
          ...(action === "put-object" ? ["Body", "IfNoneMatch", "ServerSideEncryption", "SSEKMSKeyId", "ChecksumSHA256"] : []),
          ...(action === "get-object" ? ["ChecksumMode"] : [])];
        if (!exactKeys(input, keys)) fail();
        if (input.Bucket !== authority.bucket || input.ExpectedBucketOwner !== config.account) fail();
        if (["put-object", "get-object"].includes(action) && !keyPattern.test(input.Key || "")) fail();
        if (action === "get-object" && (input.ChecksumMode !== "ENABLED" || !path.isAbsolute(outputFile || ""))) fail();
        if (action === "put-object" && (input.IfNoneMatch !== "*" || input.ServerSideEncryption !== "aws:kms"
          || sha(input.SSEKMSKeyId || "") !== anchors.kmsKey || !path.isAbsolute(input.Body || "")
          || input.ChecksumSHA256 !== Buffer.from(input.Key.split("/").at(-1).slice(0, -5), "hex").toString("base64"))) fail();
      }
      if (!sessions.has(kind)) {
        config.authenticate();
        const sessionName = `thn-permissions-${kind}-${config.runId}-${config.runAttempt}`;
        const result = aws("sts", "assume-role", { RoleArn: authority[kind], RoleSessionName: sessionName, DurationSeconds: 3600 }, env);
        const credentials = result.Credentials, expiration = Date.parse(credentials?.Expiration);
        if (result.AssumedRoleUser?.Arn !== `arn:aws:sts::${config.account}:assumed-role/${authority[kind].split("/").at(-1)}/${sessionName}`
          || !/^ASIA[A-Z0-9]{16}$/.test(credentials?.AccessKeyId) || typeof credentials.SecretAccessKey !== "string" || credentials.SecretAccessKey.length < 20
          || typeof credentials.SessionToken !== "string" || !credentials.SessionToken || !Number.isFinite(expiration)
          || expiration <= Date.now() || expiration > Date.now() + 3600000) fail();
        const isolated = { ...env, AWS_ACCESS_KEY_ID: credentials.AccessKeyId, AWS_SECRET_ACCESS_KEY: credentials.SecretAccessKey,
          AWS_SESSION_TOKEN: credentials.SessionToken, AWS_REGION: REGION, AWS_DEFAULT_REGION: REGION };
        for (const key of ["AWS_PROFILE", "AWS_DEFAULT_PROFILE", "AWS_WEB_IDENTITY_TOKEN_FILE", "AWS_ROLE_ARN", "AWS_ROLE_SESSION_NAME"]) delete isolated[key];
        sessions.set(kind, { env: isolated, expiration });
      }
      if (sessions.get(kind).expiration <= Date.now()) fail();
      if (["put-object", "create-change-set", "execute-change-set", "update-termination-protection"].includes(action)) config.authenticate();
      return aws(service, action, input, sessions.get(kind).env, outputFile);
    } catch { fail(); }
  };
}

function resolvedPolicy(document, account) {
  if (Array.isArray(document)) return document.map(value => resolvedPolicy(value, account));
  if (object(document)) {
    if (Object.hasOwn(document, "Fn::Sub")) {
      if (!exactKeys(document, ["Fn::Sub"]) || typeof document["Fn::Sub"] !== "string") fail();
      const value = document["Fn::Sub"].replaceAll("${AWS::Partition}", "aws").replaceAll("${AWS::Region}", REGION).replaceAll("${AWS::AccountId}", account);
      if (value.includes("${")) fail();
      return value;
    }
    return Object.fromEntries(Object.entries(document).map(([key, value]) => [key, resolvedPolicy(value, account)]));
  }
  return document;
}

async function executePermissions(ledger, authority, config) {
  validateLedger(jsonBytes(ledger), config.ledgerSha256, config);
  config.authenticate();
  const client = createClients(authority, config), anchors = config.anchors || ANCHORS;
  const readStack = (updating = false) => {
    const stacks = client("lookup", "cloudformation", "describe-stacks", { StackName: STACK }).Stacks;
    const stack = stacks?.[0];
    if (stacks?.length !== 1 || stack.StackName !== STACK || sha(stack.StackId || "") !== ledger.stackIdSha256
      || stack.RoleARN !== authority.cfn || !new RegExp(`^arn:aws:cloudformation:${REGION}:${config.account}:stack/${STACK}/[A-Za-z0-9-]+$`).test(stack.StackId)
      || !(updating ? ["UPDATE_COMPLETE", "UPDATE_IN_PROGRESS", "UPDATE_COMPLETE_CLEANUP_IN_PROGRESS"]
        : ["CREATE_COMPLETE", "UPDATE_COMPLETE", "UPDATE_ROLLBACK_COMPLETE"]).includes(stack.StackStatus)) fail();
    return stack;
  };
  const stack = readStack(), stackId = stack.StackId, previousParameters = parametersSnapshot(stack.Parameters || []);
  const readTemplate = (stage, changeSet, kind = "lookup") => {
    const response = client(kind, "cloudformation", "get-template", { StackName: stackId, TemplateStage: stage,
      ...(changeSet ? { ChangeSetName: changeSet } : {}) });
    const value = typeof response.TemplateBody === "string" ? JSON.parse(response.TemplateBody) : response.TemplateBody;
    if (!object(value) || !object(value.Resources)) fail();
    return value;
  };
  const original = readTemplate("Original"), processed = readTemplate("Processed");
  if (sha(canonical(original)) !== ledger.originalTemplateSha256 || sha(canonical(processed)) !== ledger.processedTemplateSha256
    || !same(previousParameters.map(p => p.ParameterKey).sort(), Object.keys(original.Parameters || {}).sort())) fail();
  const prepared = composeTemplate(original), preparedProcessed = composeTemplate(processed), body = Buffer.from(canonical(prepared));
  if (body.length > 1024 * 1024 || sha(body) !== ledger.composedTemplateSha256
    || sha(canonical(preparedProcessed)) !== ledger.composedProcessedTemplateSha256) fail();
  const policies = supplementalResources();
  const checkRoles = (final = false) => {
    for (const logical of logicals) {
      const RoleName = TARGETS[logical], input = { RoleName };
      const Role = client("lookup", "iam", "get-role", input).Role;
      const inlineNames = client("lookup", "iam", "list-role-policies", input);
      const attached = client("lookup", "iam", "list-attached-role-policies", input);
      if (inlineNames.IsTruncated || attached.IsTruncated || !Array.isArray(inlineNames.PolicyNames)
        || inlineNames.PolicyNames.length !== (final ? 2 : 1) || new Set(inlineNames.PolicyNames).size !== inlineNames.PolicyNames.length
        || inlineNames.PolicyNames.includes(POLICY_NAME) !== final || attached.AttachedPolicies?.length !== 0) fail();
      const inline = {};
      for (const PolicyName of inlineNames.PolicyNames) {
        const result = client("lookup", "iam", "get-role-policy", { RoleName, PolicyName });
        if (result.RoleName !== RoleName || result.PolicyName !== PolicyName || !object(result.PolicyDocument)) fail();
        inline[PolicyName] = result.PolicyDocument;
      }
      const document = resolvedPolicy(policies[logical].Properties.PolicyDocument, config.account);
      if (final) {
        if (!same(inline[POLICY_NAME], document)) fail();
        delete inline[POLICY_NAME];
      }
      const snapshot = roleSnapshot({ Role, inline, attached: attached.AttachedPolicies }, RoleName, config.account);
      if (sha(canonical(snapshot)) !== ledger.roleBaselinesSha256[logical]) fail();
      const total = [...Object.values(inline), document].reduce((sum, value) => sum + JSON.stringify(value).replace(/\s/g, "").length, 0);
      if (total > 10240) fail();
    }
  };
  const checkBaseline = () => {
    config.authenticate();
    const current = readStack();
    if (current.StackId !== stackId || !same(parametersSnapshot(current.Parameters || []), previousParameters)
      || sha(canonical(readTemplate("Original"))) !== ledger.originalTemplateSha256
      || sha(canonical(readTemplate("Processed"))) !== ledger.processedTemplateSha256) fail();
    checkRoles();
    return current;
  };
  checkBaseline();
  const bucketInput = { Bucket: authority.bucket, ExpectedBucketOwner: config.account };
  const acl = client("lookup", "s3api", "get-bucket-acl", bucketInput);
  if (!acl.Owner?.ID || acl.Grants?.length !== 1 || acl.Grants[0].Grantee?.ID !== acl.Owner.ID || acl.Grants[0].Permission !== "FULL_CONTROL") fail();
  const policy = client("lookup", "s3api", "get-bucket-policy", bucketInput);
  if (sha(canonical(JSON.parse(policy.Policy))) !== anchors.bucketPolicy) fail();
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
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "thn-permission-template-"));
  try {
    const localTemplate = path.join(directory, "template.json"), readback = path.join(directory, "readback.json");
    fs.writeFileSync(localTemplate, body, { flag: "wx", mode: 0o600 });
    const objectKey = `thn-permissions/${config.runId}/${config.runAttempt}/${config.sourceSha}/${ledger.composedTemplateSha256}.json`;
    const objectInput = { ...bucketInput, Key: objectKey }, checksum = Buffer.from(ledger.composedTemplateSha256, "hex").toString("base64");
    checkBaseline();
    client("publisher", "s3api", "put-object", { ...objectInput, Body: localTemplate, IfNoneMatch: "*", ServerSideEncryption: "aws:kms",
      SSEKMSKeyId: key.Arn, ChecksumSHA256: checksum });
    const verifyObject = kind => {
      const metadata = client(kind, "s3api", "get-object", { ...objectInput, ChecksumMode: "ENABLED" }, readback);
      if (metadata.ServerSideEncryption !== "aws:kms" || metadata.SSEKMSKeyId !== key.Arn || metadata.ChecksumSHA256 !== checksum
        || sha(fs.readFileSync(readback)) !== ledger.composedTemplateSha256) fail();
    };
    verifyObject("publisher");
    const name = `thn-permissions-${config.runId}-${config.runAttempt}`;
    checkBaseline();
    const created = client("deploy", "cloudformation", "create-change-set", { StackName: stackId, ChangeSetName: name,
      ChangeSetType: "UPDATE", TemplateURL: `https://${authority.bucket}.s3.${REGION}.amazonaws.com/${objectKey}`,
      RoleARN: authority.cfn, Parameters: Object.keys(original.Parameters || {}).sort().map(ParameterKey => ({ ParameterKey, UsePreviousValue: true })),
      Capabilities: ["CAPABILITY_NAMED_IAM"], IncludeNestedStacks: false, ClientToken: name });
    if (created.StackId !== stackId || !new RegExp(`^arn:aws:cloudformation:${REGION}:${config.account}:changeSet/${name}/[A-Za-z0-9-]+$`).test(created.Id || "")) fail();
    const changeInput = { StackName: stackId, ChangeSetName: created.Id, IncludePropertyValues: true };
    const waitFor = async (read, ready) => {
      for (let attempt = 0; attempt < (config.maxPolls || 180); attempt++) {
        const value = read();
        if (ready(value)) return value;
        await (config.delay || (() => new Promise(resolve => setTimeout(resolve, 10000))))();
      }
      fail();
    };
    await waitFor(() => client("deploy", "cloudformation", "describe-change-set", changeInput), value => {
      if (!["CREATE_PENDING", "CREATE_IN_PROGRESS", "CREATE_COMPLETE"].includes(value.Status)) fail();
      return value.Status === "CREATE_COMPLETE";
    });
    const review = () => reviewChangeSet(client("deploy", "cloudformation", "describe-change-set", changeInput),
      readTemplate("Original", created.Id, "deploy"), readTemplate("Processed", created.Id, "deploy"), {
        account: config.account, stackId, name, id: created.Id, original: prepared, processed: preparedProcessed, previousParameters });
    review();
    if (checkBaseline().EnableTerminationProtection !== true) fail();
    verifyObject("publisher");
    verifyObject("deploy");
    review();
    if (checkBaseline().EnableTerminationProtection !== true) fail();
    client("deploy", "cloudformation", "execute-change-set", { StackName: stackId, ChangeSetName: created.Id, ClientRequestToken: name });
    await waitFor(() => client("deploy", "cloudformation", "describe-change-set", changeInput), value => {
      if (!["EXECUTE_IN_PROGRESS", "EXECUTE_COMPLETE"].includes(value.ExecutionStatus) || value.Status === "FAILED") fail();
      return value.ExecutionStatus === "EXECUTE_COMPLETE";
    });
    const finalStack = await waitFor(() => readStack(true), value => value.StackStatus === "UPDATE_COMPLETE");
    if (finalStack.EnableTerminationProtection !== true || !same(parametersSnapshot(finalStack.Parameters || []), previousParameters)
      || !same(readTemplate("Original"), prepared) || !same(readTemplate("Processed"), preparedProcessed)) fail();
    for (const logical of logicals) {
      const resource = client("lookup", "cloudformation", "describe-stack-resource", { StackName: stackId, LogicalResourceId: logical }).StackResourceDetail;
      if (resource?.StackId !== stackId || resource.StackName !== STACK || resource.LogicalResourceId !== logical
        || resource.ResourceType !== "AWS::IAM::RolePolicy" || resource.ResourceStatus !== "CREATE_COMPLETE" || !resource.PhysicalResourceId) fail();
    }
    checkRoles(true);
    return { status: "verified", addedPolicies: 3, originalRolesPreserved: true, terminationProtection: true,
      stackIdSha256: ledger.stackIdSha256, templateSha256: ledger.composedTemplateSha256 };
  } finally {
    if (path.dirname(directory) !== os.tmpdir() || !path.basename(directory).startsWith("thn-permission-template-")) fail();
    fs.rmSync(directory, { recursive: true });
  }
}

async function runPermissions(ledger, authority, config) {
  try { return await executePermissions(ledger, authority, config); } catch { fail(); }
}

async function main(args, env = process.env) {
  if (args.length !== 2 || !["prepare", "verify", "run"].includes(args[0]) || env.GITHUB_ACTIONS !== "true"
    || env.GITHUB_EVENT_NAME !== "workflow_dispatch" || env.GITHUB_REF !== "refs/heads/test"
    || env.GITHUB_REPOSITORY !== "LynxPardelle/zoolandingpage-aws-infra" || env.APPROVE_EXACT_PERMISSIONS !== "true") fail();
  const [mode, directory] = args;
  const authority = mode === "prepare" ? deriveAuthority("operator-role") : JSON.parse(fs.readFileSync(path.join(directory, "authority.json")));
  const config = { account: authority.account, sourceSha: env.GITHUB_SHA, runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT, env };
  if (mode === "prepare") {
    const encoded = env.REVIEWED_LEDGER_BASE64;
    if (typeof encoded !== "string" || encoded.length > 16384 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) fail();
    const raw = Buffer.from(encoded, "base64");
    if (raw.toString("base64") !== encoded) fail();
    return writeTransport(directory, raw, env.REVIEWED_LEDGER_SHA256, authority, config);
  }
  const authenticate = () => verifyTransport(directory, env.EXPECTED_PERMISSIONS_MANIFEST_SHA256, config);
  const artifact = authenticate();
  if (mode === "verify") return { status: "verified", cloudCalls: 0, addedPolicies: 3 };
  const caller = awsCli("sts", "get-caller-identity", {}, env);
  if (caller.Account !== config.account || !new RegExp(`^arn:aws:sts::${config.account}:assumed-role/[A-Za-z0-9+=,.@_-]+/[A-Za-z0-9+=,.@_-]+$`).test(caller.Arn || "")) fail();
  return runPermissions(artifact.ledger, artifact.authority, { ...config, authenticate, ledgerSha256: artifact.coordinates.ledgerSha256 });
}

if (require.main === module) {
  main(process.argv.slice(2)).then(result => process.stdout.write(JSON.stringify(result) + "\n"))
    .catch(() => { process.stderr.write('{"status":"blocked","reason":"thn_permission_guard_failed","reconciliationRequired":true}\n'); process.exitCode = 1; });
}
module.exports = { composeTemplate, validateLedger, parametersSnapshot, reviewChangeSet, roleSnapshot,
  writeTransport, verifyTransport, createClients, resolvedPolicy, runPermissions, main };
