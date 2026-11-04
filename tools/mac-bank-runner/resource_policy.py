"""Mac 은행 조회 실행기의 자원 정책(원본: Codex 검증 작업의 validation_resources.py).

2026-11-04 완화: 이 Mac은 운영 서버(Docker)를 함께 돌려 평소 메모리 압박이 '경고'(2)인 경우가 많아,
'정상'(1)만 허용하던 원래 기준으로는 조회가 거의 시작되지 않았다. 운영 서버를 지키는 핵심인
'위험'(4) 거부는 유지하고, '경고'는 허용한다. 스왑 증가 한도도 운영 서버가 실제로 위험할 때만 막도록 올렸다.

Bounded, serial LOCAL VALIDATION policy. Never use this as an operating deploy gate.

Absolute accumulated swap is recorded, not an admission threshold. Engineering
budgets below are conservative starting values, not Apple guarantees. RSS is
sampled (shared pages may be counted twice), while supported Node heaps and
test-container cgroups provide separate limits. No OS settings are changed.
"""
from pathlib import Path
import ctypes, datetime, errno, hashlib, json, os, re, signal, stat, subprocess, tempfile, time, uuid

HERE = Path(__file__).resolve().parent
LOCK = HERE / '.validation-stage.lock'
ADMISSION_SECONDS = 15.0
POLL_SECONDS = 2.0
PROFILES = {
    'light': {'rssMiB': 512, 'heapMiB': 256, 'seconds': 120},
    'unit': {'rssMiB': 1536, 'heapMiB': 1024, 'seconds': 600},
    'typecheck': {'rssMiB': 2048, 'heapMiB': 1536, 'seconds': 900},
    'packages': {'rssMiB': 2048, 'heapMiB': 1536, 'seconds': 900},
    'api': {'rssMiB': 1536, 'heapMiB': 1024, 'seconds': 180},
    'next': {'rssMiB': 4096, 'heapMiB': 1536, 'seconds': 300},
    'http': {'rssMiB': 512, 'heapMiB': 256, 'seconds': 240, 'containerCapsMiB': [384, 96, 1024]},
    'image_copy': {'rssMiB': 512, 'heapMiB': 256, 'seconds': 600,
                   'externalBuilderHardMemoryCapVerified': False},
}

