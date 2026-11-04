"""실제 서비스·네트워크 없이 이번 시도의 부분 설치 재개를 검사한다."""
import contextlib
import io
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import install as installer
from worker import Stopped, read_private


class InstallTests(unittest.TestCase):
    """같은 키·같은 공개 파일만 재사용하고 외부 설치를 덮어쓰지 않는다."""
    def test_pair_failure_resumes_with_same_key_and_registers_once(self):
        with tempfile.TemporaryDirectory() as folder:
            home = Path(folder); aside = home / '.local/bin/aside'; aside.parent.mkdir(parents=True); aside.write_text('fixture')
            def run(command: list[str], **options: object) -> subprocess.CompletedProcess[str]:
                return subprocess.CompletedProcess(command, 113 if command[1] == 'print' else 0, stdout='', stderr='')
            with patch.object(installer.Path, 'home', return_value=home), patch.object(installer.sys, 'platform', 'darwin'), patch.object(installer.shutil, 'which', return_value='/usr/bin/python3'), patch.object(installer.subprocess, 'run', side_effect=run) as execute, patch.object(installer, 'Api') as api, contextlib.redirect_stdout(io.StringIO()):
                api.return_value.call.side_effect = [Stopped('api_unavailable'), {}]
                with self.assertRaises(Stopped): installer.main()
                state_path = home / 'Library/Application Support/MoaBankRunner/state.json'
                before = read_private(state_path)
                installer.main()
                self.assertTrue(read_private(state_path)['secret'] == before['secret'])
                self.assertEqual(read_private(state_path.with_name('install.json'))['phase'], 'registered')
                self.assertEqual(sum(call.args[0][1] == 'bootstrap' for call in execute.call_args_list), 1)
                self.assertTrue((home / 'Library/LaunchAgents/cloud.subinary.moa-bank-runner.plist').exists())

    def test_foreign_existing_worker_is_preserved(self):
        with tempfile.TemporaryDirectory() as folder:
            home = Path(folder); aside = home / '.local/bin/aside'; aside.parent.mkdir(parents=True); aside.write_text('fixture')
            support = home / 'Library/Application Support/MoaBankRunner'; support.mkdir(parents=True, mode=0o700)
            target = support / 'worker.py'; target.write_text('existing fixture')
            with patch.object(installer.Path, 'home', return_value=home), patch.object(installer.sys, 'platform', 'darwin'), patch.object(installer.shutil, 'which', return_value='/usr/bin/python3'), patch.object(installer.subprocess, 'run', return_value=subprocess.CompletedProcess([], 113, stdout='', stderr='')), patch.object(installer, 'Api') as api:
                with self.assertRaises(RuntimeError): installer.main()
                self.assertEqual(target.read_text(), 'existing fixture')
                api.assert_not_called()


if __name__ == '__main__': unittest.main()
