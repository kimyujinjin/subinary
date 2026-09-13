class_name SaveData
## 세이브 — 관측 기록 · 최고 점수 · 해금 · 설정. `user://save.json` 한 파일이다.
##
## 오토로드를 쓰지 않는다(4개 상한: SimClock·TouchRouter·BulletField·RunLog).
## Difficulty 와 같은 방식으로 static var 를 쓴다 — 런 시작 전에 로드하고 변할 때만 쓴다.
##
## 진행 보상의 실체는 점수가 아니라 **관측 기록**이다(설계서 §7). 처음 본 패턴은 로그에
## 점등되고, 점등된 패턴은 즉시 연습 루프로 열린다. 16칸 중 어두운 칸이 몇 개인지가
## 첫 화면에 있다 — 그래서 이 파일이 없으면 첫 화면이 성립하지 않는다.

const PATH := "user://save.json"
## 테스트가 실제 세이브를 건드리지 않게 하는 경로 오버라이드.
## 이게 없으면 흐름 테스트가 해금 상태를 남겨서 **다음 실행의 결과가 달라진다** —
## 실제로 "Normal 로 시작" 검사가 이전 실행이 남긴 Hard 해금 때문에 실패했다.
static var path_override: String = ""

static func _path() -> String:
	return path_override if path_override != "" else PATH

## 테스트용 초기화. 파일을 건드리지 않는다.
static func reset_for_test(tmp_path: String) -> void:
	path_override = tmp_path
	# 남은 임시 파일을 먼저 지운다. 안 지우면 main._ready 의 load_now 가 그것을 읽어
	# 직전 실행의 해금 상태가 되살아난다(실측: 두 번째 실행부터 Hard 가 열려 있었다).
	if FileAccess.file_exists(tmp_path):
		DirAccess.remove_absolute(ProjectSettings.globalize_path(tmp_path))
	seen_mask = 0
	best = PackedInt32Array([0, 0, 0, 0])
	cleared_mask = 0
	zone_clean_mask = 0
	sound_on = true
	haptics_on = true
	_dirty = false
const VERSION := 1

## 관측한 패턴 비트마스크(Patterns.BOOK 인덱스).
static var seen_mask: int = 0
## 난이도별 최고 점수.
static var best := PackedInt32Array([0, 0, 0, 0])
## 클리어한 난이도 비트마스크. Hard 는 Normal 클리어로 열린다(설계서: 4칸 중 2칸이 잠겨 있다).
static var cleared_mask: int = 0
## 구역별 무피격 달성 비트마스크(난이도 무관 — 한 번이라도 달성했으면 점등).
static var zone_clean_mask: int = 0
static var sound_on: bool = true
static var haptics_on: bool = true
static var _dirty: bool = false

static func load_now() -> void:
	if not FileAccess.file_exists(_path()):
		return
	var f := FileAccess.open(_path(), FileAccess.READ)
	if f == null:
		return
	var txt := f.get_as_text()
	f.close()
	var d = JSON.parse_string(txt)
	if typeof(d) != TYPE_DICTIONARY:
		# 손상 파일은 버리지 않고 옆으로 치운다(저장소 규칙).
		DirAccess.rename_absolute(ProjectSettings.globalize_path(_path()),
				ProjectSettings.globalize_path("user://save-%d.bad.json" % int(Time.get_unix_time_from_system())))
		return
	seen_mask = int(d.get("seen", 0))
	cleared_mask = int(d.get("cleared", 0))
	zone_clean_mask = int(d.get("zone_clean", 0))
	sound_on = bool(d.get("sound", true))
	haptics_on = bool(d.get("haptics", true))
	var b = d.get("best", [])
	if typeof(b) == TYPE_ARRAY:
		for i in mini(b.size(), best.size()):
			best[i] = int(b[i])

static func save_now() -> void:
	if not _dirty:
		return
	var f := FileAccess.open(_path(), FileAccess.WRITE)
	if f == null:
		push_warning("SaveData: %s 를 쓸 수 없다" % _path())
		return
	f.store_string(JSON.stringify({
		"v": VERSION, "seen": seen_mask, "cleared": cleared_mask,
		"zone_clean": zone_clean_mask, "sound": sound_on, "haptics": haptics_on,
		"best": [best[0], best[1], best[2], best[3]],
	}))
	f.close()
	_dirty = false

## 패턴을 처음 봤다. 매 발사마다 불리므로 **이미 본 것이면 즉시 반환**한다 —
## 여기서 파일을 쓰면 프레임당 디스크 I/O 가 된다. 쓰기는 화면 전환에서만 한다.
static func mark_seen(idx: int) -> void:
	var bit := 1 << idx
	if (seen_mask & bit) != 0:
		return
	seen_mask |= bit
	_dirty = true

static func seen(idx: int) -> bool:
	return (seen_mask & (1 << idx)) != 0

static func seen_count() -> int:
	var c := 0
	for i in Patterns.BOOK.size():
		if seen(i):
			c += 1
	return c

static func mark_zone_clean(z: int) -> void:
	var bit := 1 << z
	if (zone_clean_mask & bit) != 0:
		return
	zone_clean_mask |= bit
	_dirty = true

static func zone_clean(z: int) -> bool:
	return (zone_clean_mask & (1 << z)) != 0

static func mark_cleared(level: int) -> void:
	var bit := 1 << level
	if (cleared_mask & bit) != 0:
		return
	cleared_mask |= bit
	_dirty = true

## 그 난이도를 고를 수 있는가. MVP 출시는 Normal + Hard 2단이고
## Hard 는 Normal 클리어로 열린다. Easy·Lunatic 은 프로파일만 있고 노출하지 않는다.
static func unlocked(level: int) -> bool:
	if level == Difficulty.Level.NORMAL:
		return true
	if level == Difficulty.Level.HARD:
		return (cleared_mask & (1 << Difficulty.Level.NORMAL)) != 0
	return false

static func submit_score(level: int, score: int) -> void:
	if level < 0 or level >= best.size() or score <= best[level]:
		return
	best[level] = score
	_dirty = true