class ResourcePolicyError(RuntimeError): pass
def utc(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def read(args):
    try: r = subprocess.run(args, capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.TimeoutExpired): raise ResourcePolicyError('resource_measurement_unavailable') from None
    if r.returncode: raise ResourcePolicyError('resource_measurement_unavailable')
    return r.stdout
def snapshot():
    pressure = read(['/usr/sbin/sysctl', '-n', 'kern.memorystatus_vm_pressure_level']).strip()
    if pressure not in ['1', '2', '4']: raise ResourcePolicyError('resource_pressure_unknown')
    vm = read(['/usr/bin/vm_stat']); size = re.search(r'page size of (\d+) bytes', vm)
    counts = {m[1].strip('"'): int(m[2]) for line in vm.splitlines()
              if (m := re.match(r'^([^:]+):\s+(\d+)\.', line))}
    swap = re.search(r'used\s*=\s*([0-9.]+)([MG])', read(['/usr/sbin/sysctl', '-n', 'vm.swapusage']))
    physical = read(['/usr/sbin/sysctl', '-n', 'hw.memsize']).strip()
    if not size or not swap or not physical.isdigit() or not all(k in counts for k in ['Swapins', 'Swapouts']):
        raise ResourcePolicyError('resource_measurement_unparseable')
    return {'at': utc(), 'monotonic': time.monotonic(), 'pressure': int(pressure), 'pageBytes': int(size[1]),
            'swapUsedMiB': float(swap[1]) * (1024 if swap[2] == 'G' else 1),
            'swapinPages': counts['Swapins'], 'swapoutPages': counts['Swapouts'],
            'physicalMiB': int(physical) / (1024 ** 2),
            'compressedMiB': counts.get('Pages occupied by compressor', 0) * int(size[1]) / (1024 ** 2)}
def delta(first, last):
    duration = last['monotonic'] - first['monotonic']
    if duration <= 0 or first['pageBytes'] != last['pageBytes'] or any(last[k] < first[k] for k in ['swapinPages', 'swapoutPages']):
        raise ResourcePolicyError('resource_counter_reset_or_clock_invalid')
    out = (last['swapoutPages'] - first['swapoutPages']) * last['pageBytes'] / (1024 ** 2)
    return {'seconds': duration, 'grossSwapoutMiB': out, 'grossSwapoutMiBPerSecond': out / duration,
            'positiveSwapUsedMiB': max(0.0, last['swapUsedMiB'] - first['swapUsedMiB'])}
def check_admission(first, last, profile):
    d = delta(first, last)
    if first['pressure'] == 4 or last['pressure'] == 4: raise ResourcePolicyError('resource_pressure_critical')
    if d['seconds'] < ADMISSION_SECONDS - 0.1: raise ResourcePolicyError('resource_observation_too_short')
    if d['grossSwapoutMiBPerSecond'] > 32 or d['positiveSwapUsedMiB'] > 512:
        raise ResourcePolicyError('resource_recent_swap_growth')
    budget = profile['rssMiB'] + sum(profile.get('containerCapsMiB', []))
    if budget * 3 > last['physicalMiB']: raise ResourcePolicyError('resource_stage_budget_exceeds_host_fraction')
    return d
def group_rss(pgid):
    rows = []
    for line in read(['/bin/ps', '-axo', 'pid=,pgid=,rss=']).splitlines():
        parts = line.split()
        if len(parts) == 3 and all(p.isdigit() for p in parts) and int(parts[1]) == pgid:
            rows.append({'pid': int(parts[0]), 'rssMiB': int(parts[2]) / 1024})
    return rows

class _ProcBsdInfo(ctypes.Structure):
    # macOS SDK sys/proc_info.h, PROC_PIDTBSDINFO (3). Names are never returned.
    _fields_ = [(name, ctypes.c_uint32) for name in
                ('flags', 'status', 'xstatus', 'pid', 'ppid', 'uid', 'gid',
                 'ruid', 'rgid', 'svuid', 'svgid', 'reserved')]
    _fields_ += [('comm', ctypes.c_char * 16), ('name', ctypes.c_char * 32)]
    _fields_ += [(name, ctypes.c_uint32) for name in
                 ('nfiles', 'pgid', 'pjobc', 'tdev', 'tpgid')]
    _fields_ += [('nice', ctypes.c_int32), ('startSec', ctypes.c_uint64),
                ('startUsec', ctypes.c_uint64)]

_PROC_LIBRARY = None
def process_identity(pid):
    """Read numeric identity with microsecond start time; never argv or env."""
    global _PROC_LIBRARY
    if type(pid) is not int or pid <= 1: raise ResourcePolicyError('resource_process_pid_invalid')
    try:
        if _PROC_LIBRARY is None:
            library = ctypes.CDLL('/usr/lib/libproc.dylib', use_errno=True)
            library.proc_pidinfo.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_uint64,
                                            ctypes.c_void_p, ctypes.c_int]
            library.proc_pidinfo.restype = ctypes.c_int
            _PROC_LIBRARY = library
        value = _ProcBsdInfo(); ctypes.set_errno(0)
        count = _PROC_LIBRARY.proc_pidinfo(pid, 3, 0, ctypes.byref(value), ctypes.sizeof(value))
        if count == 0 and ctypes.get_errno() == errno.ESRCH: return None
        if (count != ctypes.sizeof(value) or value.pid != pid or value.startSec == 0
                or value.startUsec >= 1000000):
            raise ResourcePolicyError('resource_process_identity_unavailable')
        return {'pid': pid, 'ppid': int(value.ppid), 'pgid': int(value.pgid),
                'uid': int(value.uid), 'startSec': int(value.startSec),
                'startUsec': int(value.startUsec), 'zombie': value.status == 5}
    except ResourcePolicyError: raise
    except Exception: raise ResourcePolicyError('resource_process_identity_unavailable') from None

