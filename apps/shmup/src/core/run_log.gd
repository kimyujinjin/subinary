extends Node
## 실기 release 빌드에는 에디터의 remote debug 콘솔이 없고 화면 HUD 숫자는 5분 동안
## 흘러가 버린다. "실기에서 판정한다"는 규칙과 "실기의 숫자를 볼 방법이 없다"는 현실이
## 충돌하면 결국 에디터에서 판정하게 되어 잘못된 결론에 도달한다 — 그래서 CSV 를 남긴다.
##
## user:// 전용. /v1/play/* API 를 쓰지 않는다 (완전 독립 유지).
## iOS 에서 user:// 는 Documents 에 매핑되어 iCloud 백업 대상이 되므로
## 계측 CSV 는 백업 제외 대상임을 export 단계에서 명시한다.

const PATH := "user://runlog.csv"
## 마지막 detail 칼럼은 key=value;key=value 자유 형식이다 — 새 계측을 넣을 때마다
## 헤더를 바꾸지 않기 위해서다. 헤더가 바뀌면 기존 파일을 옆으로 치우고 새로 쓴다.
const HEADER := "ev,run,tick,seed,x,y,kind,bid,gap_x0,gap_w,k,focus,regrip,since_regrip,flow_c,flow_u,bullets,fps,build,ppu,mm,detail"

var _f: FileAccess = null
var _cols: int = HEADER.split(",").size()
var _rows: int = 0

func _ready() -> void:
	_rotate_if_stale()
	var exists := FileAccess.file_exists(PATH)
	_f = FileAccess.open(PATH, FileAccess.READ_WRITE if exists else FileAccess.WRITE)
	if _f == null:
		push_warning("RunLog: %s 를 열 수 없다 (err %d)" % [PATH, FileAccess.get_open_error()])
		return
	if exists:
		_f.seek_end()
	else:
		_f.store_line(HEADER)
	_f.flush()

## 헤더가 다른 기존 파일에 이어 쓰면 칼럼이 어긋나 판정이 조용히 틀린다.
## 지우지 않고 옆으로 치운다(설계: 손상 파일은 버리지 말고 .bak 로).
func _rotate_if_stale() -> void:
	if not FileAccess.file_exists(PATH):
		return
	var f := FileAccess.open(PATH, FileAccess.READ)
	if f == null:
		return
	var first := f.get_line()
	f.close()
	if first == HEADER:
		return
	var dst := "user://runlog-%d.old.csv" % int(Time.get_unix_time_from_system())
	DirAccess.rename_absolute(ProjectSettings.globalize_path(PATH), ProjectSettings.globalize_path(dst))

func path_abs() -> String:
	return ProjectSettings.globalize_path(PATH)

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
