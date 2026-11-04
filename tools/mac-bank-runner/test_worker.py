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

    def native_reply(self, code):
        if code.startswith('nodeRepl.write(await '): return self.ax
        if 'MOA_LOGIN_SUBMITTED' in code: return 'MOA_LOGIN_SUBMITTED'
        if 'MOA_KEY_ENTERED' in code: return 'MOA_KEY_ENTERED'
        if 'MOA_FIELD_ENTERED' in code: return 'MOA_FIELD_ENTERED'
        return 'app'

    def test_login_submits_once_without_returning_credentials_to_model(self):
        password_length = len(self.raw['password'])
        self.client.native_call = Mock(side_effect=self.native_reply)
        request = {'id': 3, 'method': 'item/tool/call', 'params': {'threadId': 'thread', 'turnId': 'turn', 'tool': 'moa_login', 'arguments': {}}}
        self.client.observe(request)
        self.client.observe(dict(request, id=4))
        self.credentials.assert_called_once()
        self.assertEqual(self.client.native_call.call_count, 8 + password_length)
        self.assertEqual(self.raw, {})
        responses = str(self.process.stdin.write.call_args_list)
        self.assertNotIn('synthetic-id', responses)
        self.assertNotIn('synthetic-', responses)
        codes = [call.args[0] for call in self.client.native_call.call_args_list]
        self.assertEqual(sum('typeText(' in code for code in codes), 1)
        self.assertEqual(sum('MOA_LOGIN_SUBMITTED' in code for code in codes), 1)

    def test_changed_origin_or_missing_fields_never_retrieves_password(self):
        for ax in [self.ax.replace('bank.shinhan.com', 'evil.invalid'), self.ax.replace('비밀번호', '보안카드')]:
            self.client.native_call = Mock(side_effect=['app', ax])
            with self.assertRaises(worker.Stopped):
                self.client.login()
        self.credentials.assert_not_called()

    def test_failed_input_never_retries_within_same_claim(self):
        self.client.native_call = Mock(side_effect=['app', self.ax, 'reload', self.ax, worker.Stopped('unsupported_layout')])
        with self.assertRaises(worker.Stopped):
            self.client.login()
        self.assertEqual(self.raw, {})
        self.assertIn('이미 한 번', self.client.login())
        self.credentials.assert_called_once()

    def test_each_native_input_rechecks_origin_before_typing(self):
        self.client.native_call = Mock(side_effect=self.native_reply)
        self.client.login()
        codes = [call.args[0] for call in self.client.native_call.call_args_list if worker.BANK_AX_JS in call.args[0]]
        executable = shutil.which('node')
        self.assertIsNotNone(executable)
        # 실제 RPC에 보낼 JS를 합성 native 입력기에서 실행해 주소 변경 시 입력이 없는지 검증한다.
        for index, code in enumerate(codes):
            for host in ['bank.shinhan.com', 'evil.invalid', 'bank.shinhan.com.evil.invalid']:
                ax = self.ax.replace('bank.shinhan.com', host) + '\n100 버튼 가상키보드 닫기\n'
                ax += '\n'.join(str(index + 101) + ' 버튼 ' + label for index, label in enumerate(worker.VIRTUAL_KEY_LABELS.values()))
                harness = 'var actions=[]; var nodeRepl={write:()=>{}}; var __moaBrokerAside={getAXState:async()=>'+json.dumps(ax)+',click:async(v)=>actions.push(v),pressKey:async()=>{},typeText:async()=>actions.push("typed")};'
                harness += '(async()=>{try{'+code+';console.log(JSON.stringify({ok:true,actions}));}catch{console.log(JSON.stringify({ok:false,actions}));}})();'
                result = subprocess.run([executable, '-e', harness], capture_output=True, text=True, check=True)
                observed = json.loads(result.stdout)
                with self.subTest(step=index, host=host):
                    self.assertEqual(observed['ok'], host == 'bank.shinhan.com')
                    if host != 'bank.shinhan.com': self.assertEqual(observed['actions'], [])

    def test_delivery_failure_is_not_automatically_retried(self):
        self.client.native_call = Mock(side_effect=self.native_reply)
        self.credentials.side_effect = worker.Stopped('api_unavailable')
        with self.assertRaises(worker.Stopped):
            self.client.login()
        self.client.login()
        self.credentials.assert_called_once()

    def test_unsupported_character_stops_before_any_credential_input(self):
        self.raw['password'] = 'has space'
        self.client.native_call = Mock(side_effect=self.native_reply)
        with self.assertRaisesRegex(worker.Stopped, 'authentication_required'):
            self.client.login()
        self.assertEqual(self.raw, {})
        self.assertFalse(any('typeText(' in call.args[0] or 'MOA_LOGIN_SUBMITTED' in call.args[0]
                             for call in self.client.native_call.call_args_list))

    def test_reload_must_confirm_fresh_password_form_before_delivery(self):
        self.client.native_call = Mock(side_effect=['app', self.ax, 'reload'] + ['로딩 중'] * 3)
        with patch.object(worker.time, 'monotonic', side_effect=[0, 1, 4, 8, 13]):
            with self.assertRaisesRegex(worker.Stopped, 'unsupported_layout'):
                self.client.login()
        self.credentials.assert_not_called()

    def test_slow_reload_waits_for_both_fields_within_original_deadline(self):
        reads = 0
        original_deadline = self.client.deadline
        def delayed_reply(code):
            nonlocal reads
            if code.startswith('nodeRepl.write(await '):
                reads += 1
                if 2 <= reads <= 7:
                    self.credentials.assert_not_called()
                    return self.ax.replace('91 텍스트 필드 (settable) 이용자ID', '아직 ID 입력창 로딩 중') if reads == 7 else '로딩 중'
            return self.native_reply(code)
        self.client.native_call = Mock(side_effect=delayed_reply)
        with patch.object(worker.time, 'monotonic', side_effect=range(20)):
            self.client.login()
        self.assertEqual(reads, 8)
        self.credentials.assert_called_once()
        self.assertEqual(self.client.deadline, original_deadline)

    def test_reload_readiness_cannot_extend_overall_phase_deadline(self):
        self.client.deadline = 3
        self.client.native_call = Mock(side_effect=['app', self.ax, 'reload', '로딩 중'])
        with patch.object(worker.time, 'monotonic', side_effect=[0, 1, 3]):
            with self.assertRaisesRegex(worker.Stopped, 'unsupported_layout'):
                self.client.login()
        self.credentials.assert_not_called()

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
            args = SimpleNamespace(state=state_path, codex='fixture', engine='codex')
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
            '-c', 'thread_unload_delay_secs=0',
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


