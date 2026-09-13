"use strict";
// Independent revision path. Never dispatch the initial-only three-policy tool.
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const prerequisite = require("./thn-test-prerequisites");
const policy = require("./thn-test-recovery-permission-policy");
const { sha, canonical, ANCHORS, OPERATIONS } = prerequisite;
const fail = () => { throw new Error("thn_recovery_permission_guard_failed"); };
const object = v => v !== null && typeof v === "object" && !Array.isArray(v);
const same = (a, b) => canonical(a) === canonical(b);
const keys = (v, expected) => object(v) && same(Object.keys(v).sort(), [...expected].sort());
const hash = v => sha(canonical(v));
const digest = v => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
function target(service) { if (!Object.hasOwn(policy.TARGETS, service)) fail(); return policy.TARGETS[service]; }

function validateLedger(ledger, config) {
  const selected = target(config.service), anchors = config.authorityAnchors || ANCHORS;
  const hashes = ["ownerStackSha256", "serviceStackSha256", "bindingSha256", "originalSha256", "processedSha256",
    "composedSha256", "composedProcessedSha256", "roleSha256", "resolvedPolicySha256"];
  if (!keys(ledger, ["schemaVersion", "service", "environment", "domain", "sourceSha", ...hashes])
    || hash(ledger) !== config.expectedLedgerSha256 || ledger.schemaVersion !== 1 || ledger.service !== config.service
    || ledger.environment !== "test" || ledger.domain !== "thehairnarrative.com"
    || !/^[a-f0-9]{40}$/.test(ledger.sourceSha) || ledger.sourceSha !== config.sourceSha
    || !/^[0-9]{12}$/.test(config.account) || sha(config.account) !== anchors.account
    || ledger.ownerStackSha256 !== anchors.stacks[selected.owner] || hashes.some(k => !digest(ledger[k]))) fail();
  return ledger;
}

function prepareRevision(original, processed, binding, ledger, config) {
  validateLedger(ledger, config);
  const values = policy.validateBindings(binding, { ...config, expectedBindingSha256: ledger.bindingSha256,
    expectedStackSha256: ledger.serviceStackSha256 });
  if (hash(original) !== ledger.originalSha256 || hash(processed) !== ledger.processedSha256) fail();
  const prepared = policy.composeTemplate(original, config.service), native = policy.composeTemplate(processed, config.service);
  const document = policy.resolve(policy.policyResource(config.service).Properties.PolicyDocument, values);
  if (hash(prepared) !== ledger.composedSha256 || hash(native) !== ledger.composedProcessedSha256
    || hash(document) !== ledger.resolvedPolicySha256) fail();
  const parameters = [...Object.keys(original.Parameters || {}).sort().map(ParameterKey => ({ ParameterKey, UsePreviousValue: true })),
    ...Object.keys(values).sort().map(ParameterKey => ({ ParameterKey, ParameterValue: values[ParameterKey] }))];
  return { original: prepared, processed: native, parameters, document };
}

function parametersSnapshot(parameters) {
  if (!Array.isArray(parameters) || new Set(parameters.map(p => p.ParameterKey)).size !== parameters.length
    || parameters.some(p => !object(p) || typeof p.ParameterKey !== "string" || typeof p.ParameterValue !== "string"
      || Object.keys(p).some(k => !["ParameterKey", "ParameterValue", "ResolvedValue"].includes(k)))) fail();
  return structuredClone(parameters).sort((a, b) => a.ParameterKey.localeCompare(b.ParameterKey));
}

