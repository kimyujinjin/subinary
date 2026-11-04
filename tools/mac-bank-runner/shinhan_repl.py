"""신한은행 통장·대출 잔액을 aside repl(Playwright 호환 JS)로 조회한다. 모델 판단 없이 고정 절차만 실행한다.

- 대화형 `aside repl` 세션 하나에 단계마다 한 줄 JS를 보낸다(호출당 120초 제한 안에서 단계를 나눈다).
- 세션이 연 탭은 세션이 끝날 때 Aside가 닫는다. 이미 로그인돼 있던 사용자 탭은 붙기만 하고 남겨 둔다.
- 비밀번호 문자는 repl 코드에 넣지 않는다. 보안키패드 snapshot에서 받은 ref만 클릭한다.
- repl 출력(계좌번호·금액 포함)은 메모리에서만 다루고 파일·로그에 쓰지 않는다.
"""
from __future__ import annotations

import json
import os
import re
import select
import subprocess
import time
import urllib.parse
from collections.abc import Callable

LOGIN_URL = 'https://bank.shinhan.com/index.jsp#011100000000'
MAIN_URL = 'https://bank.shinhan.com/index.jsp'
MAX_LOGIN_ID = 20  # 은행 입력칸 maxlength
MAX_PASSWORD = 16
SHIFT_LABELS = ('왼쪽 쉬프트', '오른쪽 쉬프트')
CODES = {'authentication_required', 'credentials_invalid', 'network_error', 'unsupported_layout',
         'runtime_unavailable', 'operation_unknown', 'timeout'}
ANSI = re.compile(rb'\x1b\[[0-9;]*[A-Za-z]')
DONE = re.compile(r'\[(ok|error)\s*\|\s*[0-9.]+\s*m?s\]\s*$')
KEY = re.compile(r'button "([^"]*)" \[ref=([A-Za-z0-9]+)\]')
URL = re.compile(r'\[url=([^\]\s]+)\]')
MAX_OUTPUT = 4 * 1024 * 1024


class ReplFailure(Exception):
    """고정 오류 코드만 담는다. 화면·출력 원문은 담지 않는다."""
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code if code in CODES else 'unsupported_layout'


def one_line(code: str) -> str:
    """repl은 한 줄 단위로 실행한다. JS에는 줄 주석을 쓰지 않는다."""
    return ' '.join(part.strip() for part in code.strip().splitlines() if part.strip())


def bank_url(value: str) -> bool:
    """정확한 신한 개인뱅킹 HTTPS 출처만 인정한다."""
    try:
        url = urllib.parse.urlsplit(value)
        return url.scheme == 'https' and url.hostname == 'bank.shinhan.com' and url.port in {None, 443} and not url.username and not url.password
    except ValueError:
        return False


