"""Audit or enable deletion protection on the three existing THN prerequisite stacks.

This operator tool never creates a stack, changes its template, or disables protection.
It uses the existing AWS CLI session and only prints non-sensitive status fields.
"""

import argparse
import hashlib
import json
import subprocess


STACKS = (
    "zoolanding-auth-admin-test",
    "zoolanding-content-hub-test",
    "zoolanding-api-proxy-test",
)
REGION = "us-east-1"
ACCOUNT_SHA256 = "3e19eeb25ac142d015c5a4d347dc58784b0a79a124f1353b5e92d90673810a8f"
STABLE = {"CREATE_COMPLETE", "UPDATE_COMPLETE", "UPDATE_ROLLBACK_COMPLETE"}


def reconcile(client, *, apply=False):
    states = {name: client.read(name) for name in STACKS}
    if any(state.get("StackStatus") not in STABLE for state in states.values()):
        raise ValueError("test_stack_not_stable")
    results = []
    for name in STACKS:
        changed = not states[name].get("EnableTerminationProtection", False)
        if apply and changed:
            # Recheck immediately before each write. Earlier completed protection
            # changes are deliberately retained if a later operation fails.
            current = client.read(name)
            if current.get("StackStatus") not in STABLE:
                raise ValueError("test_stack_changed_during_preflight")
            client.protect(name)
            if not client.read(name).get("EnableTerminationProtection", False):
                raise ValueError("test_stack_protection_readback_failed")
        results.append({
            "stack": name,
            "change_required": changed,
            "protected": bool(apply or not changed),
            "applied": bool(apply and changed),
        })
    return results


class AwsCli:
    def __init__(self):
        identity = self.call("sts", "get-caller-identity")
        account = identity.get("Account", "")
        if hashlib.sha256(account.encode("ascii")).hexdigest() != ACCOUNT_SHA256:
            raise ValueError("aws_account_not_approved")

    @staticmethod
    def call(*args):
        result = subprocess.run(
            ["aws", *args, "--region", REGION, "--output", "json", "--no-cli-pager"],
            capture_output=True,
            check=False,
        )
        if result.returncode:
            raise ValueError("aws_operation_failed")
        return json.loads(result.stdout)

    def read(self, name):
        if name not in STACKS:
            raise ValueError("stack_not_allowlisted")
        return self.call(
            "cloudformation", "describe-stacks", "--stack-name", name,
            "--query", "Stacks[0].{StackStatus:StackStatus,EnableTerminationProtection:EnableTerminationProtection}",
        )

    def protect(self, name):
        if name not in STACKS:
            raise ValueError("stack_not_allowlisted")
        self.call(
            "cloudformation", "update-termination-protection",
            "--stack-name", name, "--enable-termination-protection",
        )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Enable protection after all preflight checks pass.")
    args = parser.parse_args()
    try:
        results = reconcile(AwsCli(), apply=args.apply)
    except (ValueError, OSError):
        print(json.dumps({"status": "blocked", "reason": "preflight_or_operation_failed"}))
        return 1
    print(json.dumps(results, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
