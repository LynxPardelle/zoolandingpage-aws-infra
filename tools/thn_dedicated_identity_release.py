"""Guard the three-resource THN TEST identity addition to the bootstrap stack.

This module deliberately has no generic CloudFormation update operation.
"""

from __future__ import annotations

import copy
import base64
import hashlib
import json
import os
import re
import sys
from urllib.parse import quote


GITHUB_ROLE = "ApiProxyThnTestGithubRole812293BE"
EXECUTION_ROLE = "ThnDedicatedRuntimeTestCloudFormationRoleCF799F56"
GITHUB_POLICY = "ThnDedicatedRuntimeTestGithubPolicy"
EXECUTION_POLICY = "ThnDedicatedRuntimeTestExecutionPolicy"
ADDITIONS = {
    EXECUTION_ROLE: "AWS::IAM::Role",
    GITHUB_POLICY: "AWS::IAM::Policy",
    EXECUTION_POLICY: "AWS::IAM::Policy",
}


def _reject() -> None:
    raise ValueError("thn_dedicated_identity_guard_failed")


def _is_object(value: object) -> bool:
    return isinstance(value, dict)


def _validate_additions(additions: dict) -> None:
    if not _is_object(additions) or set(additions) != set(ADDITIONS):
        _reject()
    for logical, resource_type in ADDITIONS.items():
        resource = additions[logical]
        if not _is_object(resource) or resource.get("Type") != resource_type or not _is_object(resource.get("Properties")):
            _reject()
    role = additions[EXECUTION_ROLE]
    if (role.get("DeletionPolicy") != "Retain" or role.get("UpdateReplacePolicy") != "Retain"
            or role["Properties"].get("RoleName") != "zoolanding-deployer-thn-auth-runtime-test-cfn-exec"):
        _reject()
    trust = role["Properties"].get("AssumeRolePolicyDocument", {}).get("Statement")
    if not isinstance(trust, list) or len(trust) != 1 or trust[0].get("Effect") != "Allow" or trust[0].get("Principal") != {"Service": "cloudformation.amazonaws.com"} or trust[0].get("Action") != "sts:AssumeRole":
        _reject()
    for logical, name, target in (
        (GITHUB_POLICY, "ThnDedicatedRuntimeTestGithubV1", GITHUB_ROLE),
        (EXECUTION_POLICY, "ThnDedicatedRuntimeTestExecutionV1", EXECUTION_ROLE),
    ):
        properties = additions[logical]["Properties"]
        if properties.get("PolicyName") != name or properties.get("Roles") != [{"Ref": target}] or not _is_object(properties.get("PolicyDocument")):
            _reject()