def process_table():
    rows = {}
    for line in read(['/bin/ps', '-axo', 'pid=,ppid=,pgid=,rss=']).splitlines():
        parts = line.split()
        if len(parts) != 4 or not all(p.isdigit() for p in parts):
            raise ResourcePolicyError('resource_process_table_unparseable')
        pid, ppid, pgid, rss = map(int, parts)
        if pid in rows: raise ResourcePolicyError('resource_process_table_unparseable')
        rows[pid] = {'pid': pid, 'ppid': ppid, 'pgid': pgid, 'rssMiB': rss / 1024}
    if not rows: raise ResourcePolicyError('resource_process_table_unavailable')
    return rows

def identity_key(value):
    return (value['pid'], value['startSec'], value['startUsec'])

class OwnedProcessTree:
    """Only observed parent links confer ownership; PGID alone never does."""
    def __init__(self, process):
        value = process_identity(process.pid)  # Before poll() can reap a fast leader.
        if (value is None or value['ppid'] != os.getpid() or value['pgid'] != process.pid
                or value['uid'] != os.getuid()):
            raise ResourcePolicyError('resource_process_root_identity_unconfirmed')
        self.root = process.pid; self.uid = value['uid']; self.uncertain = False
        self.owned = {process.pid: {**value, 'depth': 0}}

    def observe(self):
        try:
            table = process_table(); current = {}
            for pid, known in list(self.owned.items()):
                value = process_identity(pid)
                if value is None: continue
                if identity_key(value) != identity_key(known):
                    raise ResourcePolicyError('resource_owned_pid_reused')
                if value['uid'] != self.uid:
                    raise ResourcePolicyError('resource_owned_identity_changed')
                if pid not in table and not value['zombie']:
                    raise ResourcePolicyError('resource_process_sample_inconsistent')
                current[pid] = value
            changed = True
            while changed:
                changed = False
                for pid, row in table.items():
                    if pid in self.owned or row['ppid'] not in current: continue
                    parent = current[row['ppid']]; value = process_identity(pid)
                    if value is None: continue
                    if value['ppid'] != row['ppid']: continue  # Changed before a link was observed.
                    parent_now = process_identity(parent['pid'])
                    if (parent_now is None or identity_key(parent_now) != identity_key(parent)
                            or parent_now['uid'] != self.uid):
                        raise ResourcePolicyError('resource_process_parent_identity_changed')
                    if (value['uid'] != self.uid or
                            (value['startSec'], value['startUsec']) < (parent['startSec'], parent['startUsec'])):
                        raise ResourcePolicyError('resource_process_child_identity_unconfirmed')
                    if len(self.owned) >= 4096: raise ResourcePolicyError('resource_process_tracking_budget')
                    self.owned[pid] = {**value, 'depth': self.owned[parent['pid']]['depth'] + 1}
                    current[pid] = value; changed = True
            # A same-group orphan without an observed parent is not safe to adopt or kill.
            for pid, row in table.items():
                if row['pgid'] != self.root or pid in self.owned: continue
                value = process_identity(pid)
                if value is not None and value['pgid'] == self.root and not value['zombie']:
                    raise ResourcePolicyError('resource_process_group_member_unattributed')
            live = [{**value, 'depth': self.owned[pid]['depth'],
                     'rssMiB': table.get(pid, {}).get('rssMiB', 0.0)}
                    for pid, value in current.items() if not value['zombie']]
            return live
        except BaseException:
            self.uncertain = True
            raise

    def signal_owned(self, member, sig):
        # macOS has no pidfd signal API: a narrow read-to-signal race remains.
        known = self.owned.get(member['pid'])
        if known is None or identity_key(known) != identity_key(member):
            self.uncertain = True
            raise ResourcePolicyError('resource_signal_member_not_owned')
        current = process_identity(member['pid'])
        if current is None: return
        if identity_key(current) != identity_key(member) or current['uid'] != self.uid:
            self.uncertain = True
            raise ResourcePolicyError('resource_signal_identity_changed')
        if current['zombie']: return
        try: os.kill(member['pid'], sig)  # Never killpg: another group may include foreign PIDs.
        except ProcessLookupError: return
        except OSError:
            self.uncertain = True
            raise ResourcePolicyError('resource_owned_signal_failed') from None

