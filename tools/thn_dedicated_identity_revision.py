"""Guard a one-policy TEST revision of the existing THN runtime executor."""

from __future__ import annotations

import copy
import base64
import hashlib
import json
import os
import re
import sys
from urllib.parse import quote

try:
    from tools import thn_dedicated_identity_release as initial
except ModuleNotFoundError:
    import thn_dedicated_identity_release as initial


OLD_PREFIX = "zoolanding-thn-auth-runtime-test-*"
NEW_PREFIX = "zoolanding-thn-auth-runti*"
POLICY = initial.EXECUTION_POLICY


def _reject() -> None:
    raise ValueError("thn_dedicated_identity_revision_guard_failed")


def _previous_policy(desired: dict) -> dict:
    previous = copy.deepcopy(desired)
    changes = 0

    def visit(value):
        nonlocal changes
        if isinstance(value, dict):
            return {key: visit(item) for key, item in value.items()}
        if isinstance(value, list):
            return [visit(item) for item in value]
        if isinstance(value, str) and NEW_PREFIX in value:
            if value.count(NEW_PREFIX) != 1 or not value.endswith(NEW_PREFIX):
                _reject()
            changes += 1
            return value.replace(NEW_PREFIX, OLD_PREFIX)
        return value

    previous = visit(previous)
    if changes != 5:
        _reject()
    return previous


def _previous_attachment_policy(desired: dict) -> dict | None:
    """Derive the exact live Basic-only condition from the reviewed two-ARN policy."""
    policy = desired.get(POLICY) if isinstance(desired, dict) else None
    document = policy.get("Properties", {}).get("PolicyDocument") if isinstance(policy, dict) else None
    statements = document.get("Statement") if isinstance(document, dict) else None
    if not isinstance(statements, list):
        _reject()
    matches = [item for item in statements if isinstance(item, dict)
               and item.get("Action") == ["iam:AttachRolePolicy", "iam:DetachRolePolicy"]]
    if len(matches) != 1:
        return None
    basic = {"Fn::Join": ["", ["arn:", {"Ref": "AWS::Partition"},
                                ":iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"]]}
    xray = {"Fn::Join": ["", ["arn:", {"Ref": "AWS::Partition"},
                               ":iam::aws:policy/AWSXrayWriteOnlyAccess"]]}
    if matches[0].get("Condition") != {"ArnEquals": {"iam:PolicyARN": [basic, xray]}}:
        return None
    previous = copy.deepcopy(policy)
    for item in previous["Properties"]["PolicyDocument"]["Statement"]:
        if isinstance(item, dict) and item.get("Action") == ["iam:AttachRolePolicy", "iam:DetachRolePolicy"]:
            item["Condition"]["ArnEquals"]["iam:PolicyARN"] = basic
    return previous


def _expected_previous_policy(desired: dict) -> dict:
    attachment_previous = _previous_attachment_policy(desired)
    return attachment_previous if attachment_previous is not None else _previous_policy(desired[POLICY])


def compose_revision(original: dict, desired: dict) -> dict:
    """Preserve every old field while applying one exact policy transition."""

    if (not isinstance(original, dict) or not isinstance(original.get("Resources"), dict)
            or original.get("Transform") or not isinstance(desired, dict)
            or set(desired) != set(initial.ADDITIONS)):
        _reject()
    resources = original["Resources"]
    if not set(desired) <= set(resources):
        _reject()
    for logical in (initial.EXECUTION_ROLE, initial.GITHUB_POLICY):
        if resources[logical] != desired[logical]:
            _reject()
    target = desired[POLICY]
    if (not isinstance(target, dict) or target.get("Type") != "AWS::IAM::Policy"
            or target.get("Properties", {}).get("PolicyName") != "ThnDedicatedRuntimeTestExecutionV1"
            or target.get("Properties", {}).get("Roles") != [{"Ref": initial.EXECUTION_ROLE}]
            or resources[POLICY] != _expected_previous_policy(desired)):
        _reject()
    result = copy.deepcopy(original)
    result["Resources"][POLICY] = copy.deepcopy(target)
    return result