class VirtualKeyboardTests(unittest.TestCase):
    """배치가 바뀌거나 Shift 후 주소가 바뀌면 이전 인덱스로 입력하지 않는다."""
    def run_script(self, states, label='대문자A'):
        code = worker.virtual_key_script(label)
        harness = 'var states='+json.dumps(states)+';var actions=[];var nodeRepl={write:()=>{}};'
        harness += 'var __moaBrokerAside={getAXState:async()=>states.length>1?states.shift():states[0],click:async(v)=>actions.push(v)};'
        harness += '(async()=>{try{'+code+';console.log(JSON.stringify({ok:true,actions}));}catch{console.log(JSON.stringify({ok:false,actions}));}})();'
        result = subprocess.run([shutil.which('node'), '-e', harness], capture_output=True, text=True, check=True)
        return json.loads(result.stdout)

    def test_shift_uses_newly_observed_key_index(self):
        initial = 'URL: bank.shinhan.com/\n1 버튼 가상키보드 닫기\n2 버튼 왼쪽 쉬프트\n3 버튼 a'
        shifted = 'URL: bank.shinhan.com/\n11 버튼 가상키보드 닫기\n12 버튼 왼쪽 쉬프트\n13 버튼 대문자A'
        self.assertEqual(self.run_script([initial, shifted]), {'ok': True, 'actions': [2, 13]})
        self.assertEqual(self.run_script([shifted]), {'ok': True, 'actions': [13]})

    def test_changed_origin_missing_or_duplicate_key_never_types(self):
        initial = 'URL: bank.shinhan.com/\n1 버튼 가상키보드 닫기\n2 버튼 왼쪽 쉬프트\n3 버튼 a'
        for changed in ['URL: evil.invalid/\n1 버튼 가상키보드 닫기\n13 버튼 대문자A',
                        'URL: bank.shinhan.com/\n1 버튼 가상키보드 닫기',
                        'URL: bank.shinhan.com/\n1 버튼 가상키보드 닫기\n13 버튼 대문자A\n14 버튼 대문자A']:
            self.assertEqual(self.run_script([initial, changed]), {'ok': False, 'actions': [2]})
        self.assertEqual(self.run_script(['URL: bank.shinhan.com/\n13 버튼 대문자A']), {'ok': False, 'actions': []})

    def test_only_observed_printable_keys_are_supported(self):
        self.assertEqual(set(worker.VIRTUAL_KEY_LABELS), {chr(code) for code in range(33, 127)})
        self.assertEqual(len(set(worker.VIRTUAL_KEY_LABELS.values())), 94)
        self.assertEqual(worker.VIRTUAL_KEY_LABELS['"'], '따옴표')
        self.assertEqual(worker.VIRTUAL_KEY_LABELS['\\'], '원기호')


