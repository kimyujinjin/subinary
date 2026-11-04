"""모아의 본인 요청을 Mac에서 처리한다. 은행 조작은 aside repl 고정 절차(shinhan_repl.py)가 한다.

2026-11-04에 Codex App Server + Computer Use 경로(codex_phase)를 지웠다. 필요하면 커밋 73ba665 이전에서 되살린다.
"""
from __future__ import annotations

import argparse
import datetime as dt
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import stat
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
from types import ModuleType

ORIGIN = 'https://app.subinary.cloud'
DEFAULT_ASIDE = str(Path.home() / '.local/bin/aside')  # LaunchAgent PATH에는 ~/.local/bin이 없다.
POLICY_SHA = '6dda4ec73eab62578f6276a01192f8ef4f6df7d60a2a3dcf9352e85ac1856a7a'  # resource_policy.py(같은 폴더). 정책을 바꾸면 이 값도 바꾼다.
ACTIVE = {'claimed', 'running', 'authentication_required', 'reading', 'logging_out'}
AMOUNT = re.compile(r'(?:0|[1-9][0-9]{0,19}|-[1-9][0-9]{0,19})\Z')


class Stopped(RuntimeError):
    """민감한 원문 대신 고정 오류 코드만 전달한다."""


def now() -> str:
    """시간대가 명시된 관찰 시각을 반환한다."""
    return dt.datetime.now(dt.timezone.utc).isoformat()


def write_private(path: Path, value: dict[str, object]) -> None:
    """새 기기 키를 소유자 전용 파일로 원자적으로 저장한다."""
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.is_symlink() or path.parent.is_symlink():
        raise Stopped('unsafe_state_path')
    temp = path.with_name(path.name + '.' + secrets.token_hex(8))
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, 'w') as out:
            json.dump(value, out)
            out.flush()
            os.fsync(out.fileno())
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)


def read_private(path: Path) -> dict[str, object]:
    """다른 사용자가 쓸 수 있는 키 파일과 심볼릭 링크를 거절한다."""
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o600:
        raise Stopped('unsafe_state_permissions')
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW)) as source:
        value = json.load(source)
    if not isinstance(value, dict):
        raise Stopped('invalid_state')
    return value


class Api:
    """고정 HTTPS 출처에만 제한된 실행기 키를 전송한다. 리다이렉트는 거절한다."""
    def __init__(self, secret: str) -> None:
        self.secret = secret

    def call(self, path: str, body: dict[str, object]) -> dict[str, object]:
        """재전송 여부는 호출자가 결정하며 원문 오류·응답을 기록하지 않는다."""
        if not path.startswith('/v1/mac-bank-runner/') or '..' in path or '?' in path:
            raise Stopped('invalid_api_path')
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, req: urllib.request.Request, fp: object, code: int, msg: str, headers: object, newurl: str) -> None:
                return None
        request = urllib.request.Request(ORIGIN + path, data=json.dumps(body).encode(), method='POST',
            headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + self.secret,
                     'User-Agent': 'moa-mac-bank-runner/1.0'})
        try:
            with urllib.request.build_opener(NoRedirect).open(request, timeout=12) as response:
                raw = response.read(262145)
                if len(raw) > 262144:
                    raise Stopped('response_limit')
                result = json.loads(raw)
                if not isinstance(result, dict):
                    raise Stopped('invalid_api_response')
                return result
        except urllib.error.HTTPError as error:
            raise Stopped('runner_revoked' if error.code in {401, 403} else 'api_unavailable') from None
        except (urllib.error.URLError, TimeoutError, ValueError, OSError):
            raise Stopped('api_unavailable') from None


