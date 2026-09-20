"""Offline safety checks for the exact THN TEST IAM addition."""

import copy
import hashlib
import importlib.util
import inspect
import json
import unittest
from pathlib import Path


MODULE = Path(__file__).resolve().parents[1] / "tools" / "thn_dedicated_identity_release.py"


def load_release():
    if not MODULE.is_file():
        return None
    spec = importlib.util.spec_from_file_location("thn_dedicated_identity_release", MODULE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class DedicatedIdentityReleaseTests(unittest.TestCase):
    def setUp(self):
        self.release = load_release()
        self.assertIsNotNone(self.release, "the guarded release implementation is missing")
        self.github = "ApiProxyThnTestGithubRole812293BE"
        self.role = "ThnDedicatedRuntimeTestCloudFormationRoleCF799F56"
        self.additions = {
            self.role: {
                "Type": "AWS::IAM::Role",
                "DeletionPolicy": "Retain",
                "UpdateReplacePolicy": "Retain",
                "Properties": {
                    "RoleName": "zoolanding-deployer-thn-auth-runtime-test-cfn-exec",
                    "AssumeRolePolicyDocument": {"Statement": [{"Effect": "Allow", "Principal": {"Service": "cloudformation.amazonaws.com"}, "Action": "sts:AssumeRole"}]},
                },
            },
            "ThnDedicatedRuntimeTestGithubPolicy": {
                "Type": "AWS::IAM::Policy",
                "Properties": {"PolicyName": "ThnDedicatedRuntimeTestGithubV1", "Roles": [{"Ref": self.github}], "PolicyDocument": {"Statement": []}},
            },
            "ThnDedicatedRuntimeTestExecutionPolicy": {
                "Type": "AWS::IAM::Policy",
                "Properties": {"PolicyName": "ThnDedicatedRuntimeTestExecutionV1", "Roles": [{"Ref": self.role}], "PolicyDocument": {"Statement": []}},
            },
        }
        self.original = {
            "AWSTemplateFormatVersion": "2010-09-09",
            "Parameters": {"Opaque": {"Type": "String", "NoEcho": True}},
            "Resources": {self.github: {"Type": "AWS::IAM::Role", "Properties": {
                "RoleName": "zoolanding-deployer-api-proxy-test-github-deploy",
                "AssumeRolePolicyDocument": {"Statement": [{"Condition": {"StringEquals": {
                    "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
                    "token.actions.githubusercontent.com:sub": "repo:LynxPardelle/zoolanding-api-proxy:environment:test",
                    "token.actions.githubusercontent.com:ref": "refs/heads/test",
                }}}]},
            }}},
            "Outputs": {"Preserved": {"Value": "same"}},
        }

    def test_compose_preserves_every_existing_field_and_adds_only_three_resources(self):
        before = copy.deepcopy(self.original)
        composed = self.release.compose_template(self.original, self.additions)
        self.assertEqual(self.original, before)
        self.assertEqual(composed["Outputs"], before["Outputs"])
        self.assertEqual(composed["Parameters"], before["Parameters"])
        self.assertEqual(set(composed["Resources"]) - set(before["Resources"]), set(self.additions))

    def test_compose_rejects_collision_and_unrelated_resource(self):
        collision = copy.deepcopy(self.original)
        collision["Resources"][self.role] = {"Type": "AWS::IAM::Role"}
        with self.assertRaises(ValueError):
            self.release.compose_template(collision, self.additions)
        extra = copy.deepcopy(self.additions)
        extra["Unexpected"] = {"Type": "AWS::IAM::Role"}
        with self.assertRaises(ValueError):
            self.release.compose_template(self.original, extra)

    def test_compose_rejects_missing_or_changed_existing_github_role(self):
        for variant in ("missing", "wrong-ref", "wrong-trust"):
            original = copy.deepcopy(self.original)
            additions = copy.deepcopy(self.additions)
            if variant == "missing":
                del original["Resources"][self.github]
            elif variant == "wrong-ref":
                additions["ThnDedicatedRuntimeTestGithubPolicy"]["Properties"]["Roles"] = [{"Ref": "Other"}]
            else:
                original["Resources"][self.github]["Properties"]["AssumeRolePolicyDocument"]["Statement"][0]["Condition"]["StringEquals"]["token.actions.githubusercontent.com:ref"] = "refs/heads/main"
            with self.subTest(variant=variant), self.assertRaises(ValueError):
                self.release.compose_template(original, additions)

    def test_review_accepts_only_exact_three_add_change_set(self):
        change = {"Status": "CREATE_COMPLETE", "ExecutionStatus": "AVAILABLE", "ChangeSetType": "UPDATE", "IncludeNestedStacks": False,
                  "Changes": [{"Type": "Resource", "ResourceChange": {"Action": "Add", "LogicalResourceId": key,
                  "ResourceType": value["Type"], "Replacement": "False"}} for key, value in self.additions.items()]}
        self.release.review_changeset(change)
        for variant in ("extra", "modify", "replace", "nested", "wrong-type", "duplicate", "pagination"):
            bad = copy.deepcopy(change)
            if variant == "extra": bad["Changes"].append({"Type": "Resource", "ResourceChange": {"Action": "Add", "LogicalResourceId": "Other", "ResourceType": "AWS::IAM::Policy"}})
            if variant == "modify": bad["Changes"][0]["ResourceChange"]["Action"] = "Modify"
            if variant == "replace": bad["Changes"][0]["ResourceChange"]["Replacement"] = "True"
            if variant == "nested": bad["IncludeNestedStacks"] = True
            if variant == "wrong-type": bad["Changes"][0]["ResourceChange"]["ResourceType"] = "AWS::S3::Bucket"
            if variant == "duplicate": bad["Changes"][1] = copy.deepcopy(bad["Changes"][0])
            if variant == "pagination": bad["NextToken"] = "more"
            with self.subTest(variant=variant), self.assertRaises(ValueError):
                self.release.review_changeset(bad)

    def test_candidate_requires_independently_selected_digest_and_test_authority(self):
        self.assertTrue(hasattr(self.release, "validate_candidate"), "candidate validator is missing")
        authority = {"account": "123456789012", "region": "us-east-1",
                     "stackName": "ZoolandingTest-Zoolandingpage-test-ServiceRepositoryBootstrap",
                     "lookup": "arn:aws:iam::123456789012:role/cdk-hnb659fds-lookup-role-123456789012-us-east-1",
                     "deploy": "arn:aws:iam::123456789012:role/cdk-hnb659fds-deploy-role-123456789012-us-east-1",
                     "publisher": "arn:aws:iam::123456789012:role/cdk-hnb659fds-file-publishing-role-123456789012-us-east-1",
                     "cfn": "arn:aws:iam::123456789012:role/cdk-hnb659fds-cfn-exec-role-123456789012-us-east-1",
                     "bucket": "cdk-hnb659fds-assets-123456789012-us-east-1"}
        raw = json.dumps(self.additions, sort_keys=True, separators=(",", ":")).encode()
        digest = hashlib.sha256(raw).hexdigest()
        self.release.validate_candidate({"additions": self.additions, "authority": authority}, digest)
        with self.assertRaises(ValueError):
            self.release.validate_candidate({"additions": self.additions, "authority": authority}, "0" * 64)
        bad = copy.deepcopy(authority)
        bad["stackName"] = "ZoolandingProduction-Zoolandingpage-production-ServiceRepositoryBootstrap"
        with self.assertRaises(ValueError):
            self.release.validate_candidate({"additions": self.additions, "authority": bad}, digest)

    def test_release_rejects_unpinned_or_non_test_context_before_aws(self):
        self.assertTrue(hasattr(self.release, "run_release"), "guarded release runner is missing")
        candidate = {"additions": self.additions, "authority": {}}
        with self.assertRaises(ValueError):
            self.release.run_release("apply", candidate, "0" * 64, {"GITHUB_REF": "refs/heads/main"})

    def test_live_github_role_requires_exact_test_oidc_trust(self):
        self.assertTrue(hasattr(self.release, "validate_live_github_role"), "live OIDC trust check is missing")
        account = "123456789012"
        role = {"RoleName": "zoolanding-deployer-api-proxy-test-github-deploy",
                "Arn": f"arn:aws:iam::{account}:role/zoolanding-deployer-api-proxy-test-github-deploy",
                "Path": "/", "AssumeRolePolicyDocument": {"Statement": [{"Effect": "Allow",
                    "Principal": {"Federated": f"arn:aws:iam::{account}:oidc-provider/token.actions.githubusercontent.com"},
                    "Action": "sts:AssumeRoleWithWebIdentity", "Condition": {"StringEquals": {
                        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
                        "token.actions.githubusercontent.com:sub": "repo:LynxPardelle/zoolanding-api-proxy:environment:test",
                        "token.actions.githubusercontent.com:ref": "refs/heads/test"}}}]}}
        self.release.validate_live_github_role(role, account)
        broadened = copy.deepcopy(role)
        broadened["AssumeRolePolicyDocument"]["Statement"][0]["Condition"]["StringEquals"]["token.actions.githubusercontent.com:ref"] = "refs/heads/main"
        with self.assertRaises(ValueError):
            self.release.validate_live_github_role(broadened, account)

    def test_asset_encryption_rejects_unencrypted_or_foreign_key(self):
        self.assertTrue(hasattr(self.release, "validate_asset_encryption"), "asset encryption check is missing")
        key = {"Arn": "arn:aws:kms:us-east-1:123456789012:key/example", "KeyManager": "AWS", "Enabled": True, "KeyState": "Enabled"}
        bucket = {"Rules": [{"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "aws:kms", "KMSMasterKeyID": key["Arn"]}}]}
        self.release.validate_asset_encryption(bucket, key)
        bad = copy.deepcopy(bucket)
        bad["Rules"][0]["ApplyServerSideEncryptionByDefault"]["SSEAlgorithm"] = "AES256"
        with self.assertRaises(ValueError):
            self.release.validate_asset_encryption(bad, key)

    def test_final_policy_readback_requires_both_new_attachments(self):
        self.assertTrue(hasattr(self.release, "validate_final_policies"), "final policy readback is missing")
        self.release.validate_final_policies(
            {"PolicyNames": ["Existing", "ThnDedicatedRuntimeTestGithubV1"], "IsTruncated": False},
            {"PolicyNames": ["ThnDedicatedRuntimeTestExecutionV1"], "IsTruncated": False})
        with self.assertRaises(ValueError):
            self.release.validate_final_policies(
                {"PolicyNames": ["Existing"], "IsTruncated": False},
                {"PolicyNames": ["ThnDedicatedRuntimeTestExecutionV1"], "IsTruncated": False})

    def test_stage_error_reports_only_allowlisted_stage_and_aws_code(self):
        secret = "do-not-print-secret"
        class FakeAwsError(Exception):
            response = {"Error": {"Code": "AccessDenied", "Message": secret}}

        with self.assertRaises(self.release.ReleaseStageError) as captured:
            self.release.aws_stage("candidate_upload", lambda: (_ for _ in ()).throw(FakeAwsError(secret)))
        self.assertEqual(str(captured.exception), "candidate_upload:AccessDenied")
        self.assertNotIn(secret, str(captured.exception))
        with self.assertRaises(ValueError):
            self.release.aws_stage("unreviewed_stage", lambda: None)

    def test_postmortem_target_is_fixed_to_one_previous_run(self):
        target = self.release.postmortem_target("35486800813", "1", "a" * 40, "b" * 64)
        self.assertEqual(target["name"], "thn-dedicated-identity-35486800813-1")
        self.assertEqual(target["key"], "thn-dedicated-identity/35486800813/1/" + "a" * 40 + "/" + "b" * 64 + ".json")
        for run, attempt in (("0", "1"), ("not-a-run", "1"), ("35486800813", "0")):
            with self.subTest(run=run, attempt=attempt), self.assertRaises(ValueError):
                self.release.postmortem_target(run, attempt, "a" * 40, "b" * 64)

    def test_diagnose_returns_before_first_mutating_aws_call(self):
        source = inspect.getsource(self.release.run_release)
        self.assertLess(source.index('if operation == "diagnose":'), source.index('publisher.put_object'))
        self.assertLess(source.index('return f"diagnosed_object_'), source.index('publisher.put_object'))


if __name__ == "__main__":
    unittest.main()
