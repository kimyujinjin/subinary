extends Node
## 실기 release 빌드에는 에디터의 remote debug 콘솔이 없고 화면 HUD 숫자는 5분 동안
## 흘러가 버린다. "실기에서 판정한다"는 규칙과 "실기의 숫자를 볼 방법이 없다"는 현실이
## 충돌하면 결국 에디터에서 판정하게 되어 잘못된 결론에 도달한다 — 그래서 CSV 를 남긴다.
##
## user:// 전용. /v1/play/* API 를 쓰지 않는다 (완전 독립 유지).
## iOS 에서 user:// 는 Documents 에 매핑되어 iCloud 백업 대상이 되므로
## 계측 CSV 는 백업 제외 대상임을 export 단계에서 명시한다.

const PATH := "user://runlog.csv"
## Android release 는 debuggable 이 아니라 `adb run-as` 가 막힌다("package not debuggable").
## 그런데 판정은 release 에서만 유효하다 — 두 요구가 충돌하면 결국 에디터에서 판정하게 되고,
## 그게 이 파일이 존재하는 이유 전체를 무효로 만든다.
##
## 앱 소유 외부 디렉터리 `/sdcard/Android/data/<pkg>/files/` 는 런타임 권한 없이 쓸 수 있고
## `adb shell` 이 읽는다(실기 확인). 그래서 Android 에서는 거기에 쓴다.
## 없거나 못 쓰면 조용히 내부 저장소로 되돌아간다 — 로그가 아예 없는 것보다 낫다.
const ANDROID_PKG := "dev.subinary.lumendrift"
const ANDROID_DIR := "/sdcard/Android/data/%s/files" % ANDROID_PKG
## 마지막 detail 칼럼은 key=value;key=value 자유 형식이다 — 새 계측을 넣을 때마다
## 헤더를 바꾸지 않기 위해서다. 헤더가 바뀌면 기존 파일을 옆으로 치우고 새로 쓴다.
const HEADER := "ev,run,tick,seed,x,y,kind,bid,gap_x0,gap_w,k,focus,regrip,since_regrip,flow_c,flow_u,bullets,fps,build,ppu,mm,detail"

var _f: FileAccess = null
var _cols: int = HEADER.split(",").size()
var _rows: int = 0
var _path: String = PATH

## 쓸 수 있는 경로를 고른다. Android 는 외부 앱 디렉터리를 먼저 시도한다.
func _pick_path() -> String:
	if OS.get_name() != "Android":
		return PATH
	if not DirAccess.dir_exists_absolute(ANDROID_DIR):
		DirAccess.make_dir_recursive_absolute(ANDROID_DIR)
	var ext := ANDROID_DIR + "/runlog.csv"
	# 열어 봐야 안다 — dir_exists 만 보고 쓰면 OEM 정책으로 막힌 기기에서 로그가 통째로 사라진다.
	var probe := FileAccess.open(ext, FileAccess.READ_WRITE if FileAccess.file_exists(ext) else FileAccess.WRITE)
	if probe == null:
		return PATH
	probe.close()
	return ext

func _ready() -> void:
	_path = _pick_path()
	_rotate_if_stale()
	var exists := FileAccess.file_exists(_path)
	_f = FileAccess.open(_path, FileAccess.READ_WRITE if exists else FileAccess.WRITE)
	if _f == null:
		push_warning("RunLog: %s 를 열 수 없다 (err %d)" % [_path, FileAccess.get_open_error()])
		return
	if exists:
		_f.seek_end()
	else:
		_f.store_line(HEADER)
	_f.flush()

## 헤더가 다른 기존 파일에 이어 쓰면 칼럼이 어긋나 판정이 조용히 틀린다.
## 지우지 않고 옆으로 치운다(설계: 손상 파일은 버리지 말고 .bak 로).
func _rotate_if_stale() -> void:
	if not FileAccess.file_exists(_path):
		return
	var f := FileAccess.open(_path, FileAccess.READ)
	if f == null:
		return
	var size := f.get_length()
	var first := f.get_line()
	f.close()
	# 빈 파일은 치울 것이 없다. 치우면 설치할 때마다 0바이트 .old 가 쌓이고,
	# 나중에 로그 디렉터리를 본 사람이 "왜 이게 있지" 로 시간을 쓴다.
	# (_pick_path 의 쓰기 탐침이 파일을 만들기 때문에 매 설치마다 걸렸다.)
	if size == 0 or first == HEADER:
		return
	var dst := _path.get_base_dir() + "/runlog-%d.old.csv" % int(Time.get_unix_time_from_system())
	DirAccess.rename_absolute(ProjectSettings.globalize_path(_path), ProjectSettings.globalize_path(dst))

func path_abs() -> String:
	return ProjectSettings.globalize_path(_path)

func rows() -> int:
	return _rows

## ev: "death" | "restart" | "tick" | "run" | "note"
## restart 행의 gap_w 칼럼에는 사망 → 다음 입력 간격(벽시계 틱)이 들어간다 — 지표 ③.
func write(ev: String, fields: Array) -> void:
	if _f == null:
		return
	var parts := PackedStringArray()
	parts.append(ev)
	for v in fields:
		if v is float:
			parts.append("%.2f" % v)
		elif v is bool:
			parts.append("1" if v else "0")
		else:
			parts.append(str(v))
	# 칼럼 수를 헤더에 맞춘다 — detail 을 안 쓰는 행도 칼럼이 어긋나지 않게.
	while parts.size() < _cols:
		parts.append("")
	_f.store_line(",".join(parts))
	_rows += 1
	# 크래시·강제종료로 마지막 런이 통째로 사라지는 것이 최악이므로 사망마다 flush.
	if ev != "tick":
		_f.flush()

func flush() -> void:
	if _f != null:
		_f.flush()
