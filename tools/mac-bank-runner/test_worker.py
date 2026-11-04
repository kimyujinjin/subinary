"""실제 은행·자격증명 없이 실행 경계와 관찰 검증을 검사한다."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
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
            self.assertEqual(worker.read_private(state)['active'], {'id': 'job-1', 'claimId': 'claim-1', 'continueVersion': 0, 'uncertain': True, 'loginAttempted': False})

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


class ClaimJournalTests(unittest.TestCase):
    """로그인 정보는 최초 claim에서 한 번만 받고, 이어가기는 다시 받지 않으며 평문을 기록하지 않는다."""
    def test_claim_journal_contains_attempt_only_and_continue_cannot_redeliver(self):
        raw = {'loginId': 'synthetic-id', 'password': 'synthetic-"\\-password', 'credentialVersion': 3}
        with tempfile.TemporaryDirectory() as folder:
            state_path = Path(folder) / 'state.json'
            state = {'secret': 'fixture-runner-key'}
            worker.write_private(state_path, state)
            job = {'id': 'job-1', 'claimId': 'claim-1', 'credentialVersion': 3, 'continueVersion': 0, 'state': 'running'}
            def call(path, body):
                if path.endswith('/heartbeat'):
                    return {'paired': True, 'job': job}
                if path.endswith('/credentials'):
                    return dict(raw)
                return {}
            api = Mock(); api.call.side_effect = call
            callbacks = []
            def phase(aside, active, credentials, progress, capture, labels, diagnose=None):
                callbacks.append(credentials)
                if credentials:
                    value = credentials(); self.assertEqual(value['password'], raw['password']); value.clear()
                return {'outcome': 'authentication_required', 'errorCode': 'authentication_required', 'logoutConfirmed': False, 'observations': []}
            args = SimpleNamespace(state=state_path, aside='fixture')
            with patch.object(worker, 'shinhan_repl', return_value=SimpleNamespace(repl_phase=phase)):
                worker.run_phase(args, api, job, state)
                job['continueVersion'] = 1
                worker.run_phase(args, api, job, state)
            self.assertIsNone(callbacks[1])
            persisted = state_path.read_text()
            self.assertNotIn(raw['password'], persisted); self.assertNotIn(raw['loginId'], persisted)
            self.assertTrue(worker.read_private(state_path)['active']['loginAttempted'])


if __name__ == '__main__':
    unittest.main()