function reviewChangeSet(description, original, processed, expected) {
  const selected = target(expected.config.service), name = `thn-recovery-permissions-${expected.config.service}-${expected.config.runId}-${expected.config.runAttempt}`;
  if (description.StackName !== OPERATIONS[selected.owner].stack || description.StackId !== expected.stackId
    || description.ChangeSetName !== expected.name || expected.name !== name || description.ChangeSetId !== expected.id
    || !new RegExp(`^arn:aws:cloudformation:us-east-1:${expected.config.account}:changeSet/${name}/[A-Za-z0-9-]+$`).test(description.ChangeSetId)
    || (description.RoleARN !== undefined && description.RoleARN !== expected.authority.cfn)
    || description.Status !== "CREATE_COMPLETE" || description.ExecutionStatus !== "AVAILABLE" || description.NextToken
    || description.IncludeNestedStacks === true || (description.ChangeSetType !== undefined && description.ChangeSetType !== "UPDATE")
    || !same(original, expected.original) || !same(processed, expected.processed)
    || !Array.isArray(description.Changes) || description.Changes.length !== 1) fail();
  const change = description.Changes[0], r = change.ResourceChange;
  if (change.Type !== "Resource" || r?.Action !== "Add" || r.ResourceType !== "AWS::IAM::RolePolicy"
    || r.LogicalResourceId !== selected.logical || ![undefined, "False"].includes(r.Replacement)
    || r.PhysicalResourceId || r.ChangeSetId || r.ModuleInfo) fail();
  const definitions = policy.parameterDefinitions(expected.config.service);
  if (!Array.isArray(description.Parameters)
    || !same(description.Parameters.map(p => p.ParameterKey).sort(), Object.keys(original.Parameters || {}).sort())) fail();
  const previous = parametersSnapshot(expected.previousParameters);
  for (const parameter of description.Parameters) {
    if (Object.hasOwn(definitions, parameter.ParameterKey)) {
      if (!same(parameter, { ParameterKey: parameter.ParameterKey, ParameterValue: "****" })) fail();
    } else {
      const old = previous.find(p => p.ParameterKey === parameter.ParameterKey);
      if (!old || Object.keys(parameter).some(k => !["ParameterKey", "ParameterValue", "ResolvedValue", "UsePreviousValue"].includes(k))
        || (parameter.UsePreviousValue !== undefined && parameter.UsePreviousValue !== true)
        || (parameter.ParameterValue === undefined ? parameter.UsePreviousValue !== true : parameter.ParameterValue !== old.ParameterValue)
        || parameter.ResolvedValue !== old.ResolvedValue) fail();
    }
  }
}

const FILES = ["authority.json", "coordinates.json", "ledger.json", "thn-test-recovery-permissions.js",
  "thn-test-recovery-permission-policy.js", "thn-test-api-runtime-permission-policy.js", "thn-test-auth-provision-permission-policy.js", "thn-test-prerequisites.js"];
const bytes = value => Buffer.from(canonical(value));
const authorityConfig = config => ({ ...config, anchors: config.authorityAnchors || ANCHORS });
function validateAuthority(authority, config) {
  return prerequisite.validateAuthority(authority, target(config.service).owner, authorityConfig(config));
}

function writeTransport(directory, ledger, authority, config) {
  validateLedger(ledger, config); validateAuthority(authority, config);
  if (fs.existsSync(directory) || !/^[1-9][0-9]*$/.test(config.runId) || !/^[1-9][0-9]*$/.test(config.runAttempt)) fail();
  const content = { "authority.json": bytes(authority), "ledger.json": bytes(ledger), "coordinates.json": bytes({
    sourceSha: config.sourceSha, service: config.service, runId: config.runId, runAttempt: config.runAttempt,
    expectedLedgerSha256: config.expectedLedgerSha256 }) };
  for (const name of FILES.filter(n => n.endsWith(".js"))) content[name] = fs.readFileSync(path.join(__dirname, name));
  fs.mkdirSync(directory, { mode: 0o700 });
  for (const name of FILES) fs.writeFileSync(path.join(directory, name), content[name], { flag: "wx", mode: 0o600 });
  const manifest = Buffer.from(FILES.map(n => `${sha(content[n])}  ${n}\n`).join(""));
  fs.writeFileSync(path.join(directory, "manifest.sha256"), manifest, { flag: "wx", mode: 0o600 });
  return { manifestSha256: sha(manifest) };
}

function verifyTransport(directory, expectedSha256, config) {
  try {
    const info = fs.lstatSync(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || !digest(expectedSha256)
      || !same(fs.readdirSync(directory).sort(), [...FILES, "manifest.sha256"].sort())) fail();
    const content = {};
    for (const name of [...FILES, "manifest.sha256"]) {
      const file = path.join(directory, name), stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024) fail();
      content[name] = fs.readFileSync(file);
    }
    if (sha(content["manifest.sha256"]) !== expectedSha256 || !content["manifest.sha256"].equals(
      Buffer.from(FILES.map(n => `${sha(content[n])}  ${n}\n`).join("")))) fail();
    const coordinates = JSON.parse(content["coordinates.json"]);
    if (!same(coordinates, { sourceSha: config.sourceSha, service: config.service, runId: config.runId,
      runAttempt: config.runAttempt, expectedLedgerSha256: config.expectedLedgerSha256 })) fail();
    const ledger = validateLedger(JSON.parse(content["ledger.json"]), config);
    const authority = validateAuthority(JSON.parse(content["authority.json"]), config);
    return { ledger, authority };
  } catch { fail(); }
}

