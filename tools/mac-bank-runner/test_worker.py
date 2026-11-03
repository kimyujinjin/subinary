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
        self.client.observe(self.event('item/completed', dict(item, status='completed', result={'content': [{'type': 'text', 'text': 'URL: bank.shinhan.com/index.jsp\n안전하게 로그아웃 되었습니다'}]})))
        self.assertEqual(self.client.native_count, 1)
        self.assertTrue(self.client.logout_seen)
        self.assertTrue(self.client.bank_origin_seen)

    def test_native_ax_scheme_elision_and_exact_host(self):
        for address in ['https://bank.shinhan.com/index.jsp', 'bank.shinhan.com/index.jsp', 'https://bank.shinhan.com:443/']:
            self.assertTrue(worker.bank_origin_observed('HTML 콘텐츠, URL: ' + address))
        for address in ['http://bank.shinhan.com/', 'bank.shinhan.com.evil.invalid/', 'bank.shinhan.com@evil.invalid/', 'https://evil.invalid/?next=https://bank.shinhan.com', 'https://bank.shinhan.com:999/']:
            self.assertFalse(worker.bank_origin_observed('HTML 콘텐츠, URL: ' + address))
        self.assertFalse(worker.bank_origin_observed('임의 본문 링크 https://bank.shinhan.com'))

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


class LoginBrokerTests(unittest.TestCase):
    """평문을 모델 응답에 넣지 않고 정상 은행 입력을 한 번만 허용한다."""
    def setUp(self):
        self.process = Mock()
        self.raw = {'loginId': 'synthetic-id', 'password': 'synthetic-"\\-password', 'credentialVersion': 3}
        self.credentials = Mock(return_value=self.raw)
        self.client = worker.CodexClient(self.process, Mock(), self.credentials)
        self.client.thread_id = 'thread'; self.client.turn_id = 'turn'
        self.client.native_count = 1; self.client.bank_origin_seen = True; self.client.native_server = 'cua_repl'
        self.ax = '0 윈도우, URL: bank.shinhan.com/index.jsp\n 91 텍스트 필드 (settable) 이용자ID\n 92 보안 텍스트 필드 비밀번호\n 94 link ID 로그인, Value: javascript:void(null);'

    def test_login_submits_once_without_returning_credentials_to_model(self):
        self.client.native_call = Mock(side_effect=['app', self.ax, 'MOA_FIELD_ENTERED', 'MOA_FIELD_ENTERED', 'MOA_LOGIN_SUBMITTED'])
        request = {'id': 3, 'method': 'item/tool/call', 'params': {'threadId': 'thread', 'turnId': 'turn', 'tool': 'moa_login', 'arguments': {}}}
        self.client.observe(request)
        self.client.observe(dict(request, id=4))
        self.credentials.assert_called_once()
        self.assertEqual(self.client.native_call.call_count, 5)
        self.assertEqual(self.raw, {})
        responses = str(self.process.stdin.write.call_args_list)
        self.assertNotIn('synthetic-id', responses)
        self.assertNotIn('synthetic-', responses)

    def test_changed_origin_or_missing_fields_never_retrieves_password(self):
        for ax in [self.ax.replace('bank.shinhan.com', 'evil.invalid'), self.ax.replace('비밀번호', '보안카드')]:
            self.client.native_call = Mock(side_effect=['app', ax])
            with self.assertRaises(worker.Stopped):
                self.client.login()
        self.credentials.assert_not_called()

    def test_failed_input_never_retries_within_same_claim(self):
        self.client.native_call = Mock(side_effect=['app', self.ax, worker.Stopped('unsupported_layout')])
        with self.assertRaises(worker.Stopped):
            self.client.login()
        self.assertEqual(self.raw, {})
        self.assertIn('이미 한 번', self.client.login())
        self.credentials.assert_called_once()

    def test_each_native_input_rechecks_origin_before_typing(self):
        self.client.native_call = Mock(side_effect=['app', self.ax, 'MOA_FIELD_ENTERED', 'MOA_FIELD_ENTERED', 'MOA_LOGIN_SUBMITTED'])
        self.client.login()
        codes = [call.args[0] for call in self.client.native_call.call_args_list][2:]
        executable = shutil.which('node')
        self.assertIsNotNone(executable)
        # 실제 RPC에 보낼 JS를 합성 native 입력기에서 실행해 주소 변경 시 입력이 없는지 검증한다.
        for index, code in enumerate(codes):
            for host in ['bank.shinhan.com', 'evil.invalid', 'bank.shinhan.com.evil.invalid']:
                ax = self.ax.replace('bank.shinhan.com', host)
                harness = 'var actions=[]; var nodeRepl={write:()=>{}}; var __moaBrokerAside={getAXState:async()=>'+json.dumps(ax)+',click:async(v)=>actions.push(v),pressKey:async()=>{},typeText:async()=>actions.push("typed")};'
                harness += '(async()=>{try{'+code+';console.log(JSON.stringify({ok:true,actions}));}catch{console.log(JSON.stringify({ok:false,actions}));}})();'
                result = subprocess.run([executable, '-e', harness], capture_output=True, text=True, check=True)
                observed = json.loads(result.stdout)
                with self.subTest(step=index, host=host):
                    self.assertEqual(observed['ok'], host == 'bank.shinhan.com')
                    if host != 'bank.shinhan.com': self.assertEqual(observed['actions'], [])

    def test_delivery_failure_is_not_automatically_retried(self):
        self.client.native_call = Mock(side_effect=['app', self.ax])
        self.credentials.side_effect = worker.Stopped('api_unavailable')
        with self.assertRaises(worker.Stopped):
            self.client.login()
        self.client.login()
        self.credentials.assert_called_once()

    def test_claim_journal_contains_attempt_only_and_continue_cannot_redeliver(self):
        with tempfile.TemporaryDirectory() as folder:
            state_path = Path(folder) / 'state.json'
            state = {'secret': 'fixture-runner-key'}
            worker.write_private(state_path, state)
            job = {'id': 'job-1', 'claimId': 'claim-1', 'credentialVersion': 3, 'continueVersion': 0, 'state': 'running'}
            def call(path, body):
                if path.endswith('/heartbeat'):
                    return {'paired': True, 'job': job}
                if path.endswith('/credentials'):
                    return dict(self.raw)
                return {}
            api = Mock(); api.call.side_effect = call
            callbacks = []
            def phase(codex, cwd, active, credentials):
                callbacks.append(credentials)
                if credentials:
                    value = credentials(); self.assertEqual(value['password'], self.raw['password']); value.clear()
                return {'outcome': 'authentication_required', 'errorCode': 'authentication_required', 'logoutConfirmed': False, 'observations': []}
            args = SimpleNamespace(state=state_path, codex='fixture')
            with patch.object(worker, 'codex_phase', side_effect=phase):
                worker.run_phase(args, api, job, state)
                job['continueVersion'] = 1
                worker.run_phase(args, api, job, state)
            self.assertIsNone(callbacks[1])
            persisted = state_path.read_text()
            self.assertNotIn(self.raw['password'], persisted); self.assertNotIn(self.raw['loginId'], persisted)
            self.assertTrue(worker.read_private(state_path)['active']['loginAttempted'])