class ReplSession:
    """대화형 `aside repl` 프로세스 하나. 한 줄을 보내고 `[ok|error | Nms]` 표시까지 읽는다."""
    def __init__(self, aside: str, spawn: Callable[..., subprocess.Popen[bytes]] = subprocess.Popen) -> None:
        try:
            self.process = spawn([aside, 'repl'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        except OSError:
            raise ReplFailure('runtime_unavailable') from None
        self.buffer = b''
        self.dead = False

    def call(self, code: str, timeout: float) -> dict[str, object]:
        line = one_line(code)
        if self.dead:
            raise ReplFailure('runtime_unavailable')
        assert self.process.stdin and self.process.stdout
        try:
            self.process.stdin.write(line.encode() + b'\n')
            self.process.stdin.flush()
        except OSError:
            self.kill()
            raise ReplFailure('runtime_unavailable') from None
        end = time.monotonic() + timeout
        lines: list[str] = []
        size = 0
        while True:
            while b'\n' in self.buffer:
                raw, self.buffer = self.buffer.split(b'\n', 1)
                text = ANSI.sub(b'', raw).decode(errors='replace')
                lines.append(text)
                done = DONE.search(text)
                if done:
                    return self.parse(lines, done.group(1) == 'ok')
            remaining = end - time.monotonic()
            if remaining <= 0:
                # 끝나지 않은 단계는 기다리지 않는다. 세션을 끝내면 세션이 연 탭도 닫힌다.
                self.kill()
                raise ReplFailure('timeout')
            if not select.select([self.process.stdout], [], [], min(remaining, 1.0))[0]:
                continue
            chunk = os.read(self.process.stdout.fileno(), 65536)
            if not chunk:
                self.kill()
                raise ReplFailure('runtime_unavailable')
            size += len(chunk)
            if size > MAX_OUTPUT:
                self.kill()
                raise ReplFailure('unsupported_layout')
            self.buffer += chunk

    @staticmethod
    def parse(lines: list[str], ok: bool) -> dict[str, object]:
        """MOA_RESULT 한 줄만 결과로 인정한다. 오류는 고정 코드로만 바꾼다."""
        if not ok:
            for text in lines:
                found = re.search(r'MOA_ERR:([a-z_]+)', text)
                if found:
                    raise ReplFailure(found.group(1))
            raise ReplFailure('timeout' if any(re.search(r'[Tt]imeout|timed out', text) for text in lines) else 'unsupported_layout')
        results = [text.split('MOA_RESULT ', 1)[1] for text in lines if 'MOA_RESULT ' in text]
        if len(results) != 1:
            raise ReplFailure('unsupported_layout')
        try:
            value = json.loads(results[0])
        except ValueError:
            raise ReplFailure('unsupported_layout') from None
        if not isinstance(value, dict):
            raise ReplFailure('unsupported_layout')
        return value

    def kill(self) -> None:
        self.dead = True
        if self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=3)
        self.release()

    def close(self) -> None:
        """stdin을 닫으면 repl이 끝나고 세션이 연 탭을 Aside가 닫는다."""
        if self.process.poll() is None:
            try:
                if self.process.stdin:
                    self.process.stdin.write(b'exit\n')
                    self.process.stdin.close()
            except OSError:
                pass
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.kill()
        self.dead = True
        self.release()

    def release(self) -> None:
        for stream in (self.process.stdin, self.process.stdout):
            try:
                if stream:
                    stream.close()
            except OSError:
                pass
        self.buffer = b''


# 세션 시작 때 한 번 정의한다. page.evaluate에 넘기는 함수는 바깥 변수를 참조하지 않아야 한다(페이지 안에서 실행됨).
HELPERS = r'''
const moaEmit = (v) => console.log('MOA_RESULT ' + JSON.stringify(v));
const moaFail = (code) => { throw new Error('MOA_ERR:' + code); };
const moaBank = (u) => { try { const x = new URL(u); return x.protocol === 'https:' && x.hostname === 'bank.shinhan.com' && (x.port === '' || x.port === '443') && !x.username && !x.password; } catch (e) { return false; } };
const moaPage = () => { if (!page || !moaBank(page.url())) moaFail('unsupported_layout'); return page; };
const moaWait = async (fn, ms) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await moaPage().evaluate(fn).catch(() => null); if (v) return v; await sleep(300); } return null; };
const moaClick = async (loc) => { if ((await loc.count()) !== 1) moaFail('unsupported_layout'); try { await loc.click({ timeout: 8000 }); } catch (e) { await loc.evaluate((el) => el.click()); } };
const moaLoggedIn = () => { const b = document.getElementById('btn_logout'); if (!b) return false; const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
const moaLoginReady = () => ['ibx_loginId', '비밀번호', 'btn_idLogin'].every((id) => { const e = document.getElementById(id); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
const moaKeypadOpen = () => { const k = document.getElementById('비밀번호_mainDiv'); if (!k) return false; const r = k.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
const moaPwLength = () => { const e = document.getElementById('비밀번호'); return e ? e.value.length : -1; };
const moaTrapDialogs = () => { const kind = (m) => { m = String(m); if (/비밀번호/.test(m) && /(일치|오류|틀|잘못)/.test(m)) return 'password'; if (/(아이디|이용자\s*ID)/i.test(m) && /(일치|오류|틀|잘못|없|존재|등록되지)/.test(m)) return 'login_id'; if (/인증/.test(m)) return 'auth'; return 'other'; }; window.__moaAlerts = []; window.alert = (m) => { window.__moaAlerts.push(kind(m)); }; window.confirm = (m) => { window.__moaAlerts.push(kind(m)); return false; }; return true; };
const moaFlags = () => { const t = ((document.body && document.body.innerText) || '').replace(/\s+/g, ' '); const b = document.getElementById('btn_logout'); const r = b ? b.getBoundingClientRect() : null; return { loggedIn: !!r && r.width > 0 && r.height > 0, pw: /비밀번호[^.]{0,30}(일치하지|오류|틀렸|잘못)/.test(t), id: /(아이디|이용자\s*ID)[^.]{0,30}(일치하지|존재하지|등록되지|없습니다|잘못)/i.test(t), auth: /(추가\s*인증|본인\s*확인|인증번호|OTP|보안매체|휴대폰\s*인증|ARS)/.test(t), alerts: (window.__moaAlerts || []).slice(0, 10) }; };
const moaDeposits = () => { const t = document.getElementById('grd_list_01_body_table'); if (!t) return null; const f = document.getElementById('grd_list_01_foot_table'); const rows = [...t.querySelectorAll('tr')].filter((r) => r.querySelector('td[col_id="잔액_display"]')).map((r) => { const c = (k) => { const e = r.querySelector('td[col_id="' + k + '"]'); return e ? e.textContent.trim() : ''; }; return { number: c('계좌번호_view'), amount: c('잔액_display') }; }); return rows.length || /[0-9]/.test(f ? f.textContent : '') ? { rows } : null; };
const moaLoans = () => { const t = document.getElementById('grd_list03_body_table'); if (!t) return null; const f = document.getElementById('grd_list03_foot_table'); const rows = [...t.querySelectorAll('tr')].filter((r) => r.querySelector('td[col_id="대출잔액_display"]')).map((r) => { const c = (k) => { const e = r.querySelector('td[col_id="' + k + '"]'); return e ? e.textContent.trim() : ''; }; return { name: c('계좌명_display'), number: c('대출계좌번호_view'), maturity: c('대출만기일_display'), amount: c('대출잔액_display') }; }); const empty = [...document.querySelectorAll('[id^="grd_list03"]')].some((e) => /없습니다/.test(e.textContent)); return rows.length || empty || /[0-9]/.test(f ? f.textContent : '') ? { rows } : null; };
const moaLoggedOut = () => { const t = ((document.body && document.body.innerText) || '').replace(/\s+/g, ' '); const b = document.getElementById('btn_logout'); const r = b ? b.getBoundingClientRect() : null; return /로그아웃 되었습니다/.test(t) && !(r && r.width > 0 && r.height > 0); };
moaEmit({ ready: true });
'''

FIND = '''/*moa:find*/ await (async () => {
const tabs = (await listBrowserTabs()).filter((t) => moaBank(t.url)); let hit = null;
for (const t of tabs) { const p = await attachBrowserTab(t.targetId); if (await p.evaluate(moaLoggedIn).catch(() => false)) { hit = t.targetId; break; } }
moaEmit({ bankTabs: tabs.length, loggedIn: !!hit }); })();'''

OPEN = '''/*moa:open*/ await (async () => {
try { await openTab(__LOGIN__); } catch (e) { moaFail('network_error'); }
let ready = await moaWait(moaLoginReady, 15000);
if (!ready && !(await moaPage().evaluate(moaLoggedIn).catch(() => false))) { await moaClick(moaPage().getByRole('link', { name: '뱅킹로그인', exact: true })); ready = await moaWait(moaLoginReady, 15000); }
const loggedIn = await moaPage().evaluate(moaLoggedIn).catch(() => false);
if (!ready && !loggedIn) moaFail((await moaPage().evaluate(() => document.readyState).catch(() => '')) === 'complete' ? 'unsupported_layout' : 'timeout');
moaEmit({ ready: !!ready, loggedIn }); })();'''.replace('__LOGIN__', json.dumps(LOGIN_URL))

TYPE_ID = '''/*moa:login-id*/ await (async () => {
const p = moaPage(); const f = p.locator('#ibx_loginId'); await moaClick(f); await f.fill(''); await p.keyboard.type(__ID__, { delay: 20 });
moaEmit({ idLength: await p.evaluate(() => { const e = document.getElementById('ibx_loginId'); return e ? e.value.length : -1; }) }); })();'''

KEYPAD_OPEN = '''/*moa:keypad*/ await (async () => {
const p = moaPage(); await moaClick(p.locator('[id="비밀번호"]'));
if (!(await moaWait(moaKeypadOpen, 8000))) moaFail('unsupported_layout');
const s = await snapshot(p, { selector: '[id="비밀번호_layout"]', interactive: true });
moaEmit({ length: await p.evaluate(moaPwLength), tree: s.tree }); })();'''

PRESS = '''/*moa:press*/ await (async () => {
const p = moaPage(); await p.locator(__REF__).click({ timeout: 8000 });
const s = await snapshot(p, { selector: '[id="비밀번호_layout"]', interactive: true });
moaEmit({ length: await p.evaluate(moaPwLength), tree: s.tree }); })();'''

CLOSE_KEYPAD = '''/*moa:keypad-close*/ await (async () => {
const p = moaPage(); const s = await snapshot(p, { selector: '[id="비밀번호_layout"]', interactive: true });
const m = s.tree.match(/button "가상키보드 닫기" \\[ref=([A-Za-z0-9]+)\\]/); if (m) await p.locator(m[1]).click({ timeout: 8000 });
moaEmit({ length: await p.evaluate(moaPwLength), open: await p.evaluate(moaKeypadOpen) }); })();'''

SUBMIT = '''/*moa:submit*/ await (async () => {
const p = moaPage(); await p.evaluate(moaTrapDialogs); globalThis.moaBase = await p.evaluate(moaFlags);
await moaClick(p.locator('#btn_idLogin')); moaEmit({ submitted: true }); })();'''

# 로그인 결과: 로그아웃 버튼(성공) > 비밀번호·ID 오류 > 인증·기타 안내 순으로 판정한다. 로그인 화면에 원래 있던 문구(FAQ의 OTP 등)는 제외한다.
RESULT = '''/*moa:result*/ await (async () => {
const end = Date.now() + 25000; let out = null; let off = false;
while (Date.now() < end && !out) { await sleep(500); if (!page) continue; if (!moaBank(page.url())) { off = true; continue; } off = false;
const v = await page.evaluate(moaFlags).catch(() => null); if (!v) continue;
if (v.loggedIn) out = 'ok';
else if (v.alerts.includes('password') || v.alerts.includes('login_id') || (v.pw && !moaBase.pw) || (v.id && !moaBase.id)) out = 'credentials_invalid';
else if (v.alerts.length || (v.auth && !moaBase.auth)) out = 'authentication_required'; }
moaEmit({ result: out || (off ? 'unsupported_layout' : 'timeout') }); })();'''

DEPOSITS = '''/*moa:deposits*/ await (async () => {
let d = await moaWait(moaDeposits, 15000);
if (!d) { try { await moaPage().goto(__MAIN__); } catch (e) { moaFail('timeout'); } d = await moaWait(moaDeposits, 15000); }
if (!(await moaPage().evaluate(moaLoggedIn).catch(() => false))) moaFail('authentication_required');
if (!d) moaFail('unsupported_layout');
moaEmit({ deposits: d.rows }); })();'''.replace('__MAIN__', json.dumps(MAIN_URL))

LOANS = '''/*moa:loans*/ await (async () => {
const p = moaPage(); await moaClick(p.getByRole('link', { name: '대출', exact: true }));
const l = await moaWait(moaLoans, 15000); if (!l) moaFail('timeout');
moaEmit({ loans: l.rows }); })();'''

LOGOUT = '''/*moa:logout*/ await (async () => {
const p = moaPage(); if (!(await p.evaluate(moaLoggedIn).catch(() => false))) { moaEmit({ logout: false }); return; }
await moaClick(p.locator('#btn_logout')); const done = await moaWait(moaLoggedOut, 15000);
moaEmit({ logout: !!done && moaBank(page.url()) }); })();'''


def keypad(tree: object) -> dict[str, str]:
    """키패드 snapshot에서 키 이름→ref를 만든다. 은행 출처가 아니면 거절하고 이름이 겹치는 키는 쓰지 않는다."""
    if not isinstance(tree, str):
        raise ReplFailure('unsupported_layout')
    urls = URL.findall(tree)
    if not urls or not all(bank_url(value) for value in urls):
        raise ReplFailure('unsupported_layout')
    keys: dict[str, str] = {}
    duplicated: set[str] = set()
    for label, ref in KEY.findall(tree):
        if label in keys:
            duplicated.add(label)
        keys[label] = ref
    for label in duplicated:
        keys.pop(label)
    if '가상키보드 닫기' not in keys:
        raise ReplFailure('unsupported_layout')
    return keys


def press(ref: str) -> str:
    if not re.fullmatch(r'[A-Za-z0-9]{1,16}', ref):
        raise ReplFailure('unsupported_layout')
    return PRESS.replace('__REF__', json.dumps(ref))


def checked_length(value: dict[str, object], expected: int) -> dict[str, str]:
    """매 클릭 뒤 마스킹 문자 수가 기대와 같아야 다음 키로 간다. 다르면 제출하지 않는다."""
    if value.get('length') != expected:
        raise ReplFailure('unsupported_layout')
    return keypad(value.get('tree'))


def enter_password(call: Callable[[str, float], dict[str, object]], password: str, labels: dict[str, str]) -> None:
    """은행 보안키패드에서 키 이름으로 ref를 찾아 클릭한다. 코드에는 ref만 들어간다."""
    keys = checked_length(call(KEYPAD_OPEN, 20), 0)
    for index, character in enumerate(password):
        label = labels[character]
        if label not in keys:
            shift = next((keys[name] for name in SHIFT_LABELS if name in keys), None)
            if shift is None:
                raise ReplFailure('unsupported_layout')
            keys = checked_length(call(press(shift), 15), index)
            if label not in keys:
                raise ReplFailure('unsupported_layout')
        keys = checked_length(call(press(keys[label]), 15), index + 1)


def usable_credentials(value: object, labels: dict[str, str]) -> tuple[str, str]:
    """키패드에 없는 문자·길이 초과는 입력 전에 거절한다(잘못된 제출로 오류 횟수가 쌓이지 않게)."""
    if (not isinstance(value, dict) or set(value) != {'loginId', 'password', 'credentialVersion'}
            or not isinstance(value['loginId'], str) or not isinstance(value['password'], str)
            or not 1 <= len(value['loginId']) <= MAX_LOGIN_ID or not 1 <= len(value['password']) <= MAX_PASSWORD
            or re.search(r'[\x00-\x1f\x7f]', value['loginId']) or any(character not in labels for character in value['password'])):
        raise ReplFailure('credentials_invalid')
    return value['loginId'], value['password']


def amount(value: object) -> str:
    if not isinstance(value, str):
        raise ReplFailure('unsupported_layout')
    text = value.replace('원', '').strip()
    if not re.fullmatch(r'-?[0-9]{1,3}(?:,[0-9]{3})*', text):
        raise ReplFailure('unsupported_layout')
    return text.replace(',', '')


def maturity(value: object) -> str | None:
    if not isinstance(value, str) or value.strip() in {'', '-'}:
        return None
    found = re.fullmatch(r'([0-9]{4})[.-]([0-9]{2})[.-]([0-9]{2})', value.strip())
    if not found:
        raise ReplFailure('unsupported_layout')
    return '-'.join(found.groups())


def loan_type(name: object) -> str | None:
    """전세·중도금 중 하나로만 분명한 대출만 저장한다. 다른 유형은 추정하지 않는다."""
    if not isinstance(name, str):
        return None
    interim, jeonse = '중도금' in name, '전세' in name
    return 'interim' if interim and not jeonse else 'jeonse' if jeonse and not interim else None


def observations(deposits: object, loans: object, capture: Callable[[dict[str, object]], dict[str, object]]) -> list[dict[str, object]]:
    """기존 검증기(capture)로 전체 계좌번호를 지문·끝 4자리로 바꾸고 원문은 버린다."""
    if not isinstance(deposits, list) or not isinstance(loans, list):
        raise ReplFailure('unsupported_layout')
    raw: list[dict[str, object]] = []
    result: list[dict[str, object]] = []
    try:
        for kind, row in [*[('deposit', row) for row in deposits], *[('loan', row) for row in loans]]:
            if not isinstance(row, dict) or not isinstance(row.get('number'), str):
                raise ReplFailure('unsupported_layout')
            loan = loan_type(row.get('name')) if kind == 'loan' else None
            if kind == 'loan' and loan is None:
                continue
            raw.append({'accountNumber': row['number'], 'accountLast4': re.sub(r'[^0-9]', '', row['number'])[-4:],
                        'pageKind': 'loan_account_list' if loan else 'deposit_account_list', 'amountKrw': amount(row.get('amount')),
                        'loanType': loan, 'maturityDate': maturity(row.get('maturity')) if loan else None})
        if not raw or len(raw) > 20:
            raise ReplFailure('unsupported_layout')
        for value in raw:
            result.append(capture(value))
    except RuntimeError:  # capture의 Stopped(고정 코드)
        raise ReplFailure('unsupported_layout') from None
    finally:
        for value in [*raw, *deposits, *loans]:
            if isinstance(value, dict):
                value.clear()
    if len({row['accountFingerprint'] for row in result}) != len(result):
        raise ReplFailure('unsupported_layout')
    return result


def failed(code: str, logout: bool = False) -> dict[str, object]:
    if code == 'authentication_required':
        return {'outcome': 'authentication_required', 'errorCode': 'authentication_required', 'logoutConfirmed': False, 'observations': []}
    return {'outcome': 'failed', 'errorCode': code, 'logoutConfirmed': logout, 'observations': []}


def repl_phase(aside: str, check_active: Callable[[], None], credentials: Callable[[], dict[str, object]] | None,
               progress: Callable[[str], None], capture: Callable[[dict[str, object]], dict[str, object]],
               labels: dict[str, str], *, open_session: Callable[[], ReplSession] | None = None, budget: float = 140) -> dict[str, object]:
    """worker의 codex_phase와 같은 결과 형식을 반환한다. 같은 작업 안에서 로그인을 다시 시도하지 않는다."""
    deadline = time.monotonic() + budget
    session = open_session() if open_session else ReplSession(aside)
    logged_in = False

    def call(code: str, limit: float) -> dict[str, object]:
        remaining = deadline - time.monotonic()
        if remaining <= 1:
            raise ReplFailure('timeout')
        return session.call(code, min(limit, remaining))

    def logout() -> bool:
        """조회 뒤·오류 뒤 모두 정상 로그아웃 버튼만 쓴다. 세션이 죽었으면 확인하지 못한 것으로 둔다."""
        if session.dead:
            return False
        try:
            return call(LOGOUT, 25).get('logout') is True
        except ReplFailure:
            return False

    try:
        call(HELPERS, 15)
        check_active()
        logged_in = call(FIND, 20).get('loggedIn') is True
        if not logged_in:
            if credentials is None:
                # 이어가기·로그인 정보 없음: 사용자가 Mac에서 직접 로그인한 탭이 있어야 한다.
                return failed('authentication_required')
            opened = call(OPEN, 45)
            logged_in = opened.get('loggedIn') is True
            if not logged_in:
                check_active()
                value = credentials()
                try:
                    login_id, password = usable_credentials(value, labels)
                    typed = call(TYPE_ID.replace('__ID__', json.dumps(login_id)), 20)
                    if typed.get('idLength') != len(login_id):
                        raise ReplFailure('unsupported_layout')
                    enter_password(call, password, labels)
                    closed = call(CLOSE_KEYPAD, 15)
                    if closed.get('length') != len(password) or closed.get('open') is not False:
                        raise ReplFailure('unsupported_layout')
                finally:
                    if isinstance(value, dict):
                        value.clear()
                    login_id = password = ''
                check_active()
                call(SUBMIT, 20)
                result = call(RESULT, 40).get('result')
                if result != 'ok':
                    return failed(result if isinstance(result, str) else 'operation_unknown')
                logged_in = True
        try:
            progress('reading')
        except Exception:  # 진행 표시는 결과에 영향을 주지 않는다.
            pass
        check_active()
        deposits = call(DEPOSITS, 45).get('deposits')
        loans = call(LOANS, 30).get('loans')
        found = observations(deposits, loans, capture)
        confirmed = logout()
        logged_in = not confirmed
        if not confirmed:
            return failed('operation_unknown')
        return {'outcome': 'succeeded', 'logoutConfirmed': True, 'observations': found}
    except ReplFailure as error:
        return failed(error.code, logout() if logged_in else False)
    except BaseException:
        if logged_in:
            logout()
        raise
    finally:
        session.close()