def _resolve_partition(value):
    if isinstance(value, list):
        return [_resolve_partition(item) for item in value]
    if isinstance(value, dict):
        if set(value) == {"Ref"} and value["Ref"] == "AWS::Partition":
            return "aws"
        if set(value) == {"Fn::Join"}:
            join = value["Fn::Join"]
            if not isinstance(join, list) or len(join) != 2 or not isinstance(join[0], str) or not isinstance(join[1], list):
                _reject()
            parts = [_resolve_partition(part) for part in join[1]]
            if not all(isinstance(part, str) for part in parts):
                _reject()
            return join[0].join(parts)
        return {key: _resolve_partition(item) for key, item in value.items()}
    return value


def validate_live_policy(live_document: dict, desired_resource: dict) -> None:
    """Require IAM's resolved document to equal the old CFN document."""

    if (not isinstance(live_document, dict) or not isinstance(desired_resource, dict)
            or not isinstance(desired_resource.get("Properties", {}).get("PolicyDocument"), dict)):
        _reject()
    previous = _expected_previous_policy({POLICY: desired_resource})["Properties"]["PolicyDocument"]
    if initial.canonical(live_document) != initial.canonical(_resolve_partition(previous)):
        _reject()


def validate_context(operation: str, env: dict[str, str]) -> None:
    if (operation not in ("verify", "apply") or env.get("GITHUB_ACTIONS") != "true"
            or env.get("GITHUB_EVENT_NAME") != "workflow_dispatch"
            or env.get("GITHUB_REPOSITORY") != "LynxPardelle/zoolandingpage-aws-infra"
            or env.get("GITHUB_REF") != "refs/heads/test"
            or env.get("REVIEWED_SOURCE_SHA") != env.get("GITHUB_SHA")
            or not re.fullmatch(r"[a-f0-9]{40}", env.get("GITHUB_SHA", ""))
            or not re.fullmatch(r"[1-9][0-9]*", env.get("GITHUB_RUN_ID", ""))
            or not re.fullmatch(r"[1-9][0-9]*", env.get("GITHUB_RUN_ATTEMPT", ""))):
        _reject()


def review_revision_changeset(description: dict) -> None:
    """Accept only one nonreplacing PolicyDocument Modify, never Adds/Deletes."""

    if (not isinstance(description, dict) or description.get("Status") != "CREATE_COMPLETE"
            or description.get("ExecutionStatus") != "AVAILABLE"
            or description.get("ChangeSetType", "UPDATE") != "UPDATE"
            or description.get("IncludeNestedStacks") is True or description.get("NextToken")
            or not isinstance(description.get("Changes"), list)
            or len(description["Changes"]) != 1):
        _reject()
    change = description["Changes"][0]
    resource = change.get("ResourceChange") if isinstance(change, dict) else None
    if (change.get("Type") != "Resource" or not isinstance(resource, dict)
            or resource.get("Action") != "Modify"
            or resource.get("LogicalResourceId") != POLICY
            or resource.get("ResourceType") != "AWS::IAM::Policy"
            or resource.get("Replacement") != "False"
            or resource.get("Scope") != ["Properties"]
            or resource.get("ChangeSetId") or resource.get("ModuleInfo")):
        _reject()
    details = resource.get("Details")
    if (not isinstance(details, list) or not details
            or any(not isinstance(detail, dict)
                   or detail.get("Target", {}).get("Attribute") != "Properties"
                   or detail["Target"].get("Name") != "PolicyDocument"
                   for detail in details)):
        _reject()