class InvocationConfigTests(unittest.TestCase):
    """전역 설정을 쓰지 않고 해당 App Server의 불필요한 MCP 두 개만 비활성화한다."""
    def test_two_mcp_overrides_apply_only_to_the_owned_child_command(self):
        process = Mock()
        client = Mock(complete=True, normal=True, native_count=1, observations=[],
                      final={'status': 'authentication_required'}, thread_id=None, turn_id=None)
        replies = {
            'initialize': {},
            'account/read': {'account': {'type': 'chatgpt'}},
            'model/list': {'data': [{'model': 'gpt-6-astra'}]},
            'thread/start': {'modelProvider': 'openai', 'thread': {'id': 'synthetic-thread', 'ephemeral': True}},
            'turn/start': {'turn': {'id': 'synthetic-turn'}},
        }
        client.request.side_effect = lambda method, params: replies[method]
        with patch.object(worker.subprocess, 'Popen', return_value=process) as start, \
                patch.object(worker, 'CodexClient', return_value=client), \
                patch('builtins.open', side_effect=AssertionError('global_config_access_forbidden')), \
                patch.object(worker.os, 'open', side_effect=AssertionError('global_config_access_forbidden')), \
                patch.object(Path, 'open', side_effect=AssertionError('global_config_access_forbidden')), \
                patch.object(Path, 'write_text', side_effect=AssertionError('global_config_write_forbidden')), \
                patch.object(Path, 'write_bytes', side_effect=AssertionError('global_config_write_forbidden')):
            result = worker.codex_phase('/synthetic/codex', Path('/synthetic/owned'), Mock())
        self.assertEqual(result['outcome'], 'authentication_required')
        self.assertEqual(start.call_args.args[0], [
            '/synthetic/codex', '-c', 'features.shell_tool=false', '-c', 'web_search="disabled"',
            '-c', 'mcp_servers.node_repl.enabled=false', '-c', 'mcp_servers.family-finance.enabled=false',
            'app-server', '--listen', 'stdio://'])
        self.assertNotIn('env', start.call_args.kwargs)
        self.assertEqual(start.call_args.kwargs['stderr'], subprocess.DEVNULL)
        thread = next(call.args[1] for call in client.request.call_args_list if call.args[0] == 'thread/start')
        self.assertTrue(thread['ephemeral'])
        self.assertEqual(thread['model'], 'gpt-6-astra')
        self.assertEqual(thread['sandbox'], 'read-only')
        self.assertEqual([tool['name'] for tool in thread['dynamicTools']], ['moa_capture', 'moa_login'])

    def test_native_cua_server_aliases_remain_allowed(self):
        for server in ['cua_repl', 'mcp__cua_repl']:
            with self.subTest(server=server):
                client = worker.CodexClient(Mock(), Mock())
                client.thread_id = 'synthetic-thread'; client.turn_id = 'synthetic-turn'
                item = {'id': 'native-1', 'type': 'mcpToolCall', 'server': server, 'tool': 'js'}
                def event(method, value):
                    return {'method': method, 'params': {'threadId': 'synthetic-thread', 'turnId': 'synthetic-turn', 'item': value}}
                client.observe(event('item/started', item))
                client.observe(event('item/completed', dict(item, status='completed', result={'content': []})))
                self.assertEqual(client.native_count, 1)
                self.assertEqual(client.native_server, server)

if __name__ == '__main__':
    unittest.main()