def capture(value: object) -> dict[str, object]:
    """정상 은행 화면의 관찰을 검증하고 전체 계좌번호는 해시 후 폐기한다."""
    if not isinstance(value, dict):
        raise Stopped('invalid_capture')
    common = {'accountNumber', 'accountLast4', 'pageKind', 'amountKrw', 'loanType', 'maturityDate'}
    if set(value) != common:
        raise Stopped('invalid_capture')
    number = value['accountNumber']
    last4 = value['accountLast4']
    amount = value['amountKrw']
    if not isinstance(number, str) or not re.fullmatch(r'[0-9-]{10,24}', number):
        raise Stopped('incomplete_account_number')
    digits = number.replace('-', '')
    if not 10 <= len(digits) <= 20 or not isinstance(last4, str) or not re.fullmatch(r'[0-9]{4}', last4) or not digits.endswith(last4):
        raise Stopped('incomplete_account_number')
    if not isinstance(amount, str) or not AMOUNT.fullmatch(amount):
        raise Stopped('invalid_capture_amount')
    base: dict[str, object] = {'formatVersion': 1, 'provider': 'shinhan', 'source': 'browser_assisted',
        'origin': 'https://bank.shinhan.com', 'capturedAt': now(), 'accountLast4': last4,
        'accountFingerprint': hashlib.sha256(('shinhan:' + digits).encode()).hexdigest(), 'bankAsOfDate': None}
    if value['pageKind'] == 'deposit_account_list' and value['loanType'] is None and value['maturityDate'] is None:
        return dict(base, pageKind='deposit_account_list', currency='KRW', balanceKind='ledger', balanceKrw=amount)
    if value['pageKind'] != 'loan_account_list' or not isinstance(value['loanType'], str) or value['loanType'] not in {'interim', 'jeonse'} or amount.startswith('-'):
        raise Stopped('unsupported_layout')
    maturity = value['maturityDate']
    if maturity is not None:
        if not isinstance(maturity, str) or not re.fullmatch(r'[0-9]{4}-[0-9]{2}-[0-9]{2}', maturity):
            raise Stopped('invalid_capture_date')
        try:
            dt.date.fromisoformat(maturity)
        except ValueError:
            raise Stopped('invalid_capture_date') from None
    return dict(base, pageKind='loan_account_list', loanType=value['loanType'], outstandingPrincipalKrw=amount, maturityDate=maturity)


# 신한 보안키패드(TransKey)의 키 이름이다. repl snapshot에서 같은 이름으로 ref를 찾는다(2026-11-04 확인).
VIRTUAL_KEY_LABELS: dict[str, str] = {
    **{chr(code): chr(code) for code in range(ord('a'), ord('z') + 1)},
    **{chr(code): '대문자' + chr(code) for code in range(ord('A'), ord('Z') + 1)},
    **{str(number): str(number) for number in range(10)},
    '`': '어금기호', '-': '빼기', '=': '등호', '\\': '원기호', '[': '왼쪽대괄호', ']': '오른쪽대괄호',
    ';': '세미콜론', "'": '작은따옴표', ',': '쉼표', '.': '마침표', '/': '슬래시',
    '~': '물결표시', '!': '느낌표', '@': '골뱅이', '#': '우물정', '$': '달러기호', '%': '퍼센트',
    '^': '꺽쇠', '&': '엠퍼샌드', '*': '별표', '(': '왼쪽괄호', ')': '오른쪽괄호',
    '_': '밑줄', '+': '더하기', '|': '수직막대', '{': '왼쪽중괄호', '}': '오른쪽중괄호',
    ':': '콜론', '"': '따옴표', '<': '왼쪽꺽쇠괄호', '>': '오른쪽꺽쇠괄호', '?': '물음표',
}
def run_phase(args: argparse.Namespace, api: Api, job: dict[str, object], state: dict[str, object]) -> None:
    """claim을 로컬에 먼저 기록해 중단 후 은행 로그인을 재실행하지 않는다."""
    job_id, claim_id = job['id'], job['claimId']
    previous = state.get('active', {})
    attempted = isinstance(previous, dict) and previous.get('id') == job_id and previous.get('claimId') == claim_id and previous.get('loginAttempted') is True
    state['active'] = {'id': job_id, 'claimId': claim_id, 'continueVersion': job.get('continueVersion', 0), 'uncertain': True, 'loginAttempted': attempted}
    write_private(args.state, state)
    api.call(f'/v1/mac-bank-runner/jobs/{job_id}/progress', {'claimId': claim_id, 'state': 'running'})
    def check_active() -> None:
        result = api.call('/v1/mac-bank-runner/heartbeat', {})
        current = result.get('job')
        if result.get('paired') is not True or not isinstance(current, dict) or current.get('id') != job_id or current.get('claimId') != claim_id or current.get('state') not in ACTIVE:
            raise Stopped('operation_unknown')
    def credentials() -> dict[str, object]:
        check_active()
        version = job.get('credentialVersion')
        if state['active']['loginAttempted'] or type(version) is not int or version < 1 or job.get('continueVersion', 0) != 0:
            raise Stopped('authentication_required')
        state['active']['loginAttempted'] = True
        write_private(args.state, state)
        result = api.call(f'/v1/mac-bank-runner/jobs/{job_id}/credentials', {'claimId': claim_id, 'credentialVersion': version})
        if result.get('credentialVersion') != version:
            result.clear()
            raise Stopped('authentication_required')
        return result
    callback = credentials if type(job.get('credentialVersion')) is int and not attempted and job.get('continueVersion', 0) == 0 else None
    def progress(value: str) -> None:
        api.call(f'/v1/mac-bank-runner/jobs/{job_id}/progress', {'claimId': claim_id, 'state': value})
    result = shinhan_repl().repl_phase(getattr(args, 'aside', DEFAULT_ASIDE), check_active, callback, progress, capture, VIRTUAL_KEY_LABELS,
                                       diagnose=lambda value: append_diagnostic(args.state.parent, dict(value, job=job_id)))
    if result['outcome'] == 'succeeded':
        api.call(f'/v1/mac-bank-runner/jobs/{job_id}/progress', {'claimId': claim_id, 'state': 'logging_out'})
    # 응답 유실 시에는 complete를 재전송해도 은행을 다시 열지 않는다.
    state['completion'] = dict(result, claimId=claim_id)
    write_private(args.state, state)
    api.call(f'/v1/mac-bank-runner/jobs/{job_id}/complete', state['completion'])
    if result['outcome'] == 'authentication_required':
        state['active']['uncertain'] = False
    else:
        state.pop('active', None)
    state.pop('completion', None)
    write_private(args.state, state)