def run_revision(operation: str, candidate: dict, expected_digest: str,
                 env: dict[str, str]) -> str:
    """Verify or apply one reviewed policy Modify to the protected TEST stack."""

    validate_context(operation, env)
    initial.validate_candidate(candidate, expected_digest)
    authority = candidate["authority"]
    account, region, stack_name = authority["account"], authority["region"], authority["stackName"]

    from boto3 import Session

    session = Session(region_name=region)
    sts = session.client("sts")
    caller = sts.get_caller_identity()
    if (caller.get("Account") != account
            or not re.fullmatch(rf"arn:aws:sts::{account}:assumed-role/[A-Za-z0-9+=,.@_/-]+",
                                caller.get("Arn", ""))):
        _reject()
    lookup = initial._assumed_client(sts, authority, "lookup", "cloudformation", region)
    deploy = initial._assumed_client(sts, authority, "deploy", "cloudformation", region)
    lookup_iam = initial._assumed_client(sts, authority, "lookup", "iam", region)

    def read_stack() -> dict:
        stacks = lookup.describe_stacks(StackName=stack_name).get("Stacks", [])
        if len(stacks) != 1:
            _reject()
        stack = stacks[0]
        if (stack.get("StackName") != stack_name
                or not re.fullmatch(rf"arn:aws:cloudformation:{region}:{account}:stack/{stack_name}/[A-Za-z0-9-]+",
                                    stack.get("StackId", ""))
                or stack.get("RoleARN") != authority["cfn"]
                or stack.get("EnableTerminationProtection") is not True
                or stack.get("StackStatus") != "UPDATE_COMPLETE"):
            _reject()
        return stack

    stack = read_stack()
    stack_id = stack["StackId"]
    parameters = initial._snapshot_parameters(stack)
    original = initial._template(lookup.get_template(StackName=stack_id, TemplateStage="Original"))
    processed = initial._template(lookup.get_template(StackName=stack_id, TemplateStage="Processed"))
    if set(original.get("Parameters", {})) != {item["ParameterKey"] for item in parameters}:
        _reject()
    composed = compose_revision(original, candidate["additions"])
    composed_processed = compose_revision(processed, candidate["additions"])
    body = initial.canonical(composed)
    if len(body) > 1_048_576:
        _reject()
    original_sha = hashlib.sha256(initial.canonical(original)).hexdigest()
    processed_sha = hashlib.sha256(initial.canonical(processed)).hexdigest()

    github_role_name = "zoolanding-deployer-api-proxy-test-github-deploy"
    execution_role_name = "zoolanding-deployer-thn-auth-runtime-test-cfn-exec"
    initial.validate_live_github_role(lookup_iam.get_role(RoleName=github_role_name).get("Role", {}), account)
    execution_role = lookup_iam.get_role(RoleName=execution_role_name).get("Role", {})
    if (execution_role.get("Arn") != f"arn:aws:iam::{account}:role/{execution_role_name}"
            or execution_role.get("Path") != "/" or execution_role.get("PermissionsBoundary")):
        _reject()
    initial.validate_final_policies(
        lookup_iam.list_role_policies(RoleName=github_role_name),
        lookup_iam.list_role_policies(RoleName=execution_role_name),
        lookup_iam.list_attached_role_policies(RoleName=github_role_name), account)

    def live_policy() -> dict:
        result = lookup_iam.get_role_policy(RoleName=execution_role_name,
                                            PolicyName="ThnDedicatedRuntimeTestExecutionV1")
        return result.get("PolicyDocument", {})

    validate_live_policy(live_policy(), candidate["additions"][POLICY])

    def baseline() -> None:
        current = read_stack()
        if (current["StackId"] != stack_id or initial._snapshot_parameters(current) != parameters
                or hashlib.sha256(initial.canonical(initial._template(
                    lookup.get_template(StackName=stack_id, TemplateStage="Original")))).hexdigest() != original_sha
                or hashlib.sha256(initial.canonical(initial._template(
                    lookup.get_template(StackName=stack_id, TemplateStage="Processed")))).hexdigest() != processed_sha):
            _reject()
        validate_live_policy(live_policy(), candidate["additions"][POLICY])

    baseline()
    if operation == "verify":
        return "verified"

    publisher = initial._assumed_client(sts, authority, "publisher", "s3", region)
    deploy_s3 = initial._assumed_client(sts, authority, "deploy", "s3", region)
    lookup_s3 = initial._assumed_client(sts, authority, "lookup", "s3", region)
    lookup_kms = initial._assumed_client(sts, authority, "lookup", "kms", region)
    digest = hashlib.sha256(body).hexdigest()
    key = (f"thn-dedicated-identity-revision/{env['GITHUB_RUN_ID']}/"
           f"{env['GITHUB_RUN_ATTEMPT']}/{env['GITHUB_SHA']}/{digest}.json")
    bucket = authority["bucket"]
    key_meta = lookup_kms.describe_key(KeyId="alias/aws/s3")["KeyMetadata"]
    key_arn = initial.validate_asset_encryption(
        lookup_s3.get_bucket_encryption(Bucket=bucket, ExpectedBucketOwner=account)["ServerSideEncryptionConfiguration"],
        key_meta)
    checksum = base64.b64encode(bytes.fromhex(digest)).decode("ascii")
    publisher.put_object(Bucket=bucket, Key=key, Body=body, IfNoneMatch="*",
                         ExpectedBucketOwner=account, ServerSideEncryption="aws:kms",
                         SSEKMSKeyId=key_arn, ChecksumSHA256=checksum)
    for client in (publisher, deploy_s3):
        readback = client.get_object(Bucket=bucket, Key=key, ExpectedBucketOwner=account,
                                     ChecksumMode="ENABLED")
        if (readback.get("ServerSideEncryption") != "aws:kms"
                or readback.get("SSEKMSKeyId") != key_arn
                or readback.get("ChecksumSHA256") != checksum
                or readback["Body"].read(1_048_577) != body):
            _reject()

    name = f"thn-dedicated-identity-revision-{env['GITHUB_RUN_ID']}-{env['GITHUB_RUN_ATTEMPT']}"
    baseline()
    created = deploy.create_change_set(
        StackName=stack_id, ChangeSetName=name, ChangeSetType="UPDATE",
        TemplateURL=f"https://{bucket}.s3.{region}.amazonaws.com/{quote(key)}",
        RoleARN=authority["cfn"],
        Parameters=[{"ParameterKey": item["ParameterKey"], "UsePreviousValue": True}
                    for item in parameters],
        Capabilities=["CAPABILITY_NAMED_IAM"], IncludeNestedStacks=False,
        ClientToken=name)
    change_id = created.get("Id", "")
    if (created.get("StackId") != stack_id
            or not re.fullmatch(rf"arn:aws:cloudformation:{region}:{account}:changeSet/{name}/[A-Za-z0-9-]+",
                                change_id)):
        _reject()
    deploy.get_waiter("change_set_create_complete").wait(
        StackName=stack_id, ChangeSetName=change_id,
        WaiterConfig={"Delay": 3, "MaxAttempts": 40})

    def review() -> None:
        description = deploy.describe_change_set(StackName=stack_id,
                                                  ChangeSetName=change_id,
                                                  IncludePropertyValues=True)
        if (description.get("StackName") != stack_name
                or description.get("StackId") != stack_id
                or description.get("ChangeSetName") != name
                or description.get("ChangeSetId") != change_id
                or len(description.get("Parameters", [])) != len(parameters)
                or {item.get("ParameterKey") for item in description.get("Parameters", [])}
                   != {item["ParameterKey"] for item in parameters}):
            _reject()
        review_revision_changeset(description)
        pending_original = initial._template(deploy.get_template(
            StackName=stack_id, ChangeSetName=change_id, TemplateStage="Original"))
        pending_processed = initial._template(deploy.get_template(
            StackName=stack_id, ChangeSetName=change_id, TemplateStage="Processed"))
        if pending_original != composed or pending_processed != composed_processed:
            _reject()

    review()
    baseline()
    review()
    deploy.execute_change_set(StackName=stack_id, ChangeSetName=change_id,
                              ClientRequestToken=name)
    deploy.get_waiter("stack_update_complete").wait(
        StackName=stack_id, WaiterConfig={"Delay": 5, "MaxAttempts": 90})
    final = read_stack()
    if (final["StackId"] != stack_id or initial._snapshot_parameters(final) != parameters
            or initial._template(lookup.get_template(
                StackName=stack_id, TemplateStage="Original")) != composed
            or initial._template(lookup.get_template(
                StackName=stack_id, TemplateStage="Processed")) != composed_processed):
        _reject()
    observed = live_policy()
    desired_document = _resolve_partition(candidate["additions"][POLICY]["Properties"]["PolicyDocument"])
    if initial.canonical(observed) != initial.canonical(desired_document):
        _reject()
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
        result = run_revision(args.operation, candidate,
                              os.environ.get("REVIEWED_ADDITIONS_SHA256", ""), os.environ)
    except Exception:
        print("thn_dedicated_identity_revision_failed; inspect the exact workflow stage before retry",
              file=sys.stderr)
        return 1
    print("thn_dedicated_identity_revision_" + result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
