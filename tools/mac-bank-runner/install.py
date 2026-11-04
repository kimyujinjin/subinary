"""현재 사용자의 Mac 실행기를 설치하고 같은 시도의 부분 설치를 재개한다."""
from pathlib import Path
import hashlib
import os
import plistlib
import secrets
import shutil
import stat
import subprocess
import sys
import uuid
from worker import Api, ORIGIN, read_private, write_private

LABEL = 'cloud.subinary.moa-bank-runner'


def upgrade() -> None:
    """등록·페어링을 그대로 두고 실행기·자원 정책·repl 엔진 파일만 바꾼 뒤 실행기를 다시 시작한다.

    등록 파일(plist)은 바꾸지 않는다 — 실행 인자가 같으므로 같은 Mac 연결을 유지한다.
    """
    support = Path.home() / 'Library/Application Support/MoaBankRunner'
    intent_path, target = support / 'install.json', support / 'worker.py'
    if not intent_path.exists() or read_private(intent_path).get('phase') != 'registered':
        raise RuntimeError('등록된 실행기가 없어 업그레이드하지 않았습니다. 먼저 설치해 주세요.')
    if target.is_symlink():
        raise RuntimeError('실행기 파일 경로를 확인해 주세요.')
    for name in ['worker.py', 'resource_policy.py', 'shinhan_repl.py']:
        source = Path(__file__).with_name(name).resolve()
        destination = support / name
        temporary = support / (name + '.new')
        temporary.write_bytes(source.read_bytes()); temporary.chmod(0o600)
        os.replace(temporary, destination)
    intent = read_private(intent_path)
    intent['workerSha256'] = hashlib.sha256(target.read_bytes()).hexdigest()
    write_private(intent_path, intent)
    subprocess.run(['/bin/launchctl', 'kickstart', '-k', 'gui/' + str(os.getuid()) + '/' + LABEL], check=True)
    print('모아 Mac 실행기를 업그레이드하고 다시 시작했습니다.')


def main() -> None:
    """정확히 같은 파일의 부분 설치만 재개하며 기존 외부 등록을 보존한다."""
    if sys.platform != 'darwin':
        raise RuntimeError('Mac에서만 설치할 수 있습니다.')
    support = Path.home() / 'Library/Application Support/MoaBankRunner'
    support.mkdir(parents=True, mode=0o700, exist_ok=True)
    info = support.stat()
    if support.is_symlink() or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) & 0o077:
        raise RuntimeError('실행기 저장 경로와 권한을 확인해 주세요.')
    source = Path(__file__).with_name('worker.py').resolve()
    target, state, intent_path = support / 'worker.py', support / 'state.json', support / 'install.json'
    plist = Path.home() / 'Library/LaunchAgents' / (LABEL + '.plist')
    executable, codex = shutil.which('python3'), Path.home() / '.local/bin/codex'
    if not executable or not codex.is_file():
        raise RuntimeError('기존 Python과 Codex 설치를 확인해 주세요.')
    domain = 'gui/' + str(os.getuid())
    loaded = subprocess.run(['/bin/launchctl', 'print', domain + '/' + LABEL], capture_output=True, text=True)
    expected_sha = hashlib.sha256(source.read_bytes()).hexdigest()
    record = {'Label': LABEL, 'ProgramArguments': [executable, '-B', str(target), '--state', str(state), '--codex', str(codex)],
        'WorkingDirectory': str(support), 'RunAtLoad': True, 'KeepAlive': {'SuccessfulExit': False},
        'ThrottleInterval': 30, 'ProcessType': 'Background', 'Umask': 0o077,
        'EnvironmentVariables': {'PATH': '/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin', 'TZ': 'Asia/Seoul', 'NODE_OPTIONS': '--max-old-space-size=1024'},
        'StandardOutPath': str(support / 'events.log'), 'StandardErrorPath': '/dev/null'}
    plist_bytes = plistlib.dumps(record)
    plist_sha = hashlib.sha256(plist_bytes).hexdigest()
    if intent_path.exists():
        intent = read_private(intent_path)
        if intent.get('workerSha256') != expected_sha or intent.get('plistSha256') != plist_sha or intent.get('label') != LABEL:
            raise RuntimeError('이전 설치와 내용이 달라 덮어쓰지 않았습니다.')
    else:
        if target.exists() or plist.exists() or loaded.returncode == 0:
            raise RuntimeError('기존 모아 실행기를 보존했습니다. 상태를 먼저 확인해 주세요.')
        intent = {'label': LABEL, 'workerSha256': expected_sha, 'plistSha256': plist_sha, 'phase': 'prepared'}
        write_private(intent_path, intent)
    if target.is_symlink() or (target.exists() and hashlib.sha256(target.read_bytes()).hexdigest() != expected_sha):
        raise RuntimeError('실행기 파일이 달라 설치를 중단했습니다.')
    if not target.exists():
        target.write_bytes(source.read_bytes()); target.chmod(0o600)
    for name in ['resource_policy.py', 'shinhan_repl.py']:
        companion = support / name
        if not companion.exists():
            companion.write_bytes(Path(__file__).with_name(name).read_bytes()); companion.chmod(0o600)
    if intent['phase'] == 'prepared':
        if state.exists():
            pair = read_private(state)
            if set(pair) != {'pairId', 'secret', 'userCode', 'label'}:
                raise RuntimeError('진행 중인 실행기 상태를 보존했습니다.')
        else:
            pair = {'pairId': str(uuid.uuid4()), 'secret': secrets.token_hex(32), 'userCode': secrets.token_hex(16), 'label': '이 Mac의 Codex'}
            write_private(state, pair)
        Api(str(pair['secret'])).call('/v1/mac-bank-runner/pair', pair)
        intent['phase'] = 'paired'; write_private(intent_path, intent)
    pair = read_private(state)
    if plist.is_symlink() or (plist.exists() and plist.read_bytes() != plist_bytes):
        raise RuntimeError('기존 실행기 등록 파일을 보존했습니다.')
    if not plist.exists():
        plist.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        with plist.open('xb') as output: output.write(plist_bytes)
        plist.chmod(0o600)
    if loaded.returncode == 0:
        # 응답 유실 뒤에도 동일 등록 경로와 프로그램만 소유한 실행으로 인정한다.
        if ('path = ' + str(plist)) not in loaded.stdout or any(str(value) not in loaded.stdout for value in [target, state, executable]):
            raise RuntimeError('다른 실행기 등록이 있어 변경하지 않았습니다.')
    else:
        intent['phase'] = 'bootstrap_requested'; write_private(intent_path, intent)
        result = subprocess.run(['/bin/launchctl', 'bootstrap', domain, str(plist)], capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError('Mac 실행기 등록을 확인하지 못했습니다. 같은 설치 명령으로 상태를 확인해 주세요.')
    intent['phase'] = 'registered'; write_private(intent_path, intent)
    print(ORIGIN + '/more/connections?provider=shinhan_bank&macPair=' + str(pair['pairId']) + '&macCode=' + str(pair['userCode']))
    print('모아 Mac 실행기를 등록했습니다. 표시된 모아 화면에서 이 Mac 연결을 승인해 주세요.')


if __name__ == '__main__':
    upgrade() if sys.argv[1:] == ['--upgrade'] else main()
