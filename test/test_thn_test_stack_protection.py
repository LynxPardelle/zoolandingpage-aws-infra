import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

path=Path(__file__).resolve().parents[1]/'tools'/'thn_test_stack_protection.py'
spec=importlib.util.spec_from_file_location('protection',path)
protection=importlib.util.module_from_spec(spec)
if path.exists():
    spec.loader.exec_module(protection)

class FakeAws:
    def __init__(self, unstable=None):
        self.protected={name:False for name in ('zoolanding-auth-admin-test','zoolanding-content-hub-test','zoolanding-api-proxy-test')}
        self.unstable=unstable
        self.writes=[]
    def read(self,name):
        return {'StackStatus':'UPDATE_IN_PROGRESS' if name==self.unstable else 'UPDATE_COMPLETE','EnableTerminationProtection':self.protected[name]}
    def protect(self,name):
        self.writes.append(name)
        self.protected[name]=True

class ProtectionTests(unittest.TestCase):
    def test_default_audit_does_not_write(self):
        client=FakeAws()
        result=protection.reconcile(client)
        self.assertEqual(client.writes,[])
        self.assertEqual(len(result),3)
        self.assertTrue(all(x['change_required'] for x in result))
    def test_apply_only_protects_three_exact_test_stacks_and_is_idempotent(self):
        client=FakeAws()
        result=protection.reconcile(client,apply=True)
        self.assertEqual(set(client.writes),set(client.protected))
        self.assertTrue(all(x['protected'] for x in result))
        protection.reconcile(client,apply=True)
        self.assertEqual(len(client.writes),3)
    def test_preflight_checks_every_stack_before_any_write(self):
        client=FakeAws(unstable='zoolanding-api-proxy-test')
        with self.assertRaises(ValueError):
            protection.reconcile(client,apply=True)
        self.assertEqual(client.writes,[])
    def test_failed_readback_is_not_reported_as_success(self):
        client=FakeAws()
        client.protect=lambda name:None
        with self.assertRaises(ValueError):
            protection.reconcile(client,apply=True)
    def test_aws_adapter_rejects_wrong_account_before_stack_access(self):
        with patch.object(protection.AwsCli, 'call', return_value={'Account':'000000000000'}) as call:
            with self.assertRaisesRegex(ValueError, 'aws_account_not_approved'):
                protection.AwsCli()
        self.assertEqual(call.call_count,1)
    def test_aws_adapter_cannot_target_production(self):
        client=object.__new__(protection.AwsCli)
        with patch.object(protection.AwsCli,'call') as call:
            with self.assertRaisesRegex(ValueError,'stack_not_allowlisted'):
                client.protect('zoolanding-auth-admin-prod')
        call.assert_not_called()

if __name__=='__main__': unittest.main()