class ValidationLease:
    def __init__(self, profile, evidence_dir=HERE, label='validation'):
        if profile not in PROFILES or not re.fullmatch(r'[a-zA-Z0-9_.-]{1,80}', label):
            raise ResourcePolicyError('resource_profile_or_label_invalid')
        self.profile_name = profile; self.profile = dict(PROFILES[profile]); self.token = uuid.uuid4().hex
        self.owner = None; self.first = self.last = self.rate_anchor = None; self.fast_windows = 0; self.deadline = None
        self._trees = {}; self._observed_processes = set(); self._observed_groups = set()
        self.receipt_path = Path(evidence_dir) / ('resources-' + label + '-' + self.token[:12] + '.json')
        self.record = {'status': 'not_started', 'profile': profile, 'budgets': self.profile, 'label': label,
                       'policySha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                       'operatingDeployGuardChanged': False, 'absoluteSwapAdmissionLimit': None,
                       'engineeringThresholdsNotAppleGuarantees': True, 'samples': [], 'commands': [],
                       'peakSampledProcessGroupRssMiB': 0.0, 'processGroupRssSamples': 0,
                       'peakSampledProcessTreeRssMiB': 0.0, 'processTreeRssSamples': 0,
                       'observedOwnedProcessCount': 0, 'observedOwnedProcessGroupCount': 0,
                       'observedSeparateProcessGroup': False,
                       'processOwnershipMethod': 'observed_ppid_and_macos_start_microseconds',
                       'processTreeSamplingMayMissUnobservedDetachedDescendants': True,
                       'processTreeIsHardMemoryCap': False,
                       'ownedCleanupConfirmed': True, 'operatingServiceChanges': 0}
    def save(self):
        self.receipt_path.parent.mkdir(parents=True, exist_ok=True)
        self.receipt_path.write_text(json.dumps(self.record, indent=2) + '\n')
    def verify_lock(self):
        try:
            s = LOCK.lstat()
            if self.owner is None or not stat.S_ISREG(s.st_mode) or (s.st_dev, s.st_ino) != self.owner or s.st_uid != os.getuid() or stat.S_IMODE(s.st_mode) != 0o600 or s.st_size > 2048:
                raise ResourcePolicyError('resource_serial_lock_changed')
            fd = os.open(LOCK, os.O_RDONLY | os.O_NOFOLLOW)
            with os.fdopen(fd) as f:
                opened = os.fstat(f.fileno())
                if (opened.st_dev, opened.st_ino) != self.owner: raise ResourcePolicyError('resource_serial_lock_changed')
                data = json.load(f)
            if data.get('token') != self.token or data.get('pid') != os.getpid():
                raise ResourcePolicyError('resource_serial_lock_changed')
        except ResourcePolicyError: raise
        except Exception: raise ResourcePolicyError('resource_serial_lock_changed') from None
    def __enter__(self):
        self.record.update(status='sampling', startedAt=utc()); self.save()
        try:
            try: fd = os.open(LOCK, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            except OSError: raise ResourcePolicyError('resource_serial_stage_already_active') from None
            s = os.fstat(fd); self.owner = (s.st_dev, s.st_ino)
            with os.fdopen(fd, 'w') as stream:
                json.dump({'token': self.token, 'pid': os.getpid(), 'startedAt': utc(), 'profile': self.profile_name}, stream)
                stream.flush(); os.fsync(stream.fileno())
            self.verify_lock(); first = snapshot()
            if first['pressure'] == 4: raise ResourcePolicyError('resource_pressure_critical')
            time.sleep(ADMISSION_SECONDS)
            last = snapshot(); admitted = check_admission(first, last, self.profile)
            self.first = first; self.last = self.rate_anchor = last; self.deadline = last['monotonic'] + self.profile['seconds']
            self.record.update(status='running', admission=admitted,
                                                                   samples=[first, last]); self.save(); return self
        except BaseException as error:
            self.record.update(status='held', reason=str(error) if isinstance(error, ResourcePolicyError) else 'resource_admission_failed')
            self.save(); self.release(); raise
    def assert_ok(self):
        try:
            self.verify_lock()
            if self.record['status'] in ['aborted', 'held']: raise ResourcePolicyError(self.record.get('reason', 'resource_stage_aborted'))
            current = snapshot(); total = delta(self.first, current)
            self.record['samples'].append(current); self.last = current
            if current['pressure'] == 4: raise ResourcePolicyError('resource_pressure_critical')
            if current['monotonic'] > self.deadline: raise ResourcePolicyError('resource_stage_wallclock_budget')
            step = delta(self.rate_anchor, current)
            if step['seconds'] >= POLL_SECONDS:
                self.fast_windows = self.fast_windows + 1 if step['grossSwapoutMiBPerSecond'] > 64 else 0
                self.rate_anchor = current
            if self.fast_windows >= 2 or total['grossSwapoutMiB'] > 4096 or total['positiveSwapUsedMiB'] > 2048:
                raise ResourcePolicyError('resource_runtime_swap_growth')
            return current
        except ResourcePolicyError as error:
            self.record.update(status='aborted', reason=str(error)); self.save(); raise
    def _tree_for(self, process):
        try:
            # Retain the Popen object: Python id reuse must never reuse an old tree.
            if process not in self._trees: self._trees[process] = OwnedProcessTree(process)
            return self._trees[process]
        except BaseException:
            self.record['ownedCleanupConfirmed'] = False
            raise
    def _observe_tree(self, tree, command=None):
        members = tree.observe()
        rss = sum(x['rssMiB'] for x in members)
        group = sum(x['rssMiB'] for x in members if x['pgid'] == tree.root)
        self.record['processGroupRssSamples'] += 1
        self.record['peakSampledProcessGroupRssMiB'] = max(self.record['peakSampledProcessGroupRssMiB'], group)
        self.record['processTreeRssSamples'] += 1
        self.record['peakSampledProcessTreeRssMiB'] = max(self.record['peakSampledProcessTreeRssMiB'], rss)
        self._observed_processes.update(identity_key(x) for x in tree.owned.values())
        self._observed_groups.update(x['pgid'] for x in tree.owned.values())
        self._observed_groups.update(x['pgid'] for x in members)
        self.record['observedOwnedProcessCount'] = len(self._observed_processes)
        self.record['observedOwnedProcessGroupCount'] = len(self._observed_groups)
        self.record['observedSeparateProcessGroup'] |= any(x['pgid'] != tree.root for x in members)
        if command is not None:
            command['ownedProcesses'] = [{key: x[key] for key in
                ('pid', 'ppid', 'pgid', 'startSec', 'startUsec', 'depth')} for x in tree.owned.values()]
        return members
    def stop_owned(self, process):
        was_confirmed = self.record['ownedCleanupConfirmed']
        self.record['ownedCleanupConfirmed'] = False
        try:
            tree = self._tree_for(process)
            for sig in (signal.SIGTERM, signal.SIGKILL):
                members = self._observe_tree(tree)
                # Signal only individually re-identified members, including other PGIDs.
                for member in sorted(members, key=lambda x: x['depth']): tree.signal_owned(member, sig)
                for attempt in range(26):
                    process.poll()  # Reap only our Popen leader; descendants retain their identities.
                    if not self._observe_tree(tree):
                        self.record['ownedCleanupConfirmed'] = was_confirmed and not tree.uncertain
                        return
                    if attempt != 25: time.sleep(0.2)
        except BaseException:
            # Cancellation/measurement/identity failures must not release the serial lock.
            self.record['ownedCleanupConfirmed'] = False
    def monitor_process(self, process, timeout=None):
        limit = min(timeout or self.profile['seconds'], self.profile['seconds'])
        command = {'pid': process.pid, 'pgid': process.pid, 'startedAt': utc(), 'timeoutSeconds': limit}
        self.record['commands'].append(command); started = time.monotonic()
        try:
            tree = self._tree_for(process)
            while True:
                self.assert_ok(); members = self._observe_tree(tree, command)
                if sum(x['rssMiB'] for x in members) > self.profile['rssMiB']:
                    raise ResourcePolicyError('resource_process_tree_rss_budget')
                code = process.poll()
                if code is not None:
                    command.update(exitCode=code, finishedAt=utc())
                    # The leader can exit between the RSS sample and poll().
                    # Re-sample after it is reaped before declaring an orphan.
                    if self._observe_tree(tree, command):
                        raise ResourcePolicyError('resource_children_remaining_after_exit')
                    self.save(); return code
                if time.monotonic() - started > limit: raise ResourcePolicyError('resource_stage_timeout')
                time.sleep(POLL_SECONDS)
        except BaseException as error:
            reason = str(error) if isinstance(error, ResourcePolicyError) else 'resource_validation_cancelled_or_monitor_failed'
            self.record.update(status='aborted', reason=reason); self.stop_owned(process)
            command.update(exitCode=process.poll(), finishedAt=utc()); self.save(); raise
    def run(self, args, cwd=None, env=None, input=None, timeout=None, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True):
        self.assert_ok()
        temporary = []; process = None
        def output(value):
            if value == subprocess.PIPE:
                f = tempfile.TemporaryFile(); temporary.append(f); return f
            return value
        out = output(stdout); err = output(stderr)
        try:
            stdin = subprocess.DEVNULL
            if input is not None:
                payload = input.encode() if isinstance(input, str) else bytes(input)
                if len(payload) > 8 * 1024 * 1024: raise ResourcePolicyError('resource_input_size_budget')
                stdin = tempfile.TemporaryFile(); temporary.append(stdin)
                stdin.write(payload); stdin.seek(0)
            self.assert_ok()
            # An owned file avoids blocking on a child that never reads PIPE
            # input before timeout/pressure monitoring has begun.
            process = subprocess.Popen(args, cwd=cwd, env=env, stdin=stdin,
                                       stdout=out, stderr=err, text=text, start_new_session=True)
            code = self.monitor_process(process, timeout)
            def content(requested, stream):
                if requested != subprocess.PIPE: return None
                stream.seek(0); raw = stream.read(); return raw.decode(errors='replace') if text else raw
            return subprocess.CompletedProcess(args, code, content(stdout, out), content(stderr, err))
        except BaseException as error:
            if process is not None: self.stop_owned(process)
            reason = str(error) if isinstance(error, ResourcePolicyError) else 'resource_process_execution_failed_or_cancelled'
            self.record.update(status='aborted', reason=reason); self.save()
            if isinstance(error, ResourcePolicyError): raise
            if not isinstance(error, Exception): raise
            raise ResourcePolicyError(reason) from None
        finally:
            for f in temporary: f.close()
    def release(self):
        if self.owner is not None and self.record['ownedCleanupConfirmed']:
            self.verify_lock(); LOCK.unlink(); self.owner = None
    def __exit__(self, kind, value, tb):
        if kind is not None and self.record['status'] not in ['aborted', 'held']:
            self.record.update(status='failed', reason=str(value) if isinstance(value, ResourcePolicyError) else 'resource_caller_failed')
        elif kind is None and self.record['status'] not in ['aborted', 'held']:
            self.record['status'] = 'passed' if all(x.get('exitCode') == 0 for x in self.record['commands']) else 'command_failed'
        if not self.record['ownedCleanupConfirmed']:
            self.record['status'] = 'attention_required_owned_cleanup_unconfirmed'
        self.record['finishedAt'] = utc(); self.save(); self.release()
