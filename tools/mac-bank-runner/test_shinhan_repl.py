"""실제 은행·Aside 없이 repl 엔진의 입력 경계·판정·로그아웃을 검사한다."""
import importlib.util
import shutil
import subprocess
import itertools
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile
import time
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

HERE = Path(__file__).resolve().parent


def load(name: str, file: str):
    spec = importlib.util.spec_from_file_location(name, HERE / file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


repl = load('moa_shinhan_repl_test', 'shinhan_repl.py')
worker = load('bank_worker_repl_test', 'worker.py')
LABELS = worker.VIRTUAL_KEY_LABELS
LOWER = set('abcdefghijklmnopqrstuvwxyz0123456789`-=\\[];\',./')
UPPER = set(LABELS) - LOWER
STEP = re.compile(r'/\*moa:([a-z-]+)\*/')


class FakeBank:
    """은행 단계 응답을 흉내 낸다. 키패드 ref는 snapshot마다 새로 발급하고 이전 ref는 거절한다."""
    def __init__(self, *, tab_logged_in=False, result=None, loan_tab=None, deposits=None, loans=None, logout=True, fail=None, drop_key=None):
        self.codes: list[str] = []
        self.tab_logged_in, self.logout, self.fail, self.drop_key, self.loan_tab = tab_logged_in, logout, fail, drop_key, loan_tab
        self.result = result or {'result': 'ok', 'hits': [], 'alerts': [], 'hash': '#010800000000', 'loginForm': False}
        self.deposits = deposits if deposits is not None else [{'number': '110-123-456789', 'amount': '2,000,000'}]
        self.loans = loans if loans is not None else [{'name': '<가계>일반자금대출(주택관련 중도금대출)', 'number': '220-333-444555', 'maturity': '2030.05.31', 'amount': '150,000,000'}]
        self.counter = itertools.count(100)
        self.upper = False
        self.length = 0
        self.typed: list[str] = []
        self.refs: dict[str, str] = {}
        self.dead = False
        self.closed = False

    def tree(self) -> str:
        layer = sorted(UPPER if self.upper else LOWER)
        self.refs = {f'e{next(self.counter)}': label for label in ['가상키보드 닫기', '왼쪽 쉬프트', *[LABELS[c] for c in layer]]}
        rows = ['- title: "로그인 | 신한은행 개인뱅킹" [url=https://bank.shinhan.com/index.jsp#011100000000]', '- button "빈칸" [ref=e1]', '- button "빈칸" [ref=e2]']
        return '\n'.join(rows + [f'- button "{label}" [ref={ref}]' for ref, label in self.refs.items()])

    def call(self, code: str, timeout: float) -> dict:
        assert '\n' not in repl.one_line(code)
        self.codes.append(code)
        found = STEP.search(code)
        step = found.group(1) if found else 'helpers'
        if self.fail and self.fail[0] == step:
            if self.fail[1] == 'timeout':
                self.dead = True
            raise repl.ReplFailure(self.fail[1])
        if step == 'helpers': return {'ready': True}
        if step == 'find': return {'bankTabs': 1, 'loggedIn': self.tab_logged_in}
        if step == 'open': return {'ready': True, 'loggedIn': False}
        if step == 'login-id':
            return {'idLength': len(json.loads(re.search(r'keyboard\.type\(("(?:[^"\\]|\\.)*")', code).group(1)))}
        if step == 'keypad': return {'length': self.length, 'tree': self.tree()}
        if step == 'press':
            ref = json.loads(re.search(r'locator\(("[A-Za-z0-9]+")\)\.click', code).group(1))
            if ref not in self.refs:
                raise repl.ReplFailure('unsupported_layout')
            label = self.refs[ref]
            if label == '왼쪽 쉬프트':
                self.upper = not self.upper
            else:
                self.typed.append(label)
                if len(self.typed) != self.drop_key:
                    self.length += 1
            return {'length': self.length, 'tree': self.tree()}
        if step == 'keypad-close': return {'length': self.length, 'open': False}
        if step == 'submit': return {'submitted': True}
        if step == 'result': return dict(self.result)
        if step == 'deposits': return {'deposits': [dict(row) for row in self.deposits], 'layers': 0, 'hits': []}
        if step == 'loans':
            if self.loan_tab is not None: return {'loans': None, 'tab': self.loan_tab}
            return {'loans': [dict(row) for row in self.loans], 'tab': {'marked': True, 'candidates': 1, 'tabs': 1, 'shown': 1}}
        if step == 'logout': return {'logout': self.logout}
        if step == 'cleanup': return {'cleaned': True}
        raise AssertionError(step)

    def close(self) -> None:
        self.closed = True

    def steps(self) -> list[str]:
        return [(STEP.search(code).group(1) if STEP.search(code) else 'helpers') for code in self.codes]


class ReplPhaseTests(unittest.TestCase):
    def setUp(self):
        self.secret = {'loginId': 'fixture-id', 'password': 'aB3!x', 'credentialVersion': 2}
        self.raw = dict(self.secret)
        self.credentials = Mock(return_value=self.raw)
        self.check_active = Mock()
        self.progress = Mock()

    def run_with(self, bank: FakeBank, credentials=...):
        return repl.repl_phase('aside', self.check_active, self.credentials if credentials is ... else credentials,
                               self.progress, worker.capture, LABELS, open_session=lambda: bank)

    def test_fresh_login_clicks_keypad_by_ref_only_and_reads_after_one_submit(self):
        bank = FakeBank()
        result = self.run_with(bank)
        self.assertEqual(result['outcome'], 'succeeded')
        self.assertTrue(result['logoutConfirmed'])
        self.assertEqual(bank.typed, [LABELS[c] for c in self.secret['password']])
        self.assertEqual(bank.steps().count('submit'), 1)
        for code in bank.codes:
            self.assertNotIn(self.secret['password'], code)
            if '/*moa:press*/' in code:
                self.assertRegex(code, r'locator\("e[0-9]+"\)')
                self.assertFalse(any(f'"{label}"' in code for label in LABELS.values()))
        self.assertEqual([c for c in bank.codes if self.secret['loginId'] in c], [c for c in bank.codes if '/*moa:login-id*/' in c])
        self.assertEqual(self.raw, {})  # 전달받은 로그인 정보는 사용 후 비운다.
        self.credentials.assert_called_once()
        self.progress.assert_called_once_with('reading')
        self.assertTrue(bank.closed)
        deposit, loan = result['observations']
        self.assertEqual((deposit['pageKind'], deposit['balanceKrw'], deposit['accountLast4']), ('deposit_account_list', '2000000', '6789'))
        self.assertEqual((loan['loanType'], loan['outstandingPrincipalKrw'], loan['maturityDate']), ('interim', '150000000', '2030-05-31'))
        self.assertNotIn('110-123-456789', json.dumps(result))

    def test_unusable_password_stops_before_any_bank_input(self):
        for password in ['has space', 'x' * 17, '한글']:
            with self.subTest(password=password):
                bank = FakeBank()
                self.credentials.return_value = dict(self.secret, password=password)
                result = self.run_with(bank)
                self.assertEqual((result['outcome'], result['errorCode']), ('failed', 'credentials_invalid'))
                self.assertFalse({'login-id', 'keypad', 'press', 'submit'} & set(bank.steps()))

    def test_unconfirmed_key_never_submits(self):
        bank = FakeBank(drop_key=2)
        result = self.run_with(bank)
        self.assertEqual(result['errorCode'], 'unsupported_layout')
        self.assertNotIn('submit', bank.steps())

    def test_rejected_login_is_classified_and_never_retried(self):
        login = {'hash': '#011100000000', 'loginForm': True, 'alerts': []}
        cases = [
            (dict(login, result='message', hits=['비밀번호', '오류', '횟수']), 'failed', 'credentials_invalid'),
            (dict(login, result='message', hits=[], alerts=['password']), 'failed', 'credentials_invalid'),
            (dict(login, result='message', hits=['추가인증', '휴대폰', '인증']), 'authentication_required', 'authentication_required'),
            (dict(login, result='message', hits=['비밀번호', '인증']), 'authentication_required', 'authentication_required'),
            (dict(login, result='message', hits=['공지']), 'authentication_required', 'authentication_required'),
            (dict(login, result='moved', hits=[], hash='#999900000000', loginForm=False), 'authentication_required', 'authentication_required'),
            (dict(login, result='timeout', hits=[]), 'failed', 'timeout'),
        ]
        for observed, outcome, code in cases:
            with self.subTest(observed=observed):
                self.credentials.return_value = dict(self.secret)
                notes = []
                bank = FakeBank(result=observed)
                result = repl.repl_phase('aside', self.check_active, self.credentials, self.progress, worker.capture, LABELS,
                                         open_session=lambda: bank, diagnose=notes.append)
                self.assertEqual((result['outcome'], result['errorCode']), (outcome, code))
                self.assertEqual(bank.steps().count('submit'), 1)
                self.assertNotIn('deposits', bank.steps())
                self.assertFalse(result['logoutConfirmed'])
                self.assertEqual([note['step'] for note in notes], ['result'])
                self.assertEqual(notes[0]['code'], code)

    def test_diagnostic_keeps_only_fixed_vocabulary(self):
        note = repl.diagnostic('result', 'timeout', {'hits': ['비밀번호', '이수빈 고객님', '110-123-456789'], 'hash': '#011100000000', 'loginForm': True})
        self.assertEqual(note, {'step': 'result', 'code': 'timeout', 'hits': ['비밀번호'], 'alerts': [], 'tab': None, 'layers': None, 'notice': None, 'confirms': None,
                                'hash': '#011100000000', 'loginForm': True})
        self.assertEqual(repl.diagnostic('result', 'x', {'alerts': ['password', '원문 메시지'], 'notice': True, 'confirms': 2})['alerts'], ['password'])
        self.assertIsNone(repl.diagnostic('x', 'timeout', {'hash': '#abc<script>'})['hash'])

    def test_missing_loan_tab_stops_with_counts_and_logs_out(self):
        notes = []
        bank = FakeBank(loan_tab={'marked': False, 'candidates': 2, 'tabs': 0, 'shown': 0})
        result = repl.repl_phase('aside', self.check_active, self.credentials, self.progress, worker.capture, LABELS, open_session=lambda: bank, diagnose=notes.append)
        self.assertEqual((result['errorCode'], result['logoutConfirmed'], result['observations']), ('unsupported_layout', True, []))
        self.assertEqual((notes[0]['step'], notes[0]['tab'], notes[0]['layers']), ('loans', {'candidates': 2, 'tabs': 0, 'shown': 0}, 0))

    def test_failure_step_is_noted(self):
        notes = []
        bank = FakeBank(fail=('loans', 'unsupported_layout'))
        repl.repl_phase('aside', self.check_active, self.credentials, self.progress, worker.capture, LABELS, open_session=lambda: bank, diagnose=notes.append)
        self.assertEqual([(note['step'], note['code']) for note in notes], [('loans', 'unsupported_layout')])

    def test_existing_logged_in_tab_is_read_without_credentials(self):
        bank = FakeBank(tab_logged_in=True)
        result = self.run_with(bank)
        self.assertEqual(result['outcome'], 'succeeded')
        self.credentials.assert_not_called()
        self.assertFalse({'open', 'login-id', 'submit'} & set(bank.steps()))

    def test_continue_without_logged_in_tab_waits_for_user(self):
        bank = FakeBank()
        result = self.run_with(bank, credentials=None)
        self.assertEqual(result['outcome'], 'authentication_required')
        self.assertNotIn('open', bank.steps())

    def test_failure_after_login_still_uses_bank_logout(self):
        bank = FakeBank(fail=('loans', 'unsupported_layout'))
        result = self.run_with(bank)
        self.assertEqual((result['errorCode'], result['logoutConfirmed']), ('unsupported_layout', True))
        self.assertEqual(bank.steps()[-2:], ['logout', 'cleanup'])  # 세션이 연 탭은 로그아웃 뒤 정리한다.

    def test_timeout_kills_session_and_reports_timeout(self):
        bank = FakeBank(fail=('deposits', 'timeout'))
        result = self.run_with(bank)
        self.assertEqual((result['errorCode'], result['logoutConfirmed']), ('timeout', False))
        self.assertNotIn('logout', bank.steps())  # 죽은 세션으로 로그아웃을 시도하지 않는다.

    def test_unconfirmed_logout_is_never_success(self):
        result = self.run_with(FakeBank(logout=False))
        self.assertEqual((result['outcome'], result['errorCode'], result['observations']), ('failed', 'operation_unknown', []))

    def test_cancelled_job_logs_out_then_stops(self):
        bank = FakeBank(tab_logged_in=True)
        self.check_active.side_effect = [None, worker.Stopped('operation_unknown')]
        with self.assertRaises(worker.Stopped):
            self.run_with(bank)
        self.assertEqual(bank.steps()[-1], 'logout')

    def test_only_clear_loan_types_are_saved(self):
        loans = [{'name': '신용대출', 'number': '330-111-222333', 'maturity': '', 'amount': '1,000'},
                 {'name': '전세 중도금 혼합', 'number': '330-111-222334', 'maturity': '', 'amount': '1,000'},
                 {'name': '버팀목전세자금대출', 'number': '330-111-222335', 'maturity': '2031.01.02', 'amount': '0'}]
        result = self.run_with(FakeBank(tab_logged_in=True, loans=loans))
        self.assertEqual([row.get('loanType') for row in result['observations']], [None, 'jeonse'])

    def test_bad_numbers_never_become_observations(self):
        for row in [{'number': '110-***-456789', 'amount': '1'}, {'number': '110-123-456789', 'amount': '1,00'}, {'number': '110-123-456789', 'amount': ''}]:
            with self.subTest(row=row):
                result = self.run_with(FakeBank(tab_logged_in=True, deposits=[row], loans=[]))
                self.assertEqual((result['errorCode'], result['observations']), ('unsupported_layout', []))


class CleanupTests(unittest.TestCase):
    def test_own_tab_is_cleaned_even_after_rejection_but_user_tab_is_not(self):
        rejected = FakeBank(result={'result': 'message', 'hits': ['비밀번호', '오류'], 'alerts': [], 'hash': '#011100000000', 'loginForm': True})
        repl.repl_phase('aside', Mock(), Mock(return_value={'loginId': 'id', 'password': 'pw', 'credentialVersion': 1}), Mock(), worker.capture, LABELS, open_session=lambda: rejected)
        self.assertEqual(rejected.steps()[-1], 'cleanup')
        reused = FakeBank(tab_logged_in=True)
        repl.repl_phase('aside', Mock(), None, Mock(), worker.capture, LABELS, open_session=lambda: reused)
        self.assertNotIn('cleanup', reused.steps())


NODE = shutil.which('node') or str(Path.home() / '.local/bin/node')
HARNESS = r'''
let now = 0; Date.now = () => now; globalThis.sleep = async (ms) => { now += ms; };
const states = __STATES__; let index = 0; const clicks = []; const out = [];
console.log = (line) => out.push(String(line));
globalThis.page = { url: () => 'https://bank.shinhan.com/index.jsp#011100000000',
  evaluate: async (fn) => fn === moaMarkNotice ? true : fn === moaLoginState ? states[Math.min(index++, states.length - 1)] : null,
  locator: (selector) => ({ click: async () => { clicks.push(selector); } }) };
'''


@unittest.skipUnless(Path(NODE).exists(), 'node가 없어 JS 판정 루프를 건너뛴다')
class ResultLoopTests(unittest.TestCase):
    """RESULT 단계의 실제 JS를 가짜 page로 돌려 안내창 확인·메시지·이동·시간 초과를 검사한다."""
    base = {'loggedIn': False, 'hash': '#011100000000', 'loginForm': True, 'notice': False, 'layers': 0, 'hits': [], 'alerts': []}

    def run_loop(self, states):
        code = '\n'.join([HARNESS.replace('__STATES__', json.dumps([dict(self.base, **s) for s in states], ensure_ascii=False)),
                          repl.one_line(repl.HELPERS), "globalThis.moaBase = { hash: '#011100000000' };", repl.one_line(repl.RESULT),
                          'process.stdout.write(JSON.stringify({ out, clicks }));'])
        with tempfile.TemporaryDirectory() as folder:
            script = Path(folder) / 'loop.mjs'; script.write_text(code)
            done = subprocess.run([NODE, str(script)], capture_output=True, text=True, timeout=30)
        self.assertEqual(done.returncode, 0, done.stderr)
        value = json.loads(done.stdout)
        result = [line.split('MOA_RESULT ', 1)[1] for line in value['out'] if line.startswith('MOA_RESULT ') and 'result' in line]
        return json.loads(result[-1]), value['clicks']

    def test_id_login_notice_is_confirmed_then_login_succeeds(self):
        result, clicks = self.run_loop([{'notice': True}, {'loggedIn': True}])
        self.assertEqual((result['result'], result['confirms']), ('ok', 1))
        self.assertEqual(clicks, ['[data-moa-confirm="1"]'])

    def test_notice_that_never_closes_stops_after_two_confirms(self):
        result, clicks = self.run_loop([{'notice': True}])
        self.assertEqual((result['result'], len(clicks)), ('message', 2))
        self.assertEqual(repl.login_verdict(result), 'authentication_required')

    def test_stable_error_layer_is_a_message_and_loading_is_ignored(self):
        result, _ = self.run_loop([{'layers': 1, 'hits': ['처리중']}, {'layers': 1, 'hits': ['처리중']}, {'layers': 1, 'hits': ['비밀번호', '오류']}, {'layers': 1, 'hits': ['비밀번호', '오류']}])
        self.assertEqual(result['result'], 'message')
        self.assertEqual(repl.login_verdict(result), 'credentials_invalid')

    def test_leaving_login_page_is_moved_and_silence_is_timeout(self):
        self.assertEqual(self.run_loop([{'hash': '#999900000000', 'loginForm': False}])[0]['result'], 'moved')
        result, clicks = self.run_loop([{}])
        self.assertEqual((result['result'], clicks), ('timeout', []))


FAKE_DOM = r"""
class El { constructor(tag, text = '', attrs = {}, shown = true) { this.tagName = tag.toUpperCase(); this.ownText = text; this.attrs = { ...attrs }; this.shown = shown; this.children = []; this.parentElement = null; }
  add(...kids) { for (const k of kids) { k.parentElement = this; this.children.push(k); } return this; }
  get textContent() { return this.ownText + this.children.map((c) => c.textContent).join(' '); }
  get innerText() { return this.shown ? this.ownText + this.children.map((c) => c.innerText).join(' ') : ''; }
  getBoundingClientRect() { let n = this; while (n) { if (!n.shown) return { width: 0, height: 0 }; n = n.parentElement; } return { width: 10, height: 10 }; }
  setAttribute(k, v) { this.attrs[k] = String(v); } removeAttribute(k) { delete this.attrs[k]; } getAttribute(k) { return this.attrs[k] ?? null; }
  contains(o) { while (o) { if (o === this) return true; o = o.parentElement; } return false; }
  all() { return this.children.flatMap((c) => [c, ...c.all()]); }
  matches(sel) { return sel.split(',').map((s) => s.trim()).some((s) => s === '[data-moa-tab]' ? 'data-moa-tab' in this.attrs : s === '[role="tab"]' ? this.attrs.role === 'tab' : this.tagName === s.toUpperCase()); }
  querySelectorAll(sel) { return this.all().filter((e) => e.matches(sel)); } }
globalThis.getComputedStyle = () => ({ visibility: 'visible', display: 'block' });
const tabList = (names) => new El('ul').add(...names.map((n) => new El('li').add(new El('div').add(new El('a', n)))));
const body = new El('body');
globalThis.document = { querySelectorAll: (sel) => body.querySelectorAll(sel) };
"""


@unittest.skipUnless(Path(NODE).exists(), 'node가 없어 대출 탭 판별을 건너뛴다')
class LoanTabTests(unittest.TestCase):
    """로그인 후 계좌 탭 묶음의 '대출'만 고르고, 메뉴·바로가기의 같은 이름은 고르지 않는다."""
    def mark(self, scene: str):
        helpers = repl.one_line(repl.HELPERS).split('const moaMarkLoanTab = ', 1)[1].split('; const moaLoggedOut', 1)[0]
        code = FAKE_DOM + scene + '\nconst moaMarkLoanTab = ' + helpers + ';\nconst r = moaMarkLoanTab();\nconst hit = body.querySelectorAll("[data-moa-tab]");\nprocess.stdout.write(JSON.stringify({ r, hit: hit.map((e) => e.parentElement.parentElement.parentElement.children.map((c) => c.innerText).join("|")) }));'
        with tempfile.TemporaryDirectory() as folder:
            script = Path(folder) / 'tab.mjs'; script.write_text(code)
            done = subprocess.run([NODE, str(script)], capture_output=True, text=True, timeout=30)
        self.assertEqual(done.returncode, 0, done.stderr)
        return json.loads(done.stdout)

    def test_account_tab_is_chosen_over_menu_and_shortcuts(self):
        value = self.mark("""
body.add(new El('nav').add(new El('a', '금융상품'), new El('ul').add(new El('li').add(new El('a', '대출')))));
body.add(new El('section').add(new El('h2', '금융상품'), tabList(['예금/신탁', '펀드', '대출', '외환'])));
body.add(new El('section').add(tabList(['예금/신탁', 'ISA', '대출', '펀드', '휴면예금'])));
body.add(new El('a', '대출', {}, false));
""")
        self.assertEqual(value['r'], {'marked': True, 'candidates': 4, 'tabs': 1, 'shown': 1})
        self.assertEqual(len(value['hit']), 1)
        self.assertIn('ISA', value['hit'][0])

    def test_no_account_tabs_marks_nothing(self):
        value = self.mark("body.add(tabList(['예금/신탁', '펀드', '대출']));")
        self.assertEqual((value['r']['marked'], value['r']['tabs'], value['hit']), (False, 0, []))


class KeypadTests(unittest.TestCase):
    def test_foreign_origin_missing_close_and_duplicates(self):
        good = '- title: "x" [url=https://bank.shinhan.com/index.jsp]\n- button "가상키보드 닫기" [ref=e1]\n- button "a" [ref=e2]\n- button "b" [ref=e3]\n- button "b" [ref=e4]'
        keys = repl.keypad(good)
        self.assertEqual(keys['a'], 'e2')
        self.assertNotIn('b', keys)
        for tree in [good.replace('bank.shinhan.com', 'bank.shinhan.com.evil.test'), good.replace('https://', 'http://'),
                     good.replace('가상키보드 닫기', '닫기'), 'no url', None]:
            with self.subTest(tree=tree), self.assertRaises(repl.ReplFailure):
                repl.keypad(tree)

    def test_press_accepts_only_plain_refs(self):
        self.assertIn('"e12"', repl.press('e12'))
        for ref in ['e1"); alert(1); ("', '', 'a b']:
            with self.subTest(ref=ref), self.assertRaises(repl.ReplFailure):
                repl.press(ref)


FAKE_REPL = r'''
import sys, time
print('\x1b[2maccount: u0 (fixture)\nsessionDir: /tmp/x\x1b[0m', flush=True)
for line in sys.stdin:
    if line.strip() == 'exit':
        break
    sys.stdout.write('\x1b[32mrepl\x1b[0m > ')
    if 'HANG' in line:
        time.sleep(60)
    elif 'MOAERR' in line:
        print('\x1b[31mError: MOA_ERR:credentials_invalid\n    at <anonymous>\x1b[0m\n\x1b[31m[error | 3ms]\x1b[0m', flush=True)
    elif 'PWTIMEOUT' in line:
        print('locator.click: Timeout 8000ms exceeded\n[error | 8001ms]', flush=True)
    elif 'TWICE' in line:
        print('MOA_RESULT {"a": 1}\nMOA_RESULT {"a": 2}\n[ok | 1ms]', flush=True)
    else:
        print('MOA_RESULT ' + '{"lines": %d}' % line.count('\n') + '\n\x1b[2m[ok | 5ms]\x1b[0m', flush=True)
'''


class ReplSessionTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.aside = Path(self.folder.name) / 'aside'
        self.aside.write_text(f'#!{sys.executable}\n' + FAKE_REPL)
        self.aside.chmod(self.aside.stat().st_mode | stat.S_IXUSR)
        self.session = repl.ReplSession(str(self.aside))

    def tearDown(self):
        self.session.close()
        self.folder.cleanup()

    def test_result_error_and_timeout_codes(self):
        self.assertEqual(self.session.call('const a = 1;\nconsole.log(a);', 5), {'lines': 1})
        for code, expected in [('MOAERR', 'credentials_invalid'), ('PWTIMEOUT', 'timeout'), ('TWICE', 'unsupported_layout')]:
            with self.subTest(code=code), self.assertRaises(repl.ReplFailure) as caught:
                self.session.call(code, 5)
            self.assertEqual(caught.exception.code, expected)

    def test_stuck_step_is_killed_as_timeout(self):
        started = time.monotonic()
        with self.assertRaises(repl.ReplFailure) as caught:
            self.session.call('HANG', 1)
        self.assertEqual(caught.exception.code, 'timeout')
        self.assertLess(time.monotonic() - started, 6)
        self.assertTrue(self.session.dead)
        self.assertIsNotNone(self.session.process.poll())
        with self.assertRaises(repl.ReplFailure):
            self.session.call('anything', 1)


class EngineSelectionTests(unittest.TestCase):
    def test_default_is_repl_and_codex_needs_private_file(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            self.assertEqual(worker.selected_engine(root), 'repl')
            (root / 'engine').write_text('codex\n'); (root / 'engine').chmod(0o600)
            self.assertEqual(worker.selected_engine(root), 'codex')
            (root / 'engine').chmod(0o666)
            with self.assertRaises(worker.Stopped):
                worker.selected_engine(root)
            (root / 'engine').chmod(0o600); (root / 'engine').write_text('gpt')
            with self.assertRaises(worker.Stopped):
                worker.selected_engine(root)

    def test_run_phase_uses_repl_and_completes_with_same_claim(self):
        with tempfile.TemporaryDirectory() as folder:
            state_path = Path(folder) / 'state.json'
            state = {'secret': 'fixture-runner-key'}
            worker.write_private(state_path, state)
            job = {'id': 'job-1', 'claimId': 'claim-1', 'credentialVersion': 2, 'continueVersion': 0, 'state': 'running'}
            api = Mock(); api.call.side_effect = lambda path, body: {'paired': True, 'job': job} if path.endswith('/heartbeat') else {}
            observation = {'pageKind': 'deposit_account_list'}
            engine = Mock(return_value={'outcome': 'succeeded', 'logoutConfirmed': True, 'observations': [observation]})
            with patch.object(worker, 'shinhan_repl', return_value=SimpleNamespace(repl_phase=engine)), patch.object(worker, 'codex_phase') as codex:
                worker.run_phase(SimpleNamespace(state=state_path, codex='fixture', aside='/fixture/aside'), api, job, state)
            codex.assert_not_called()
            self.assertEqual(engine.call_args.args[0], '/fixture/aside')
            self.assertIs(engine.call_args.args[4], worker.capture)
            paths = [call.args[0] for call in api.call.call_args_list]
            self.assertEqual(paths[-1], '/v1/mac-bank-runner/jobs/job-1/complete')
            self.assertEqual(api.call.call_args_list[-1].args[1]['claimId'], 'claim-1')
            self.assertNotIn('active', worker.read_private(state_path))


if __name__ == '__main__':
    unittest.main()