def append_diagnostic(folder: Path, value: dict[str, object]) -> None:
    """repl 엔진 실패 원인을 소유자 전용 파일에 한 줄씩 남긴다. 고정 어휘·hash·단계만 받으며 화면 원문·금액은 없다."""
    fd = os.open(folder / 'diagnostics.log', os.O_WRONLY | os.O_CREAT | os.O_APPEND | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'a') as out:
        out.write(json.dumps(dict(value, at=now()), ensure_ascii=False) + '\n')


def shinhan_repl() -> ModuleType:
    """같은 폴더에 함께 설치한 repl 엔진을 경로로 불러온다(sys.path에 의존하지 않는다)."""
    spec = importlib.util.spec_from_file_location('moa_shinhan_repl', Path(__file__).resolve().with_name('shinhan_repl.py'))
    if not spec or not spec.loader:
        raise Stopped('runtime_unavailable')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def resource_policy(path: Path) -> ModuleType:
    """기존 자원 정책의 내용이 일치할 때만 사용한다."""
    if hashlib.sha256(path.read_bytes()).hexdigest() != POLICY_SHA:
        raise Stopped('resource_policy_changed')
    spec = importlib.util.spec_from_file_location('moa_bank_resources', path)
    if not spec or not spec.loader:
        raise Stopped('resource_policy_unavailable')
    policy = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(policy)
    return policy