def canonical(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def validate_candidate(candidate: dict, expected_digest: str) -> None:
    if not _is_object(candidate) or set(candidate) != {"additions", "authority"} or not re.fullmatch(r"[a-f0-9]{64}", expected_digest or ""):
        _reject()
    _validate_additions(candidate["additions"])
    if hashlib.sha256(canonical(candidate["additions"])).hexdigest() != expected_digest:
        _reject()
    authority = candidate["authority"]
    if not _is_object(authority) or set(authority) != {"account", "region", "stackName", "lookup", "deploy", "publisher", "cfn", "bucket"}:
        _reject()
    account = authority["account"]
    if (not isinstance(account, str) or not re.fullmatch(r"[0-9]{12}", account)
            or authority["region"] != "us-east-1"
            or authority["stackName"] != "ZoolandingTest-Zoolandingpage-test-ServiceRepositoryBootstrap"):
        _reject()
    for key, role_kind in (("lookup", "lookup"), ("deploy", "deploy"), ("publisher", "file-publishing"), ("cfn", "cfn-exec")):
        if not re.fullmatch(rf"arn:aws:iam::{account}:role/cdk-[a-z0-9]+-{role_kind}-role-{account}-us-east-1", authority[key] or ""):
            _reject()
    if not re.fullmatch(rf"cdk-[a-z0-9]+-assets-{account}-us-east-1", authority["bucket"] or ""):
        _reject()
def compose_template(original: dict, additions: dict) -> dict:
    """Return a new template with only the three reviewed resources appended."""
    _validate_additions(additions)
    if (not _is_object(original) or not _is_object(original.get("Resources")) or original.get("Transform")
            or set(original["Resources"]) & set(ADDITIONS)):
        _reject()
    old_role = original["Resources"].get(GITHUB_ROLE)
    if not _is_object(old_role) or old_role.get("Type") != "AWS::IAM::Role" or old_role.get("Properties", {}).get("RoleName") != "zoolanding-deployer-api-proxy-test-github-deploy":
        _reject()
    trust = old_role["Properties"].get("AssumeRolePolicyDocument", {}).get("Statement", [])
    expected = {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
        "token.actions.githubusercontent.com:sub": "repo:LynxPardelle/zoolanding-api-proxy:environment:test",
        "token.actions.githubusercontent.com:ref": "refs/heads/test",
    }
    if not any(_is_object(item) and item.get("Condition", {}).get("StringEquals") == expected for item in trust):
        _reject()
    existing_names = [resource.get("Properties", {}).get("RoleName") for resource in original["Resources"].values() if _is_object(resource)]
    existing_policies = [resource.get("Properties", {}).get("PolicyName") for resource in original["Resources"].values() if _is_object(resource)]
    if additions[EXECUTION_ROLE]["Properties"]["RoleName"] in existing_names or any(additions[logical]["Properties"]["PolicyName"] in existing_policies for logical in (GITHUB_POLICY, EXECUTION_POLICY)):
        _reject()
    result = copy.deepcopy(original)
    result["Resources"].update(copy.deepcopy(additions))
    return result


def review_changeset(description: dict) -> None:
    """Reject any native change set other than three nonreplacing Adds."""
    if (not _is_object(description) or description.get("Status") != "CREATE_COMPLETE"
            or description.get("ExecutionStatus") != "AVAILABLE"
            or description.get("ChangeSetType", "UPDATE") != "UPDATE"
            or description.get("IncludeNestedStacks") is True or description.get("NextToken")
            or not isinstance(description.get("Changes"), list)
            or len(description["Changes"]) != len(ADDITIONS)):
        _reject()
    seen = set()
    for change in description["Changes"]:
        resource = change.get("ResourceChange") if _is_object(change) else None
        if (change.get("Type") != "Resource" or not _is_object(resource)
                or resource.get("Action") != "Add" or resource.get("LogicalResourceId") not in ADDITIONS
                or resource.get("ResourceType") != ADDITIONS[resource["LogicalResourceId"]]
                or resource.get("Replacement") not in (None, "False")
                or resource.get("ChangeSetId") or resource.get("ModuleInfo")
                or resource["LogicalResourceId"] in seen):
            _reject()
        seen.add(resource["LogicalResourceId"])
    if seen != set(ADDITIONS):
        _reject()


def _template(response: dict) -> dict:
    body = response.get("TemplateBody") if _is_object(response) else None
    if isinstance(body, str):
        body = json.loads(body)
    if not _is_object(body) or not _is_object(body.get("Resources")):
        _reject()
    return body


def _snapshot_parameters(stack: dict) -> list[dict]:
    parameters = stack.get("Parameters", [])
    if not isinstance(parameters, list) or any(not _is_object(item) or not isinstance(item.get("ParameterKey"), str) for item in parameters):
        _reject()
    names = [item["ParameterKey"] for item in parameters]
    if len(names) != len(set(names)):
        _reject()
    return sorted(parameters, key=lambda item: item["ParameterKey"])


def validate_live_github_role(role: dict, account: str) -> None:
    name = "zoolanding-deployer-api-proxy-test-github-deploy"
    if (not _is_object(role) or role.get("RoleName") != name
            or role.get("Arn") != f"arn:aws:iam::{account}:role/{name}"
            or role.get("Path") != "/" or role.get("PermissionsBoundary")):
        _reject()
    document = role.get("AssumeRolePolicyDocument", {})
    statements = document.get("Statement") if _is_object(document) else None
    expected = {"Effect": "Allow", "Principal": {
        "Federated": f"arn:aws:iam::{account}:oidc-provider/token.actions.githubusercontent.com"},
        "Action": "sts:AssumeRoleWithWebIdentity", "Condition": {"StringEquals": {
            "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
            "token.actions.githubusercontent.com:sub": "repo:LynxPardelle/zoolanding-api-proxy:environment:test",
            "token.actions.githubusercontent.com:ref": "refs/heads/test",
        }}}
    if statements != [expected] or document.get("Version", "2012-10-17") != "2012-10-17":
        _reject()


def validate_asset_encryption(configuration: dict, key: dict) -> str:
    rules = configuration.get("Rules") if _is_object(configuration) else None
    if (not _is_object(key) or key.get("KeyManager") != "AWS" or key.get("Enabled") is not True
            or key.get("KeyState") != "Enabled" or not isinstance(key.get("Arn"), str)
            or not isinstance(rules, list) or len(rules) != 1):
        _reject()
    default = rules[0].get("ApplyServerSideEncryptionByDefault") if _is_object(rules[0]) else None
    if (not _is_object(default) or default.get("SSEAlgorithm") != "aws:kms"
            or default.get("KMSMasterKeyID") not in (None, "alias/aws/s3", key["Arn"], key.get("KeyId"))):
        _reject()
    return key["Arn"]


def validate_final_policies(github: dict, execution: dict) -> None:
    for value in (github, execution):
        names = value.get("PolicyNames") if _is_object(value) else None
        if value.get("IsTruncated") or not isinstance(names, list) or len(names) != len(set(names)):
            _reject()
    if ("ThnDedicatedRuntimeTestGithubV1" not in github["PolicyNames"]
            or execution["PolicyNames"] != ["ThnDedicatedRuntimeTestExecutionV1"]):
        _reject()


def _assumed_client(sts, authority: dict, kind: str, service: str, region: str):
    from boto3 import Session

    result = sts.assume_role(RoleArn=authority[kind], RoleSessionName="thn-dedicated-identity-test", DurationSeconds=3600)
    credentials = result["Credentials"]
    session = Session(aws_access_key_id=credentials["AccessKeyId"],
                      aws_secret_access_key=credentials["SecretAccessKey"],
                      aws_session_token=credentials["SessionToken"], region_name=region)
    return session.client(service)


def run_release(operation: str, candidate: dict, expected_digest: str, env: dict[str, str]) -> str:
    """Read-only verify, or apply only one reviewed, exact three-Add UPDATE."""
    if (operation not in ("verify", "apply") or env.get("GITHUB_ACTIONS") != "true"
            or env.get("GITHUB_EVENT_NAME") != "workflow_dispatch"
            or env.get("GITHUB_REPOSITORY") != "LynxPardelle/zoolandingpage-aws-infra"
            or env.get("GITHUB_REF") != "refs/heads/test"
            or env.get("REVIEWED_SOURCE_SHA") != env.get("GITHUB_SHA")
            or not re.fullmatch(r"[a-f0-9]{40}", env.get("GITHUB_SHA", ""))
            or not re.fullmatch(r"[1-9][0-9]*", env.get("GITHUB_RUN_ID", ""))
            or not re.fullmatch(r"[1-9][0-9]*", env.get("GITHUB_RUN_ATTEMPT", ""))):
        _reject()
    validate_candidate(candidate, expected_digest)
    authority = candidate["authority"]
    account, region, stack_name = authority["account"], authority["region"], authority["stackName"]

    from boto3 import Session

    session = Session(region_name=region)
    sts = session.client("sts")
    caller = sts.get_caller_identity()
    if caller.get("Account") != account or not re.fullmatch(rf"arn:aws:sts::{account}:assumed-role/[A-Za-z0-9+=,.@_/-]+", caller.get("Arn", "")):
        _reject()
    lookup = _assumed_client(sts, authority, "lookup", "cloudformation", region)
    deploy = _assumed_client(sts, authority, "deploy", "cloudformation", region)
    lookup_iam = _assumed_client(sts, authority, "lookup", "iam", region)

    def read_stack() -> dict:
        stacks = lookup.describe_stacks(StackName=stack_name).get("Stacks", [])
        if len(stacks) != 1:
            _reject()
        stack = stacks[0]
        if (stack.get("StackName") != stack_name
                or not re.fullmatch(rf"arn:aws:cloudformation:{region}:{account}:stack/{stack_name}/[A-Za-z0-9-]+", stack.get("StackId", ""))
                or stack.get("RoleARN") != authority["cfn"]
                or stack.get("EnableTerminationProtection") is not True
                or stack.get("StackStatus") not in ("CREATE_COMPLETE", "UPDATE_COMPLETE", "UPDATE_ROLLBACK_COMPLETE")):
            _reject()
        return stack

    stack = read_stack()
    stack_id = stack["StackId"]
    parameters = _snapshot_parameters(stack)
    original = _template(lookup.get_template(StackName=stack_id, TemplateStage="Original"))
    processed = _template(lookup.get_template(StackName=stack_id, TemplateStage="Processed"))
    if set(original.get("Parameters", {})) != {item["ParameterKey"] for item in parameters}:
        _reject()
    composed = compose_template(original, candidate["additions"])
    composed_processed = compose_template(processed, candidate["additions"])
    body = canonical(composed)
    if len(body) > 1_048_576:
        _reject()
    original_sha = hashlib.sha256(canonical(original)).hexdigest()
    processed_sha = hashlib.sha256(canonical(processed)).hexdigest()

    github_role_name = "zoolanding-deployer-api-proxy-test-github-deploy"
    role = lookup_iam.get_role(RoleName=github_role_name).get("Role", {})
    validate_live_github_role(role, account)
    inline = lookup_iam.list_role_policies(RoleName=github_role_name)
    if inline.get("IsTruncated") or "ThnDedicatedRuntimeTestGithubV1" in inline.get("PolicyNames", []):
        _reject()
    try:
        lookup_iam.get_role(RoleName="zoolanding-deployer-thn-auth-runtime-test-cfn-exec")
    except Exception as error:
        if getattr(error, "response", {}).get("Error", {}).get("Code") != "NoSuchEntity":
            raise
    else:
        _reject()

    def baseline() -> None:
        current = read_stack()
        if (current["StackId"] != stack_id or _snapshot_parameters(current) != parameters
                or hashlib.sha256(canonical(_template(lookup.get_template(StackName=stack_id, TemplateStage="Original")))).hexdigest() != original_sha
                or hashlib.sha256(canonical(_template(lookup.get_template(StackName=stack_id, TemplateStage="Processed")))).hexdigest() != processed_sha):
            _reject()

    baseline()
    if operation == "verify":
        return "verified"

    publisher = _assumed_client(sts, authority, "publisher", "s3", region)
    deploy_s3 = _assumed_client(sts, authority, "deploy", "s3", region)
    lookup_s3 = _assumed_client(sts, authority, "lookup", "s3", region)
    lookup_kms = _assumed_client(sts, authority, "lookup", "kms", region)
    digest = hashlib.sha256(body).hexdigest()
    key = f"thn-dedicated-identity/{env['GITHUB_RUN_ID']}/{env['GITHUB_RUN_ATTEMPT']}/{env['GITHUB_SHA']}/{digest}.json"
    bucket = authority["bucket"]
    key_meta = lookup_kms.describe_key(KeyId="alias/aws/s3")["KeyMetadata"]
    key_arn = validate_asset_encryption(lookup_s3.get_bucket_encryption(Bucket=bucket, ExpectedBucketOwner=account)["ServerSideEncryptionConfiguration"], key_meta)
    checksum = base64.b64encode(bytes.fromhex(digest)).decode("ascii")
    publisher.put_object(Bucket=bucket, Key=key, Body=body, IfNoneMatch="*", ExpectedBucketOwner=account,
                         ServerSideEncryption="aws:kms", SSEKMSKeyId=key_arn, ChecksumSHA256=checksum)
    for client in (publisher, deploy_s3):
        readback = client.get_object(Bucket=bucket, Key=key, ExpectedBucketOwner=account, ChecksumMode="ENABLED")
        if (readback.get("ServerSideEncryption") != "aws:kms" or readback.get("SSEKMSKeyId") != key_arn
                or readback.get("ChecksumSHA256") != checksum or readback["Body"].read(1_048_577) != body):
            _reject()
    name = f"thn-dedicated-identity-{env['GITHUB_RUN_ID']}-{env['GITHUB_RUN_ATTEMPT']}"
    baseline()
    created = deploy.create_change_set(StackName=stack_id, ChangeSetName=name,
        ChangeSetType="UPDATE", TemplateURL=f"https://{bucket}.s3.{region}.amazonaws.com/{quote(key)}",
        RoleARN=authority["cfn"],
        Parameters=[{"ParameterKey": item["ParameterKey"], "UsePreviousValue": True} for item in parameters],
        Capabilities=["CAPABILITY_NAMED_IAM"], IncludeNestedStacks=False, ClientToken=name)
    change_id = created.get("Id", "")
    if created.get("StackId") != stack_id or not re.fullmatch(rf"arn:aws:cloudformation:{region}:{account}:changeSet/{name}/[A-Za-z0-9-]+", change_id):
        _reject()
    deploy.get_waiter("change_set_create_complete").wait(StackName=stack_id, ChangeSetName=change_id,
                                                        WaiterConfig={"Delay": 3, "MaxAttempts": 40})

    def review() -> None:
        description = deploy.describe_change_set(StackName=stack_id, ChangeSetName=change_id, IncludePropertyValues=True)
        if (description.get("StackName") != stack_name or description.get("StackId") != stack_id
                or description.get("ChangeSetName") != name or description.get("ChangeSetId") != change_id
                or {item.get("ParameterKey") for item in description.get("Parameters", [])} != {item["ParameterKey"] for item in parameters}
                or len(description.get("Parameters", [])) != len(parameters)):
            _reject()
        review_changeset(description)
        pending_original = _template(deploy.get_template(StackName=stack_id, ChangeSetName=change_id, TemplateStage="Original"))
        pending_processed = _template(deploy.get_template(StackName=stack_id, ChangeSetName=change_id, TemplateStage="Processed"))
        if pending_original != composed or pending_processed != composed_processed:
            _reject()

    review()
    baseline()
    review()
    deploy.execute_change_set(StackName=stack_id, ChangeSetName=change_id, ClientRequestToken=name)
    deploy.get_waiter("stack_update_complete").wait(StackName=stack_id, WaiterConfig={"Delay": 5, "MaxAttempts": 90})
    final = read_stack()
    if (final["StackId"] != stack_id or _snapshot_parameters(final) != parameters
            or _template(lookup.get_template(StackName=stack_id, TemplateStage="Original")) != composed
            or _template(lookup.get_template(StackName=stack_id, TemplateStage="Processed")) != composed_processed):
        _reject()
    for logical, resource_type in ADDITIONS.items():
        resource = lookup.describe_stack_resource(StackName=stack_id, LogicalResourceId=logical).get("StackResourceDetail", {})
        if (resource.get("StackId") != stack_id or resource.get("LogicalResourceId") != logical
                or resource.get("ResourceType") != resource_type or resource.get("ResourceStatus") != "CREATE_COMPLETE"):
            _reject()
    created_role = lookup_iam.get_role(RoleName="zoolanding-deployer-thn-auth-runtime-test-cfn-exec").get("Role", {})
    if created_role.get("Arn") != f"arn:aws:iam::{account}:role/zoolanding-deployer-thn-auth-runtime-test-cfn-exec":
        _reject()
    validate_final_policies(
        lookup_iam.list_role_policies(RoleName=github_role_name),
        lookup_iam.list_role_policies(RoleName="zoolanding-deployer-thn-auth-runtime-test-cfn-exec"))
    return "applied"


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--operation", choices=("verify", "apply"), required=True)
    parser.add_argument("--candidate", required=True)
    args = parser.parse_args()
    try:
        with open(args.candidate, "r", encoding="utf-8") as source:
            candidate = json.load(source)
        result = run_release(args.operation, candidate, os.environ.get("REVIEWED_ADDITIONS_SHA256", ""), os.environ)
    except Exception:
        print("thn_dedicated_identity_release_failed; inspect the exact workflow stage before retry", file=sys.stderr)
        return 1
    print("thn_dedicated_identity_" + result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