class ThreadCleanupTests(unittest.TestCase):
    """자원 감시를 유지하면서 공식 수명주기 종료를 먼저 기다린다."""
    def setUp(self):
        self.process = Mock(); self.process.poll.return_value = None
        self.client = worker.CodexClient(self.process, Mock())
        self.client.thread_id = 'own'; self.client.turn_id = 'turn'
        self.closed = {'method': 'thread/closed', 'params': {'threadId': 'own'}}

    def test_completed_thread_waits_for_own_closed_notification(self):
        self.client.complete = True
        self.client.request = Mock(return_value={'status': 'unsubscribed'})
        self.client.receive = Mock(side_effect=[{'method': 'thread/closed', 'params': {'threadId': 'other'}}, self.closed])
        self.assertTrue(self.client.close_thread())
        self.client.request.assert_called_once_with('thread/unsubscribe', {'threadId': 'own'})
        self.client.check_active.assert_not_called()

    def test_active_turn_interrupts_before_unsubscribe_and_rejects_tools(self):
        self.client.request = Mock(side_effect=[{}, {'status': 'unsubscribed'}])
        self.client.receive = Mock(side_effect=[
            {'id': 9, 'method': 'item/tool/call', 'params': {'threadId': 'own', 'tool': 'moa_login', 'arguments': {}}},
            {'method': 'turn/completed', 'params': {'threadId': 'own', 'turn': {'id': 'turn'}}}, self.closed])
        self.client.login = Mock(side_effect=AssertionError('cleanup_must_not_login'))
        self.assertTrue(self.client.close_thread())
        self.assertEqual([call.args[0] for call in self.client.request.call_args_list], ['turn/interrupt', 'thread/unsubscribe'])
        self.client.login.assert_not_called()
        self.assertIn('error', json.loads(self.process.stdin.write.call_args.args[0]))

    def test_unloaded_and_timeout_are_distinguished(self):
        self.client.complete = True
        self.client.request = Mock(return_value={'status': 'notLoaded'})
        self.assertTrue(self.client.close_thread())
        self.client.thread_closed = False
        self.client.request = Mock(return_value={'status': 'unsubscribed'})
        self.client.receive = Mock(side_effect=worker.Stopped('operation_unknown'))
        self.assertFalse(self.client.close_thread())

if __name__ == '__main__':
    unittest.main()