function createClients(authority, binding, ledger, config) {
  validateLedger(ledger, config); validateAuthority(authority, config);
  const values = policy.validateBindings(binding, { ...config, expectedBindingSha256: ledger.bindingSha256,
    expectedStackSha256: ledger.serviceStackSha256 });
  if (typeof config.authenticate !== "function" || !/^[1-9][0-9]*$/.test(config.runId) || !/^[1-9][0-9]*$/.test(config.runAttempt)) fail();
  const selected = target(config.service), env = config.env || process.env, aws = config.aws || prerequisite.awsCli;
  const sessions = new Map(), name = `thn-recovery-permissions-${config.service}-${config.runId}-${config.runAttempt}`;
  const templateKey = `thn-recovery-permissions/${config.service}/${config.runId}/${config.runAttempt}/${config.sourceSha}/${ledger.composedSha256}.json`;
  const changeArn = value => typeof value === "string" && new RegExp(`^arn:aws:cloudformation:us-east-1:${config.account}:changeSet/${name}/[A-Za-z0-9-]+$`).test(value);
  const allowed = {
    lookup: ["cloudformation:describe-stacks", "cloudformation:get-template", "cloudformation:describe-stack-resource",
      "iam:get-role", "iam:list-role-policies", "iam:get-role-policy", "iam:list-attached-role-policies",
      "s3api:head-object", "s3api:get-bucket-acl", "s3api:get-bucket-policy", "s3api:get-bucket-encryption", "kms:describe-key"],
    deploy: ["cloudformation:create-change-set", "cloudformation:describe-change-set", "cloudformation:execute-change-set",
      "cloudformation:get-template", "cloudformation:describe-stacks", "s3api:get-object"],
    publisher: ["s3api:put-object", "s3api:get-object"],
  };
  return (kind, service, action, input, outputFile) => {
    try {
      if (!allowed[kind]?.includes(`${service}:${action}`) || !object(input)) fail();
      if (service === "cloudformation") {
        const owner = input.StackName === authority.stackName || sha(input.StackName || "") === ledger.ownerStackSha256;
        const serviceRead = input.StackName === binding.stackId && kind === "lookup" &&
          (["describe-stacks", "describe-stack-resource"].includes(action) ||
            (config.service === "auth-provision" && action === "get-template" && input.TemplateStage === "Original" && input.ChangeSetName === undefined));
        if (!owner && !serviceRead) fail();
        const expectedKeys = {
          "describe-stacks": ["StackName"], "describe-stack-resource": ["StackName", "LogicalResourceId"],
          "get-template": ["StackName", "TemplateStage", ...(input.ChangeSetName === undefined ? [] : ["ChangeSetName"])],
          "describe-change-set": ["StackName", "ChangeSetName", "IncludePropertyValues"],
          "create-change-set": ["StackName", "ChangeSetName", "ChangeSetType", "TemplateURL", "RoleARN", "Parameters", "Capabilities", "IncludeNestedStacks", "ClientToken"],
          "execute-change-set": ["StackName", "ChangeSetName", "ClientRequestToken"],
        }[action];
        if (!expectedKeys || !keys(input, expectedKeys)) fail();
        if (input.ChangeSetName !== undefined && input.ChangeSetName !== name && !changeArn(input.ChangeSetName)) fail();
        if (action === "get-template" && !["Original", "Processed"].includes(input.TemplateStage)) fail();
        if (action === "describe-change-set" && input.IncludePropertyValues !== true) fail();
        if (action === "describe-stack-resource" && !(serviceRead ? (config.service === "api-runtime" ? ["ApiProxyApi"] : policy.functionNames(config.service)) : [selected.logical]).includes(input.LogicalResourceId)) fail();
        if (action === "create-change-set") {
          if (sha(input.StackName) !== ledger.ownerStackSha256 || input.RoleARN !== authority.cfn || input.ChangeSetType !== "UPDATE"
            || input.ChangeSetName !== name || input.ClientToken !== name || input.IncludeNestedStacks !== false
            || !same(input.Capabilities, ["CAPABILITY_NAMED_IAM"])
            || input.TemplateURL !== `https://${authority.bucket}.s3.us-east-1.amazonaws.com/${templateKey}`
            || !Array.isArray(input.Parameters) || new Set(input.Parameters.map(p => p.ParameterKey)).size !== input.Parameters.length) fail();
          const supplied = {};
          for (const p of input.Parameters) {
            if (Object.hasOwn(values, p.ParameterKey)) {
              if (!keys(p, ["ParameterKey", "ParameterValue"]) || p.ParameterValue !== values[p.ParameterKey]) fail();
              supplied[p.ParameterKey] = p.ParameterValue;
            } else if (!keys(p, ["ParameterKey", "UsePreviousValue"]) || typeof p.ParameterKey !== "string" || p.UsePreviousValue !== true) fail();
          }
          if (!same(supplied, values)) fail();
        }
        if (action === "execute-change-set" && (sha(input.StackName) !== ledger.ownerStackSha256
          || !changeArn(input.ChangeSetName) || input.ClientRequestToken !== name)) fail();
      }
      if (service === "iam" && (!keys(input, action === "get-role-policy" ? ["RoleName", "PolicyName"] : ["RoleName"])
        || ![selected.role, ...(action === "get-role" ? [authority.cfn.split("/").at(-1)] : [])].includes(input.RoleName)
        || (action === "get-role-policy" && !/^[\w+=,.@-]{1,128}$/.test(input.PolicyName)))) fail();
      if (service === "kms" && (!keys(input, ["KeyId"]) || input.KeyId !== "alias/aws/s3")) fail();
      if (service === "s3api") {
        if (action === "head-object") {
          if (config.service === "auth-provision" || !keys(input, ["Bucket", "Key", "VersionId", "ExpectedBucketOwner"]) || input.ExpectedBucketOwner !== config.account
            || ![binding.package, binding.record].some(o => input.Bucket === o.bucket && input.Key === o.key && input.VersionId === o.versionId)) fail();
        } else {
          const required = ["Bucket", "ExpectedBucketOwner", ...(["put-object", "get-object"].includes(action) ? ["Key"] : []),
            ...(action === "put-object" ? ["Body", "IfNoneMatch", "ServerSideEncryption", "SSEKMSKeyId", "ChecksumSHA256"] : []),
            ...(action === "get-object" ? ["ChecksumMode"] : [])];
          if (!keys(input, required) || input.Bucket !== authority.bucket || input.ExpectedBucketOwner !== config.account
            || (input.Key !== undefined && input.Key !== templateKey)) fail();
          if (action === "get-object" && (input.ChecksumMode !== "ENABLED" || !path.isAbsolute(outputFile || ""))) fail();
          if (action === "put-object" && (input.IfNoneMatch !== "*" || input.ServerSideEncryption !== "aws:kms"
            || sha(input.SSEKMSKeyId || "") !== (config.authorityAnchors || ANCHORS).kmsKey || !path.isAbsolute(input.Body || "")
            || input.ChecksumSHA256 !== Buffer.from(ledger.composedSha256, "hex").toString("base64")
            || sha(fs.readFileSync(input.Body)) !== ledger.composedSha256)) fail();
        }
      }
      if (!sessions.has(kind)) {
        config.authenticate();
        const sessionName = `thn-recovery-${config.service}-${kind}-${config.runId}-${config.runAttempt}`;
        const result = aws("sts", "assume-role", { RoleArn: authority[kind], RoleSessionName: sessionName, DurationSeconds: 3600 }, env);
        const c = result.Credentials, expiration = Date.parse(c?.Expiration);
        if (result.AssumedRoleUser?.Arn !== `arn:aws:sts::${config.account}:assumed-role/${authority[kind].split("/").at(-1)}/${sessionName}`
          || !/^ASIA[A-Z0-9]{16}$/.test(c?.AccessKeyId) || typeof c.SecretAccessKey !== "string" || c.SecretAccessKey.length < 20
          || typeof c.SessionToken !== "string" || !c.SessionToken || !Number.isFinite(expiration)
          || expiration <= Date.now() || expiration > Date.now() + 3600000) fail();
        const isolated = { ...env, AWS_ACCESS_KEY_ID: c.AccessKeyId, AWS_SECRET_ACCESS_KEY: c.SecretAccessKey, AWS_SESSION_TOKEN: c.SessionToken,
          AWS_REGION: "us-east-1", AWS_DEFAULT_REGION: "us-east-1" };
        for (const k of ["AWS_PROFILE", "AWS_DEFAULT_PROFILE", "AWS_WEB_IDENTITY_TOKEN_FILE", "AWS_ROLE_ARN", "AWS_ROLE_SESSION_NAME"]) delete isolated[k];
        sessions.set(kind, { env: isolated, expiration });
      }
      if (sessions.get(kind).expiration <= Date.now()) fail();
      if (["put-object", "create-change-set", "execute-change-set"].includes(action)) config.authenticate();
      return aws(service, action, input, sessions.get(kind).env, outputFile);
    } catch { fail(); }
  };
}

