"use strict";
const fs = require("node:fs");
const { TARGETS, POLICY_NAME, supplementalResources } = require("../../tools/thn-test-permission-policy");
const { sha, canonical } = require("../../tools/thn-test-prerequisites");

// Native-shaped responses at the AWS boundary; no network calls or durable
// credentials. Assertions exercise the real composer, clients and runner.
function runnerFixture(data, api, scenario) {
  const { account, authority } = { ...data.config, authority: data.authority };
  const original = structuredClone(data.original), prepared = structuredClone(data.prepared), roles = {}, calls = [];
  for (const [index, [logical, RoleName]] of Object.entries(Object.entries(TARGETS))) {
    roles[RoleName] = { Role: { RoleName, Arn: `arn:aws:iam::${account}:role/${RoleName}`, Path: "/",
      RoleId: "AROA" + String(Number(index) + 1).repeat(17), CreateDate: "2026-01-01T00:00:00Z", MaxSessionDuration: 3600,
      AssumeRolePolicyDocument: { Version: "2012-10-17", Statement: [] }, Tags: [] },
      inline: { Original: { Version: "2012-10-17", Statement: [{ Effect: "Allow", Action: "sts:GetCallerIdentity", Resource: "*" }] } }, attached: [] };
    data.ledger.roleBaselinesSha256[logical] = sha(canonical(api.roleSnapshot(roles[RoleName], RoleName, account)));
  }
  const keyArn = `arn:aws:kms:us-east-1:${account}:key/example-key`;
  const bucketPolicy = { Version: "2012-10-17", Statement: [] };
  data.config.anchors.kmsKey = sha(keyArn);
  data.config.anchors.bucketPolicy = sha(canonical(bucketPolicy));
  let executed = false, protectedStack = false, body;
  const resolve = value => Array.isArray(value) ? value.map(resolve) : value && typeof value === "object"
    ? (value["Fn::Sub"] ? value["Fn::Sub"].replaceAll("${AWS::Partition}", "aws").replaceAll("${AWS::Region}", "us-east-1").replaceAll("${AWS::AccountId}", account)
      : Object.fromEntries(Object.entries(value).map(([key, child]) => [key, resolve(child)]))) : value;
  const aws = (service, action, input, env, outputFile) => {
    calls.push({ service, action, input: structuredClone(input) });
    if (service === "sts") return { AssumedRoleUser: { Arn: `arn:aws:sts::${account}:assumed-role/${input.RoleArn.split("/").at(-1)}/${input.RoleSessionName}` },
      Credentials: { AccessKeyId: "ASIA" + "Q".repeat(16), SecretAccessKey: "S".repeat(40), SessionToken: "fixture-token", Expiration: new Date(Date.now() + 3500000).toISOString() } };
    if (service === "iam") {
      if (input.RoleName === authority.cfn.split("/").at(-1)) return { Role: { Arn: authority.cfn, AssumeRolePolicyDocument:
        { Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: { Service: "cloudformation.amazonaws.com" }, Action: "sts:AssumeRole" }] } } };
      const role = roles[input.RoleName];
      if (!role) throw new Error("unknown role");
      if (action === "get-role") return { Role: structuredClone(role.Role) };
      if (action === "list-role-policies") return { PolicyNames: Object.keys(role.inline), IsTruncated: false };
      if (action === "list-attached-role-policies") return { AttachedPolicies: [], IsTruncated: false };
      if (action === "get-role-policy") return { RoleName: input.RoleName, PolicyName: input.PolicyName, PolicyDocument: structuredClone(role.inline[input.PolicyName]) };
    }
    if (service === "kms") return { KeyMetadata: { Arn: keyArn, KeyId: "example-key", Enabled: true, KeyState: "Enabled", KeyManager: "AWS" } };
    if (service === "s3api") {
      if (action === "get-bucket-acl") return { Owner: { ID: "example-owner" }, Grants: [{ Grantee: { ID: "example-owner" }, Permission: "FULL_CONTROL" }] };
      if (action === "get-bucket-policy") return { Policy: JSON.stringify(bucketPolicy) };
      if (action === "get-bucket-encryption") return { ServerSideEncryptionConfiguration: { Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: "aws:kms", KMSMasterKeyID: "alias/aws/s3" } }] } };
      if (action === "put-object") { body = fs.readFileSync(input.Body); return {}; }
      if (action === "get-object") {
        fs.writeFileSync(outputFile, scenario === "corrupt-object" ? "wrong bytes" : body);
        return { ServerSideEncryption: "aws:kms", SSEKMSKeyId: keyArn, ChecksumSHA256: Buffer.from(sha(body), "hex").toString("base64") };
      }
    }
    if (service === "cloudformation") {
      if (action === "describe-stacks") return { Stacks: [{ StackName: authority.stackName, StackId: data.expected.stackId,
        StackStatus: executed && scenario === "rollback" ? "UPDATE_ROLLBACK_COMPLETE" : "UPDATE_COMPLETE", RoleARN: authority.cfn,
        EnableTerminationProtection: protectedStack, Parameters: structuredClone(data.expected.previousParameters) }] };
      if (action === "get-template") return { TemplateBody: structuredClone(input.ChangeSetName || executed ? prepared : original) };
      if (action === "update-termination-protection") { protectedStack = input.EnableTerminationProtection; return { StackId: data.expected.stackId }; }
      if (action === "create-change-set") return { StackId: data.expected.stackId, Id: data.expected.id };
      if (action === "describe-change-set") {
        const result = structuredClone(data.description);
        if (scenario === "extra-add") result.Changes.push(structuredClone(result.Changes[0]));
        if (scenario === "role-drift") roles[Object.values(TARGETS)[0]].Role.AssumeRolePolicyDocument.Statement.push({ Effect: "Allow", Action: "unapproved" });
        if (executed) result.ExecutionStatus = "EXECUTE_COMPLETE";
        return result;
      }
      if (action === "execute-change-set") {
        executed = true;
        for (const resource of Object.values(supplementalResources())) roles[resource.Properties.RoleName].inline[POLICY_NAME] = resolve(resource.Properties.PolicyDocument);
        if (scenario === "final-policy") roles[Object.values(TARGETS)[0]].inline[POLICY_NAME].Statement = [];
        return {};
      }
      if (action === "describe-stack-resource") return { StackResourceDetail: { StackName: authority.stackName, StackId: data.expected.stackId,
        LogicalResourceId: input.LogicalResourceId, PhysicalResourceId: "owned-policy", ResourceType: "AWS::IAM::RolePolicy", ResourceStatus: "CREATE_COMPLETE" } };
    }
    throw new Error(`Unexpected AWS boundary: ${service}:${action}`);
  };
  return { ...data, calls, config: { ...data.config, aws, authenticate: () => {}, delay: async () => {}, maxPolls: 2,
    ledgerSha256: sha(Buffer.from(JSON.stringify(data.ledger, null, 2) + "\n")) } };
}
module.exports = { runnerFixture };
