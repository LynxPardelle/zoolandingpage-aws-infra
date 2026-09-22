"""Offline guards for revising only the dedicated THN execution policy."""

import copy
import importlib.util
import subprocess
import sys
import unittest
from pathlib import Path


MODULE = Path(__file__).resolve().parents[1] / "tools" / "thn_dedicated_identity_revision.py"


def load_revision():
    if not MODULE.is_file():
        return None
    spec = importlib.util.spec_from_file_location("thn_dedicated_identity_revision", MODULE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class DedicatedIdentityRevisionTests(unittest.TestCase):
    def setUp(self):
        self.revision = load_revision()
        self.assertIsNotNone(self.revision, "the exact policy revision implementation is missing")
        self.role = "ThnDedicatedRuntimeTestCloudFormationRoleCF799F56"
        self.github = "ThnDedicatedRuntimeTestGithubPolicy"
        self.execution = "ThnDedicatedRuntimeTestExecutionPolicy"
        self.old_prefix = "zoolanding-thn-auth-runtime-test-*"
        self.new_prefix = "zoolanding-thn-auth-runti*"
        statements = [
            {"Effect": "Allow", "Action": ["lambda:CreateFunction"], "Resource": [f"arn:aws:lambda:us-east-1:123456789012:function:{self.new_prefix}"]},
            {"Effect": "Allow", "Action": ["iam:CreateRole", "iam:DeleteRolePolicy", "iam:TagRole"], "Resource": [f"arn:aws:iam::123456789012:role/{self.new_prefix}"]},
            {"Effect": "Allow", "Action": ["iam:AttachRolePolicy"], "Resource": [f"arn:aws:iam::123456789012:role/{self.new_prefix}"]},
            {"Effect": "Allow", "Action": ["iam:PassRole"], "Resource": [f"arn:aws:iam::123456789012:role/{self.new_prefix}"]},
            {"Effect": "Allow", "Action": ["logs:CreateLogGroup"], "Resource": [f"arn:aws:logs:us-east-1:123456789012:log-group:/aws/lambda/{self.new_prefix}"]},
        ]
        self.desired = {
            self.role: {"Type": "AWS::IAM::Role", "Properties": {"RoleName": "zoolanding-deployer-thn-auth-runtime-test-cfn-exec"}},
            self.github: {"Type": "AWS::IAM::Policy", "Properties": {"PolicyName": "ThnDedicatedRuntimeTestGithubV1"}},
            self.execution: {"Type": "AWS::IAM::Policy", "Properties": {
                "PolicyName": "ThnDedicatedRuntimeTestExecutionV1", "Roles": [{"Ref": self.role}],
                "PolicyDocument": {"Version": "2012-10-17", "Statement": statements},
            }},
        }
        self.original = {"Resources": copy.deepcopy(self.desired), "Outputs": {"Preserve": {"Value": "same"}}}
        for statement in self.original["Resources"][self.execution]["Properties"]["PolicyDocument"]["Statement"]:
            statement["Resource"] = [value.replace(self.new_prefix, self.old_prefix) for value in statement["Resource"]]

    def attachment_fixture(self):
        desired = copy.deepcopy(self.desired)
        basic = {"Fn::Join": ["", ["arn:", {"Ref": "AWS::Partition"},
                                    ":iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"]]}
        xray = {"Fn::Join": ["", ["arn:", {"Ref": "AWS::Partition"},
                                   ":iam::aws:policy/AWSXrayWriteOnlyAccess"]]}
        attach = desired[self.execution]["Properties"]["PolicyDocument"]["Statement"][2]
        attach["Action"] = ["iam:AttachRolePolicy", "iam:DetachRolePolicy"]
        attach["Condition"] = {"ArnEquals": {"iam:PolicyARN": [basic, xray]}}
        original = {"Resources": copy.deepcopy(desired), "Outputs": {"Preserve": {"Value": "same"}}}
        original["Resources"][self.execution]["Properties"]["PolicyDocument"]["Statement"][2]["Condition"]["ArnEquals"]["iam:PolicyARN"] = basic
        return original, desired

    def test_attachment_revision_changes_only_basic_to_exact_xray_pair(self):
        original, desired = self.attachment_fixture()
        before = copy.deepcopy(original)
        composed = self.revision.compose_revision(original, desired)
        self.assertEqual(original, before)
        self.assertEqual(composed["Outputs"], before["Outputs"])
        for logical in (self.role, self.github):
            self.assertEqual(composed["Resources"][logical], before["Resources"][logical])
        self.assertEqual(composed["Resources"][self.execution], desired[self.execution])
        live = self.revision._resolve_partition(before["Resources"][self.execution]["Properties"]["PolicyDocument"])
        self.revision.validate_live_policy(live, desired[self.execution])

    def test_attachment_revision_rejects_replay_drift_or_extra_policy(self):
        for variant in ("replay", "role", "third-policy", "wrong-old-condition", "action"):
            original, desired = self.attachment_fixture()
            statement = desired[self.execution]["Properties"]["PolicyDocument"]["Statement"][2]
            if variant == "replay":
                original["Resources"][self.execution] = copy.deepcopy(desired[self.execution])
            elif variant == "role":
                original["Resources"][self.role]["Properties"]["RoleName"] = "other"
            elif variant == "third-policy":
                statement["Condition"]["ArnEquals"]["iam:PolicyARN"].append("arn:aws:iam::aws:policy/AdministratorAccess")
            elif variant == "wrong-old-condition":
                original["Resources"][self.execution]["Properties"]["PolicyDocument"]["Statement"][2]["Condition"] = {}
            else:
                statement["Action"].append("iam:UpdateRole")
            with self.subTest(variant=variant), self.assertRaises(ValueError):
                self.revision.compose_revision(original, desired)

    def test_compose_changes_only_five_runtime_resource_patterns(self):
        before = copy.deepcopy(self.original)
        composed = self.revision.compose_revision(self.original, self.desired)
        self.assertEqual(self.original, before)
        self.assertEqual(composed["Outputs"], before["Outputs"])
        self.assertEqual(set(composed["Resources"]), set(before["Resources"]))
        for key in (self.role, self.github):
            self.assertEqual(composed["Resources"][key], before["Resources"][key])
        self.assertEqual(composed["Resources"][self.execution], self.desired[self.execution])

    def test_compose_rejects_drift_unrelated_changes_and_replay(self):
        for variant in ("extra-resource", "github", "action", "role", "already-applied", "old-policy"):
            original, desired = copy.deepcopy(self.original), copy.deepcopy(self.desired)
            if variant == "extra-resource": desired["Other"] = {"Type": "AWS::IAM::Role"}
            elif variant == "github": desired[self.github]["Properties"]["PolicyName"] = "Other"
            elif variant == "action": desired[self.execution]["Properties"]["PolicyDocument"]["Statement"][1]["Action"].append("iam:UpdateRole")
            elif variant == "role": desired[self.role]["Properties"]["RoleName"] = "Other"
            elif variant == "already-applied": original["Resources"] = copy.deepcopy(desired)
            else: original["Resources"][self.execution]["Properties"]["PolicyDocument"]["Statement"][0]["Resource"] = ["*"]
            with self.subTest(variant=variant), self.assertRaises(ValueError):
                self.revision.compose_revision(original, desired)

    def test_change_set_accepts_only_one_nonreplacing_policy_modify(self):
        change = {"Status": "CREATE_COMPLETE", "ExecutionStatus": "AVAILABLE", "ChangeSetType": "UPDATE",
                  "IncludeNestedStacks": False, "Changes": [{"Type": "Resource", "ResourceChange": {
                      "Action": "Modify", "LogicalResourceId": self.execution, "ResourceType": "AWS::IAM::Policy",
                      "Replacement": "False", "Scope": ["Properties"], "Details": [{"Target": {"Attribute": "Properties", "Name": "PolicyDocument"}}]}}]}
        self.revision.review_revision_changeset(change)
        for variant in ("extra", "add", "replace", "other-policy", "other-property", "nested", "pagination"):
            bad = copy.deepcopy(change)
            resource = bad["Changes"][0]["ResourceChange"]
            if variant == "extra": bad["Changes"].append(copy.deepcopy(bad["Changes"][0]))
            elif variant == "add": resource["Action"] = "Add"
            elif variant == "replace": resource["Replacement"] = "True"
            elif variant == "other-policy": resource["LogicalResourceId"] = self.github
            elif variant == "other-property": resource["Details"][0]["Target"]["Name"] = "Roles"
            elif variant == "nested": bad["IncludeNestedStacks"] = True
            else: bad["NextToken"] = "more"
            with self.subTest(variant=variant), self.assertRaises(ValueError):
                self.revision.review_revision_changeset(bad)

    def test_describe_change_set_omits_request_owned_type(self):
        description = {"Status": "CREATE_COMPLETE", "ExecutionStatus": "AVAILABLE",
                       "Changes": [{"Type": "Resource", "ResourceChange": {
                           "Action": "Modify", "LogicalResourceId": self.execution,
                           "ResourceType": "AWS::IAM::Policy", "Replacement": "False",
                           "Scope": ["Properties"], "Details": [{"Target": {
                               "Attribute": "Properties", "Name": "PolicyDocument"}}]}}]}
        self.revision.review_revision_changeset(description)
        description["ChangeSetType"] = "CREATE"
        with self.assertRaises(ValueError):
            self.revision.review_revision_changeset(description)

    def test_live_policy_readback_must_match_previous_policy_exactly(self):
        self.assertTrue(hasattr(self.revision, "validate_live_policy"), "live policy guard is missing")
        previous = self.original["Resources"][self.execution]["Properties"]["PolicyDocument"]
        self.revision.validate_live_policy(previous, self.desired[self.execution])
        changed = copy.deepcopy(previous)
        changed["Statement"][1]["Action"].append("iam:UpdateRole")
        with self.assertRaises(ValueError):
            self.revision.validate_live_policy(changed, self.desired[self.execution])

    def test_revision_context_is_test_only_and_never_accepts_other_operations(self):
        self.assertTrue(hasattr(self.revision, "validate_context"), "TEST-only context guard is missing")
        env = {"GITHUB_ACTIONS": "true", "GITHUB_EVENT_NAME": "workflow_dispatch",
               "GITHUB_REPOSITORY": "LynxPardelle/zoolandingpage-aws-infra", "GITHUB_REF": "refs/heads/test",
               "GITHUB_SHA": "a" * 40, "REVIEWED_SOURCE_SHA": "a" * 40,
               "GITHUB_RUN_ID": "123", "GITHUB_RUN_ATTEMPT": "1"}
        self.revision.validate_context("verify", env)
        self.revision.validate_context("apply", env)
        for variant in ("production", "wrong-source", "wrong-repository", "invalid-operation"):
            changed = dict(env)
            operation = "apply"
            if variant == "production": changed["GITHUB_REF"] = "refs/heads/main"
            elif variant == "wrong-source": changed["REVIEWED_SOURCE_SHA"] = "b" * 40
            elif variant == "wrong-repository": changed["GITHUB_REPOSITORY"] = "Other/repo"
            else: operation = "provision"
            with self.subTest(variant=variant), self.assertRaises(ValueError):
                self.revision.validate_context(operation, changed)

    def test_runner_rejects_unpinned_context_before_any_provider_call(self):
        self.assertTrue(hasattr(self.revision, "run_revision"), "guarded revision runner is missing")
        with self.assertRaises(ValueError):
            self.revision.run_revision("apply", {"additions": self.desired, "authority": {}}, "0" * 64,
                                       {"GITHUB_REF": "refs/heads/main"})

    def test_direct_workflow_entrypoint_imports_without_pythonpath(self):
        result = subprocess.run([sys.executable, str(MODULE), "--help"],
                                cwd=MODULE.parents[1], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