async function executeRevision(ledger, binding, authority, config) {
  if (typeof config.execute !== "boolean") fail();
  const client = createClients(authority, binding, ledger, config), selected = target(config.service);
  const stable = ["CREATE_COMPLETE", "UPDATE_COMPLETE", "UPDATE_ROLLBACK_COMPLETE"];
  const settings = s => ({ RoleARN: s.RoleARN, EnableTerminationProtection: s.EnableTerminationProtection,
    DisableRollback: s.DisableRollback, NotificationARNs: s.NotificationARNs, Tags: s.Tags, Capabilities: s.Capabilities });
  const readStack = (pending = false) => {
    const stacks = client("lookup", "cloudformation", "describe-stacks", { StackName: authority.stackName }).Stacks;
    const value = stacks?.[0];
    if (stacks?.length !== 1 || value.StackName !== authority.stackName || sha(value.StackId || "") !== ledger.ownerStackSha256
      || value.RoleARN !== authority.cfn || value.EnableTerminationProtection !== true
      || ![...stable, ...(pending ? ["UPDATE_IN_PROGRESS", "UPDATE_COMPLETE_CLEANUP_IN_PROGRESS"] : [])].includes(value.StackStatus)) fail();
    return value;
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
  const prepared = prepareRevision(original, processed, binding, ledger, config);
  if (!same(previousParameters.map(p => p.ParameterKey).sort(), Object.keys(original.Parameters || {}).sort())) fail();
  const checkRoles = (final = false) => {
    const RoleName = selected.role, request = { RoleName }, Role = client("lookup", "iam", "get-role", request).Role;
    const names = client("lookup", "iam", "list-role-policies", request), attached = client("lookup", "iam", "list-attached-role-policies", request);
    if (names.IsTruncated || attached.IsTruncated || !Array.isArray(names.PolicyNames)
      || new Set(names.PolicyNames).size !== names.PolicyNames.length || names.PolicyNames.includes(policy.policyName(config.service)) !== final
      || !Array.isArray(attached.AttachedPolicies)) fail();
    const inline = {};
    for (const PolicyName of names.PolicyNames) {
      const result = client("lookup", "iam", "get-role-policy", { RoleName, PolicyName });
      if (result.RoleName !== RoleName || result.PolicyName !== PolicyName || !object(result.PolicyDocument)) fail();
      inline[PolicyName] = result.PolicyDocument;
    }
    if (final) {
      if (!same(inline[policy.policyName(config.service)], prepared.document)) fail();
      delete inline[policy.policyName(config.service)];
    }
    if (hash(policy.roleSnapshot({ Role, inline, attached: attached.AttachedPolicies }, config.service, config.account, prepared.document)) !== ledger.roleSha256) fail();
  };
  const checkService = () => {
    const response = client("lookup", "cloudformation", "describe-stacks", { StackName: binding.stackId }), service = response.Stacks?.[0];
    if (response.Stacks?.length !== 1 || service.StackName !== selected.service || service.StackId !== binding.stackId
      || service.RoleARN || !stable.includes(service.StackStatus)) fail();
    if (config.service === "auth-provision") {
      const parameters = parametersSnapshot(service.Parameters || []);
      if (service.EnableTerminationProtection !== true
        || parameters.some(p =>
        ["EnableThnAuthAdminV2", "ProvisionThnAuthAdminV2State"].includes(p.ParameterKey) && p.ParameterValue !== "false")) fail();
      if (!parameters.some(p => p.ParameterKey === "EnableThnAuthAdminV2")) {
        const body = client("lookup", "cloudformation", "get-template", {StackName: binding.stackId, TemplateStage: "Original"}).TemplateBody;
        const legacy = typeof body === "string" ? JSON.parse(body) : body;
        if (parameters.some(p => p.ParameterKey === "ProvisionThnAuthAdminV2State") || !object(legacy) || !object(legacy.Resources)
          || Object.keys(legacy.Resources).some(k => k.startsWith("Thn"))
          || ["EnableThnAuthAdminV2", "ProvisionThnAuthAdminV2State"].some(k => Object.hasOwn(legacy.Parameters || {}, k))) fail();
      }
    }
    for (const logical of policy.functionNames(config.service)) {
      const r = client("lookup", "cloudformation", "describe-stack-resource", { StackName: binding.stackId, LogicalResourceId: logical }).StackResourceDetail;
      if (r?.StackId !== binding.stackId || r.StackName !== selected.service || r.LogicalResourceId !== logical
        || r.ResourceType !== "AWS::Lambda::Function" || !stable.includes(r.ResourceStatus)
        || `arn:aws:lambda:us-east-1:${config.account}:function:${r.PhysicalResourceId}` !== binding.functions[logical]) fail();
    }
    if (config.service === "api-runtime") {
      const r = client("lookup", "cloudformation", "describe-stack-resource", {StackName: binding.stackId, LogicalResourceId: "ApiProxyApi"}).StackResourceDetail;
      if (r?.StackId !== binding.stackId || r.StackName !== selected.service || r.LogicalResourceId !== "ApiProxyApi"
        || r.ResourceType !== "AWS::ApiGateway::RestApi" || !stable.includes(r.ResourceStatus) || r.PhysicalResourceId !== binding.runtime.apiId) fail();
    }
    // The immutable original selector/version is anchored by the service's
    // byte-verified recovery receipt. This read checks existence/ownership only;
    // it is not a replacement for that driver checking the ZIP bytes.
    for (const object of (config.service === "auth-provision" ? [] : [binding.package, binding.record])) {
      const head = client("lookup", "s3api", "head-object", { Bucket: object.bucket, Key: object.key,
        VersionId: object.versionId, ExpectedBucketOwner: config.account });
      if (head.VersionId !== object.versionId || !Number.isSafeInteger(head.ContentLength) || head.ContentLength < 1) fail();
    }
  };
  const baseline = () => {
    config.authenticate();
    const current = readStack();
    if (!same(settings(current), settings(stack)) || !same(parametersSnapshot(current.Parameters || []), previousParameters)
      || !same(readTemplate("Original"), original) || !same(readTemplate("Processed"), processed)) fail();
    checkRoles(); checkService();
  };
  baseline();
  const receipt = { status: "verified", service: config.service, addedPolicies: 0, originalRolesPreserved: true,
    templateSha256: ledger.composedSha256 };
  if (!config.execute) return receipt;
  const anchors = config.authorityAnchors || ANCHORS, bucket = { Bucket: authority.bucket, ExpectedBucketOwner: config.account };
  const acl = client("lookup", "s3api", "get-bucket-acl", bucket);
  if (!acl.Owner?.ID || acl.Grants?.length !== 1 || acl.Grants[0].Grantee?.ID !== acl.Owner.ID || acl.Grants[0].Permission !== "FULL_CONTROL") fail();
  const existingPolicy = client("lookup", "s3api", "get-bucket-policy", bucket);
  if (hash(JSON.parse(existingPolicy.Policy)) !== anchors.bucketPolicy) fail();
  const encryption = client("lookup", "s3api", "get-bucket-encryption", bucket).ServerSideEncryptionConfiguration;
  const kms = client("lookup", "kms", "describe-key", { KeyId: "alias/aws/s3" }).KeyMetadata;
  if (sha(kms?.Arn || "") !== anchors.kmsKey || kms.KeyManager !== "AWS" || kms.Enabled !== true || kms.KeyState !== "Enabled"
    || encryption?.Rules?.length !== 1 || encryption.Rules[0].ApplyServerSideEncryptionByDefault?.SSEAlgorithm !== "aws:kms"
    || ![undefined, "alias/aws/s3", kms.Arn, kms.KeyId].includes(encryption.Rules[0].ApplyServerSideEncryptionByDefault.KMSMasterKeyID)) fail();
  const executor = client("lookup", "iam", "get-role", { RoleName: authority.cfn.split("/").at(-1) }).Role;
  if (executor?.Arn !== authority.cfn || !same(executor.AssumeRolePolicyDocument, { Version: "2012-10-17", Statement: [
    { Effect: "Allow", Principal: { Service: "cloudformation.amazonaws.com" }, Action: "sts:AssumeRole" }] })) fail();
  const body = bytes(prepared.original);
  if (body.length > 1024 * 1024 || sha(body) !== ledger.composedSha256) fail();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "thn-recovery-permission-"));
  try {
    const template = path.join(directory, "template.json"), readback = path.join(directory, "readback.json");
    fs.writeFileSync(template, body, { flag: "wx", mode: 0o600 });
    const key = `thn-recovery-permissions/${config.service}/${config.runId}/${config.runAttempt}/${config.sourceSha}/${ledger.composedSha256}.json`;
    const object = { ...bucket, Key: key }, checksum = Buffer.from(ledger.composedSha256, "hex").toString("base64");
    baseline();
    client("publisher", "s3api", "put-object", { ...object, Body: template, IfNoneMatch: "*", ServerSideEncryption: "aws:kms",
      SSEKMSKeyId: kms.Arn, ChecksumSHA256: checksum });
    const verifyObject = kind => {
      const metadata = client(kind, "s3api", "get-object", { ...object, ChecksumMode: "ENABLED" }, readback);
      if (metadata.ServerSideEncryption !== "aws:kms" || metadata.SSEKMSKeyId !== kms.Arn || metadata.ChecksumSHA256 !== checksum
        || sha(fs.readFileSync(readback)) !== ledger.composedSha256) fail();
    };
    verifyObject("publisher"); baseline();
    const name = `thn-recovery-permissions-${config.service}-${config.runId}-${config.runAttempt}`;
    const created = client("deploy", "cloudformation", "create-change-set", { StackName: stackId, ChangeSetName: name,
      ChangeSetType: "UPDATE", TemplateURL: `https://${authority.bucket}.s3.us-east-1.amazonaws.com/${key}`,
      RoleARN: authority.cfn, Parameters: prepared.parameters, Capabilities: ["CAPABILITY_NAMED_IAM"], IncludeNestedStacks: false, ClientToken: name });
    if (created.StackId !== stackId || !new RegExp(`^arn:aws:cloudformation:us-east-1:${config.account}:changeSet/${name}/[A-Za-z0-9-]+$`).test(created.Id || "")) fail();
    const input = { StackName: stackId, ChangeSetName: created.Id, IncludePropertyValues: true };
    const wait = async (read, ready) => {
      for (let n = 0; n < (config.maxPolls || 180); n++) {
        const value = read(); if (ready(value)) return value;
        await (config.delay || (() => new Promise(resolve => setTimeout(resolve, 10000))))();
      }
      fail();
    };
    await wait(() => client("deploy", "cloudformation", "describe-change-set", input), d => {
      if (!["CREATE_PENDING", "CREATE_IN_PROGRESS", "CREATE_COMPLETE"].includes(d.Status)) fail();
      return d.Status === "CREATE_COMPLETE";
    });
    const review = () => reviewChangeSet(client("deploy", "cloudformation", "describe-change-set", input),
      readTemplate("Original", created.Id, "deploy"), readTemplate("Processed", created.Id, "deploy"), {
        config, authority, stackId, name, id: created.Id, ...prepared, previousParameters });
    review(); baseline(); verifyObject("publisher"); verifyObject("deploy"); review(); baseline();
    client("deploy", "cloudformation", "execute-change-set", { StackName: stackId, ChangeSetName: created.Id, ClientRequestToken: name });
    await wait(() => client("deploy", "cloudformation", "describe-change-set", input), d => {
      if (d.StackId !== stackId || d.ChangeSetId !== created.Id || d.ChangeSetName !== name || d.Status !== "CREATE_COMPLETE"
        || !["AVAILABLE", "EXECUTE_IN_PROGRESS", "EXECUTE_COMPLETE"].includes(d.ExecutionStatus)) fail();
      return d.ExecutionStatus === "EXECUTE_COMPLETE";
    });
    const final = await wait(() => readStack(true), s => s.StackStatus === "UPDATE_COMPLETE");
    const finalParameters = parametersSnapshot(final.Parameters || []), definitions = policy.parameterDefinitions(config.service);
    if (!same(settings(final), settings(stack)) || !same(readTemplate("Original"), prepared.original)
      || !same(readTemplate("Processed"), prepared.processed)
      || !same(finalParameters.filter(p => !Object.hasOwn(definitions, p.ParameterKey)), previousParameters)
      || !same(finalParameters.filter(p => Object.hasOwn(definitions, p.ParameterKey)),
        Object.keys(definitions).sort().map(ParameterKey => ({ ParameterKey, ParameterValue: "****" })))) fail();
    const r = client("lookup", "cloudformation", "describe-stack-resource", { StackName: stackId, LogicalResourceId: selected.logical }).StackResourceDetail;
    if (r?.StackId !== stackId || r.StackName !== authority.stackName || r.LogicalResourceId !== selected.logical
      || r.ResourceType !== "AWS::IAM::RolePolicy" || r.ResourceStatus !== "CREATE_COMPLETE" || !r.PhysicalResourceId) fail();
    checkRoles(true); checkService();
    return { ...receipt, status: "applied", addedPolicies: 1, noEchoReadbackVerified: true };
  } finally {
    if (path.dirname(directory) !== os.tmpdir() || !path.basename(directory).startsWith("thn-recovery-permission-")) fail();
    fs.rmSync(directory, { recursive: true });
  }
}

