"""실제 은행·자격증명 없이 실행 경계와 관찰 검증을 검사한다."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock
from unittest.mock import patch
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location('bank_worker', Path(__file__).with_name('worker.py'))
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class CaptureTests(unittest.TestCase):
    """잘못된 계좌·금액·대출 유형을 저장하지 않는다."""
    def row(self, **extra):
        return dict(accountNumber='110-123-456789', accountLast4='6789', pageKind='deposit_account_list', amountKrw='0', loanType=None, maturityDate=None, **extra)

    def test_zero_and_negative_ledger_balance(self):
        for amount in ['0', '-123', '1000000']:
            raw = self.row(); raw['amountKrw'] = amount
            result = worker.capture(raw)
            self.assertEqual(result['balanceKrw'], amount)
            self.assertNotIn('accountNumber', result)
            self.assertEqual(len(result['accountFingerprint']), 64)

    def test_masked_number_mismatched_last4_and_extra_keys(self):
        for updates in [{'accountNumber': '110-***-456789'}, {'accountLast4': '0000'}, {'password': 'fixture'}]:
            with self.subTest(updates=updates), self.assertRaises(worker.Stopped):
                worker.capture(dict(self.row(), **updates))

    def test_amount_edge_cases(self):
        for amount in ['1,000', '1.0', '1e3', '01', '-0', '1\n', 100, True, '9' * 21]:
            with self.subTest(amount=amount), self.assertRaises(worker.Stopped):
                worker.capture(dict(self.row(), amountKrw=amount))

    def test_loan_dates_types_and_nonnegative(self):
        raw = dict(self.row(), pageKind='loan_account_list', loanType='jeonse', maturityDate='2028-02-29', amountKrw='123')
        self.assertEqual(worker.capture(raw)['outstandingPrincipalKrw'], '123')
        for updates in [{'maturityDate': '2027-02-29'}, {'amountKrw': '-1'}, {'loanType': 'guessed'}]:
            with self.subTest(updates=updates), self.assertRaises(worker.Stopped):
                worker.capture(dict(raw, **updates))


class ProtocolTests(unittest.TestCase):
    """모델의 자기 보고만으로 실행·저장을 성공 처리하지 않는다."""
    def setUp(self):
        self.process = Mock()
        self.client = worker.CodexClient(self.process, Mock())
        self.client.thread_id = 'thread'; self.client.turn_id = 'turn'

    def event(self, method, item, **extra):
        return {'method': method, 'params': dict(threadId='thread', turnId='turn', item=item, **extra)}

    def test_native_success_and_logout_are_observed(self):
        item = {'id': 'native-1', 'type': 'mcpToolCall', 'server': 'cua_repl', 'tool': 'js'}
        self.client.observe(self.event('item/started', item))
        self.client.observe(self.event('item/completed', dict(item, status='completed', result={'content': [{'type': 'text', 'text': 'https://bank.shinhan.com 안전하게 로그아웃 되었습니다'}]})))
        self.assertEqual(self.client.native_count, 1)
        self.assertTrue(self.client.logout_seen)
        self.assertTrue(self.client.bank_origin_seen)

    def test_failed_native_tool_unknown_tool_and_cross_turn(self):
        cases = [self.event('item/started', {'type': 'commandExecution'}),
            self.event('item/started', {'type': 'mcpToolCall', 'server': 'other', 'tool': 'js'}),
            {'method': 'item/completed', 'params': {'threadId': 'other', 'turnId': 'turn', 'item': {}}},
            self.event('item/completed', {'id': 'absent', 'type': 'mcpToolCall', 'server': 'cua_repl', 'tool': 'js', 'status': 'failed'})]
        for value in cases:
            with self.subTest(value=value), self.assertRaises(worker.Stopped):
                self.client.observe(value)

    def test_capture_requires_observed_bank_ui(self):
        value = {'id': 3, 'method': 'item/tool/call', 'params': {'threadId': 'thread', 'turnId': 'turn', 'tool': 'moa_capture', 'arguments': {}}}
        with self.assertRaises(worker.Stopped):
            self.client.observe(value)
        self.client.check_active.assert_called_once()

    def test_approval_is_never_accepted_automatically(self):
        value = {'id': 7, 'method': 'item/commandExecution/requestApproval', 'params': {'threadId': 'thread', 'turnId': 'turn'}}
        with self.assertRaisesRegex(worker.Stopped, 'authentication_required'):
            self.client.observe(value)
        sent = json.loads(self.process.stdin.write.call_args.args[0])
        self.assertIn('error', sent)
        self.assertNotIn('result', sent)

    def test_final_claim_cannot_increment_native_evidence(self):
        self.client.observe(self.event('item/completed', {'type': 'agentMessage', 'text': '{"status":"succeeded","logoutConfirmed":true,"errorCode":null}'}))
        self.assertEqual(self.client.native_count, 0)
        self.assertFalse(self.client.logout_seen)

    def test_old_logout_cannot_prove_logout_after_capture(self):
        self.client.native_count = 1; self.client.bank_origin_seen = True; self.client.logout_seen = True
        arguments = {'accountNumber': '110-123-456789', 'accountLast4': '6789', 'pageKind': 'deposit_account_list', 'amountKrw': '0', 'loanType': None, 'maturityDate': None}
        self.client.observe({'id': 3, 'method': 'item/tool/call', 'params': {'threadId': 'thread', 'turnId': 'turn', 'tool': 'moa_capture', 'arguments': arguments}})
        self.assertFalse(self.client.logout_seen)
        self.assertEqual(len(self.client.observations), 1)


class PrivateStateTests(unittest.TestCase):
    """새 페어링 키의 권한과 링크 경계를 검사한다."""
    def test_private_roundtrip_and_public_permissions_refused(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'state.json'
            worker.write_private(path, {'secret': 'synthetic-test-only'})
            self.assertEqual(worker.read_private(path)['secret'], 'synthetic-test-only')
            os.chmod(path, 0o644)
            with self.assertRaises(worker.Stopped):
                worker.read_private(path)

    def test_symlink_refused(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); real = root / 'real'; real.write_text('{}')
            link = root / 'link'; link.symlink_to(real)
            with self.assertRaises(worker.Stopped):
                worker.write_private(link, {'secret': 'synthetic'})
            with self.assertRaises(worker.Stopped):
                worker.read_private(link)

    def test_admission_failure_keeps_claim_for_unknown_result_recovery(self):
        with tempfile.TemporaryDirectory() as folder:
            state = Path(folder) / 'state.json'
            worker.write_private(state, {'secret': 'synthetic-test-only'})
            args = SimpleNamespace(state=state, resource_policy=Path(folder) / 'policy.py')
            with patch.object(worker, 'resource_policy', side_effect=worker.Stopped('runtime_unavailable')):
                with self.assertRaises(worker.Stopped):
                    worker.guarded_phase(args, {'id': 'job-1', 'claimId': 'claim-1'})
            self.assertEqual(worker.read_private(state)['active'], {'id': 'job-1', 'claimId': 'claim-1', 'continueVersion': 0, 'uncertain': True})

    def test_lost_auth_response_cannot_undo_user_continue(self):
        api = Mock()
        for job in [{'id': 'job-1', 'state': 'authentication_required', 'continueVersion': 0}, {'id': 'job-1', 'state': 'running', 'continueVersion': 1}]:
            state = {'active': {'id': 'job-1', 'continueVersion': 0, 'uncertain': True}, 'completion': {'outcome': 'authentication_required'}}
            worker.recover_completion(api, job, state)
            self.assertFalse(state['active']['uncertain'])
            self.assertNotIn('completion', state)
        api.call.assert_not_called()

    def test_unacknowledged_auth_wait_stays_uncertain(self):
        api = Mock()
        state = {'active': {'id': 'job-1', 'continueVersion': 0, 'uncertain': True}, 'completion': {'outcome': 'authentication_required'}}
        worker.recover_completion(api, {'id': 'job-1', 'state': 'running', 'continueVersion': 0}, state)
        self.assertTrue(state['active']['uncertain'])
        api.call.assert_not_called()


if __name__ == '__main__':
    unittest.main()