def guarded_phase(args: argparse.Namespace, job: dict[str, object]) -> None:
    """원본 API 자원 한도와 소유 프로세스 정리를 매 조회 단계에 적용한다."""
    state = read_private(args.state)
    previous = state.get('active', {})
    attempted = isinstance(previous, dict) and previous.get('id') == job['id'] and previous.get('claimId') == job['claimId'] and previous.get('loginAttempted') is True
    state['active'] = {'id': job['id'], 'claimId': job['claimId'], 'continueVersion': job.get('continueVersion', 0), 'uncertain': True, 'loginAttempted': attempted}
    write_private(args.state, state)
    policy = resource_policy(args.resource_policy)
    try:
        with policy.ValidationLease('api', args.state.parent / 'receipts', 'moa-bank-codex') as lease:
            environment = dict(os.environ, MOA_RESOURCE_LEASE_TOKEN=lease.token)
            command = [sys.executable, str(Path(__file__).resolve()), '--state', str(args.state),
                '--aside', getattr(args, 'aside', DEFAULT_ASIDE),
                '--resource-policy', str(args.resource_policy), '--phase']
            result = lease.run(command, cwd=args.state.parent, env=environment, input=json.dumps(job),
                timeout=170, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if result.returncode != 0:
                raise Stopped('operation_unknown')
    except policy.ResourcePolicyError:
        raise Stopped('runtime_unavailable') from None


def recover_completion(api: Api, job: dict[str, object], state: dict[str, object]) -> None:
    """인증 대기 응답 유실이 앱의 이어가기를 되돌리지 않도록 처리한다."""
    pending, active = state['completion'], state['active']
    if pending.get('outcome') == 'authentication_required':
        # 인증 대기는 관측값이 없으므로 재전송하지 않고 서버 상태로 확인한다.
        acknowledged = job.get('state') == 'authentication_required' or job.get('continueVersion', 0) > active.get('continueVersion', 0)
        active['uncertain'] = not acknowledged
    else:
        api.call(f'/v1/mac-bank-runner/jobs/{job["id"]}/complete', pending)
        state.pop('active', None)
    state.pop('completion', None)


def main() -> None:
    """모아가 승인한 Mac만 outbound 요청을 수신하며 동시에 하나만 실행한다."""
    parser = argparse.ArgumentParser()
    parser.add_argument('--state', required=True, type=Path)
    # 기존 LaunchAgent plist가 --codex를 넘긴다. plist를 바꾸지 않고 업그레이드할 수 있게 받기만 하고 쓰지 않는다.
    parser.add_argument('--codex', help=argparse.SUPPRESS)
    parser.add_argument('--aside', default=DEFAULT_ASIDE)
    parser.add_argument('--resource-policy', type=Path, default=Path(__file__).resolve().with_name('resource_policy.py'))
    parser.add_argument('--pair', action='store_true')
    parser.add_argument('--once', action='store_true')
    parser.add_argument('--phase', action='store_true', help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.state.is_symlink():
        raise Stopped('unsafe_state_path')
    args.state = args.state.absolute()
    args.state.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    parent = args.state.parent.stat()
    if args.state.parent.is_symlink() or parent.st_uid != os.getuid() or stat.S_IMODE(parent.st_mode) & 0o077:
        raise Stopped('unsafe_state_permissions')
    if args.phase:
        policy = resource_policy(args.resource_policy)
        lock = json.loads(policy.LOCK.read_text())
        if lock.get('pid') != os.getppid() or lock.get('profile') != 'api' or not os.environ.get('MOA_RESOURCE_LEASE_TOKEN') or lock.get('token') != os.environ['MOA_RESOURCE_LEASE_TOKEN']:
            raise Stopped('resource_owner_missing')
        state = read_private(args.state)
        run_phase(args, Api(str(state['secret'])), json.load(sys.stdin), state)
        return
    lock_fd = os.open(args.state.parent / 'worker.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        raise Stopped('runner_already_running') from None
    if args.pair:
        if args.state.exists():
            raise Stopped('existing_pairing_preserved')
        state = {'pairId': str(uuid.uuid4()), 'secret': secrets.token_hex(32), 'userCode': secrets.token_hex(16), 'label': '이 Mac'}
        write_private(args.state, state)
        Api(state['secret']).call('/v1/mac-bank-runner/pair', state)
        # 이 코드는 JWT로 로그인한 모아에서 승인해야만 권한을 갖는다.
        print(ORIGIN + '/more/connections?provider=shinhan_bank&macPair=' + state['pairId'] + '&macCode=' + state['userCode'], flush=True)
        return
    state = read_private(args.state)
    api = Api(str(state['secret']))
    last_reason: str | None = None
    while True:
        try:
            heartbeat = api.call('/v1/mac-bank-runner/heartbeat', {})
            job = heartbeat.get('job')
            if heartbeat.get('paired') is True:
                active = state.get('active')
                if isinstance(active, dict):
                    if isinstance(job, dict) and job.get('id') == active.get('id') and job.get('state') in ACTIVE:
                        if 'completion' in state:
                            recover_completion(api, job, state)
                            write_private(args.state, state)
                        elif active.get('uncertain') is True:
                            api.call(f'/v1/mac-bank-runner/jobs/{job["id"]}/complete', {'claimId': active['claimId'], 'outcome': 'failed', 'errorCode': 'operation_unknown', 'logoutConfirmed': False, 'observations': []})
                            state.pop('active', None)
                            write_private(args.state, state)
                        elif job.get('state') == 'running' and job.get('continueVersion', 0) > active.get('continueVersion', 0):
                            guarded_phase(args, job)
                            state = read_private(args.state)
                    else:
                        state.pop('active', None)
                        state.pop('completion', None)
                        write_private(args.state, state)
                else:
                    claimed = api.call('/v1/mac-bank-runner/claim', {'claimId': str(uuid.uuid4())}).get('job')
                    if isinstance(claimed, dict):
                        guarded_phase(args, claimed)
                        state = read_private(args.state)
            last_reason = None
        except Stopped as error:
            state = read_private(args.state)
            if str(error) != last_reason:
                print(json.dumps({'event': 'runner_waiting', 'reason': str(error)}), flush=True)
                last_reason = str(error)
            if str(error) == 'runner_revoked':
                return
        if args.once:
            return
        time.sleep(10)


if __name__ == '__main__':
    try:
        main()
    except (Stopped, OSError, ValueError, KeyError):
        print('{"event":"runner_stopped","reason":"configuration_or_runtime_unavailable"}', flush=True)
        sys.exit(1)