async function runRevision(ledger, binding, authority, config) {
  try { return await executeRevision(ledger, binding, authority, config); } catch { fail(); }
}

function privateJson(raw, limit = 16384) {
  if (typeof raw !== "string" || raw.length > limit) fail();
  try {
    const value = JSON.parse(raw);
    // Canonical input also rejects duplicate keys without reflecting the input.
    if (canonical(value) !== raw) fail();
    return value;
  } catch { fail(); }
}

async function main(args, env = process.env) {
  if (args.length !== 2 || !["prepare", "verify", "run"].includes(args[0]) || env.GITHUB_ACTIONS !== "true"
    || env.GITHUB_EVENT_NAME !== "workflow_dispatch" || env.GITHUB_REF !== "refs/heads/test"
    || env.GITHUB_REPOSITORY !== "LynxPardelle/zoolandingpage-aws-infra"
    || !["verify", "execute"].includes(env.RECOVERY_PERMISSION_EXECUTION)
    || (env.RECOVERY_PERMISSION_EXECUTION === "execute" && env.APPROVE_EXACT_RECOVERY_PERMISSIONS !== "true")
    || !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA) || !digest(env.REVIEWED_LEDGER_SHA256)) fail();
  const [mode, directory] = args, selected = target(env.RECOVERY_PERMISSION_SERVICE);
  const authority = mode === "prepare" ? prerequisite.deriveAuthority(selected.owner)
    : JSON.parse(fs.readFileSync(path.join(directory, "authority.json")));
  const config = { account: authority.account, service: env.RECOVERY_PERMISSION_SERVICE, sourceSha: env.GITHUB_SHA,
    runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT, expectedLedgerSha256: env.REVIEWED_LEDGER_SHA256, env };
  if (mode === "prepare") {
    const encoded = env.REVIEWED_LEDGER_BASE64;
    if (typeof encoded !== "string" || encoded.length > 16384 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) fail();
    const raw = Buffer.from(encoded, "base64");
    if (raw.toString("base64") !== encoded || sha(raw) !== config.expectedLedgerSha256) fail();
    return writeTransport(directory, privateJson(raw.toString()), authority, config);
  }
  const authenticate = () => verifyTransport(directory, env.EXPECTED_RECOVERY_MANIFEST_SHA256, config);
  const artifact = authenticate();
  if (mode === "verify") return { status: "verified", cloudCalls: 0, service: config.service };
  for (const key of ["AWS_REGION", "AWS_DEFAULT_REGION"]) if (env[key] !== "us-east-1") fail();
  const binding = privateJson(env.THN_RECOVERY_BINDING_JSON);
  const caller = prerequisite.awsCli("sts", "get-caller-identity", {}, env);
  if (caller.Account !== config.account || !new RegExp(`^arn:aws:sts::${config.account}:assumed-role/[A-Za-z0-9+=,.@_-]+/[A-Za-z0-9+=,.@_-]+$`).test(caller.Arn || "")) fail();
  return runRevision(artifact.ledger, binding, artifact.authority, { ...config, authenticate,
    channelBucket: env.RECOVERY_CHANNEL_BUCKET, execute: env.RECOVERY_PERMISSION_EXECUTION === "execute" });
}

if (require.main === module) {
  main(process.argv.slice(2)).then(result => process.stdout.write(JSON.stringify(result) + "\n"))
    .catch(() => { process.stderr.write('{"status":"blocked","reason":"thn_recovery_permission_guard_failed","reconciliationRequired":true}\n'); process.exitCode = 1; });
}
module.exports = { validateLedger, prepareRevision, parametersSnapshot, reviewChangeSet, writeTransport, verifyTransport, createClients, runRevision, privateJson, main };
