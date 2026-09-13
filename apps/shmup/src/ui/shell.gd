class_name Shell
extends Node2D
## 화면 셸 — 타이틀 · 난이도 · 일시정지 · 결과 · 관측 기록 · 연습 · 설정.
## 게임 화면과 사망 교재는 main.gd 가 그린다. 합쳐서 설계서 §7 의 화면 9개다.
##
## **Control 을 쓰지 않는다.** 전부 Node2D._draw 다 — 설계서가 지목한 mouse_filter 함정이
## 원천적으로 생기지 않고, 절차적 도형 방침(이미지 애셋 0개)과도 일치한다.
## 그래서 "MOUSE_FILTER_IGNORE 강제 헬퍼" 는 만들지 않는다. 없는 문제를 위한 도구다.
##
## 텍스트는 최소한만 쓴다. 숫자·패턴 ID(P01…P16)·난이도 이름은 전부 ASCII 라
## 한글 서브셋 폰트가 필요 없다 — "이미지 애셋 0개" 가 유지된다.
## 설명이 필요한 자리는 **그림으로** 말한다(점등된 칸 수, 막대, 링).

enum Screen { PLAY, TITLE, DIFF, PAUSE, RESULT, LOG, PRACTICE, SETTINGS, PILOT, TALK }

const BTN_H := 96.0
const BTN_GAP := 14.0
const COL_BG := Color(0.03, 0.05, 0.07, 0.92)
const COL_FG := Color(0.80, 0.95, 0.95, 1.0)
const COL_DIM := Color(0.30, 0.45, 0.50, 1.0)
const COL_ACC := Color(0.35, 0.90, 0.85, 1.0)
const COL_LOCK := Color(0.22, 0.26, 0.30, 1.0)

var main: Node = null
var screen: int = Screen.TITLE
var vh: float = Tune.PF_H
var view_w: float = Tune.PF_W
## 결과 화면이 보여줄 것. main 이 채운다.
var result_score: int = 0
var result_cleared: bool = false
var result_zone: int = 0
## 연습 모드로 고른 구역(-1 = 전체). main 이 읽는다.
var practice_zone: int = -1
## 대사 — main 이 보스 등장에서 채우고 셸이 한 줄씩 넘긴다.
var talk_script: Array = []
var talk_line: int = 0
var talk_opponent: int = 2       ## 초상화 인덱스 (2 = 테르사, 3 = 코로나)

var _btns: Array = []            ## [Rect2, id] — _draw 가 채우고 입력이 읽는다
## 누르고 있는 손가락 → 버튼 id. **index 별로 든다.**
## 단일 슬롯이면 두 번째 손가락이 화면 아무 데나 닿는 순간(팜 접촉 포함)
## 첫 손가락의 대기 중인 탭이 조용히 취소된다 — 실기에서 흔한 상황이다.
var _pressed: Dictionary = {}
## 트리 밖(불변식·흐름 테스트)에서 히트박스만 계산할 때 켠다. draw_* 는 _draw() 밖에서
## 부르면 엔진이 에러를 쏟고, 그 에러가 로그를 덮어 **진짜 에러를 못 보게 한다.**
var dry: bool = false

## 그리지 않고 버튼 배치만 구한다. 검사기가 쓰는 단일 진입점이다.
func layout() -> void:
	dry = true
	_draw()
	dry = false

func playing() -> bool:
	return screen == Screen.PLAY

## ── 입력 ────────────────────────────────────────────────────────────────
## 화면이 떠 있는 동안 **모든** 터치를 소비한다. 흘려보내면 뒤의 게임이 조작된다.
func handle(event: InputEvent) -> bool:
	if screen == Screen.PLAY:
		return false
	if event is InputEventScreenTouch:
		var t := event as InputEventScreenTouch
		if t.pressed:
			var hit := _hit(t.position)
			if hit != -1:
				_pressed[t.index] = hit
		else:
			var up := _hit(t.position)
			if _pressed.has(t.index) and up >= 0 and up == int(_pressed[t.index]):
				_pressed.erase(t.index)
				_activate(up)
			else:
				_pressed.erase(t.index)
		queue_redraw()
		return true
	if event is InputEventScreenDrag:
		return true
	if event is InputEventKey:
		var k := event as InputEventKey
		if k.pressed and not k.echo and (k.keycode == KEY_ENTER or k.keycode == KEY_SPACE):
			if not _btns.is_empty():
				_activate(int(_btns[0][1]))
			return true
		if k.pressed and not k.echo and k.keycode == KEY_ESCAPE:
			_activate(-2)
			return true
	if event is InputEventMouseButton or event is InputEventMouseMotion:
		return true            # 마우스도 흘리지 않는다 — 뒤의 게임이 조작된다
	return false

func _hit(p: Vector2) -> int:
	for b in _btns:
		if (b[0] as Rect2).has_point(p):
			return int(b[1])
	return -1

## 버튼 id 규약: 0 이상 = 화면별 의미, -2 = 뒤로.
func _activate(id: int) -> void:
	match screen:
		Screen.PILOT:
			if id == -2:
				_go(Screen.TITLE)
			elif id >= 0 and id < Cast.PILOT_N:
				Cast.pilot = id
				_go(Screen.DIFF)
		Screen.TALK:
			# 대사는 어디를 눌러도 넘어간다. 읽는 속도는 사람마다 다르고,
			# 5분 런 중간이라 "다음" 버튼을 찾게 만들면 안 된다.
			talk_line += 1
			if talk_line >= talk_script.size():
				_go(Screen.PLAY)
		Screen.TITLE:
			match id:
				0: _go(Screen.PILOT)
				1: _go(Screen.LOG)
				2: _go(Screen.SETTINGS)
		Screen.DIFF:
			if id == -2:
				_go(Screen.PILOT)
			elif SaveData.unlocked(id):
				Difficulty.apply(id)
				practice_zone = -1
				_start()
		Screen.LOG:
			if id == -2:
				_go(Screen.TITLE)
			elif id >= 0 and SaveData.seen(id):
				_go(Screen.PRACTICE)
		Screen.PRACTICE:
			if id == -2:
				_go(Screen.LOG)
			else:
				practice_zone = id
				_start()
		Screen.SETTINGS:
			match id:
				0:
					SaveData.sound_on = not SaveData.sound_on
					SaveData._dirty = true
					Audio.set_enabled(SaveData.sound_on)
				1:
					SaveData.haptics_on = not SaveData.haptics_on
					SaveData._dirty = true
				-2: _go(Screen.TITLE)
		Screen.PAUSE:
			match id:
				0: _go(Screen.PLAY)          # 이어 하기
				1: _start()                  # 처음부터
				2: _go(Screen.TITLE)
				-2: _go(Screen.PLAY)
		Screen.RESULT:
			match id:
				0: _start()
				1: _go(Screen.TITLE)
				-2: _go(Screen.TITLE)
	# **동작 뒤에** 저장한다. 앞에 두면 이번 동작의 변경분(설정 토글 등)이 빠져
	# 항상 한 동작 늦게 저장되고, 마지막 토글은 영영 저장되지 않는다.
	SaveData.save_now()
	queue_redraw()

## 화면을 바꾼다. **경계에서 모든 소유자가 손가락을 놓는다.**
##
## 셸은 떠 있는 동안 모든 터치를 소비하는데, 그중에는 셸이 뜨기 전에 TouchRouter 나
## main._band_idx 가 press 를 가져간 손가락의 release 가 섞인다. 그 release 를 못 본
## 소유자에게는 유령이 남고, TouchRouter 는 유령 index 에 드래그 역할을 묶은 채
## 다음 런 내내 기체를 못 움직인다(반증 패스에서 5개 렌즈가 독립적으로 잡았다).
##
## CLAUDE.md 의 "이벤트를 소비하면 그 손가락의 **전부**를 소비해야 한다" 의 다른 얼굴이다.
## 여기서는 반대로 — 내가 전부 소비할 것이므로, 남이 들고 있던 것을 먼저 놓게 한다.
## clear_touches() 는 포커스 아웃·일시정지 알림에서 이미 같은 이유로 쓰는 함수다.
func _go(s: int) -> void:
	var was_play := screen == Screen.PLAY
	screen = s
	_btns.clear()
	_pressed.clear()
	if was_play != (s == Screen.PLAY):
		TouchRouter.clear_touches()
		if main != null:
			main.drop_band_touches()
	queue_redraw()

func _start() -> void:
	screen = Screen.PLAY
	_btns.clear()
	if main != null:
		main.begin_run()
	queue_redraw()

## ── 그리기 ──────────────────────────────────────────────────────────────
func _draw() -> void:
	if screen == Screen.PLAY:
		return
	_btns.clear()
	if not dry:
		draw_rect(Rect2(0.0, 0.0, view_w, vh), COL_BG)
	match screen:
		Screen.TITLE: _draw_title()
		Screen.DIFF: _draw_diff()
		Screen.PILOT: _draw_pilot()
		Screen.TALK: _draw_talk()
		Screen.LOG: _draw_log()
		Screen.PRACTICE: _draw_practice()
		Screen.SETTINGS: _draw_settings()
		Screen.PAUSE: _draw_pause()
		Screen.RESULT: _draw_result()

func _f() -> Font:
	return ThemeDB.fallback_font

## 공용 버튼. 라벨은 ASCII 만 쓴다.
func _btn(y: float, label: String, id: int, enabled := true) -> float:
	var r := Rect2(40.0, y, view_w - 80.0, BTN_H)
	_btns.append([r, id])
	var col := COL_FG if enabled else COL_LOCK
	if enabled and _pressed.values().has(id):
		if not dry:
			draw_rect(r, Color(col.r, col.g, col.b, 0.14))
	if not dry:
		draw_rect(r, col, false, 2.0)
	if not dry:
		draw_string(_f(), Vector2(r.position.x + 24.0, y + BTN_H * 0.5 + 9.0), label,
			HORIZONTAL_ALIGNMENT_LEFT, -1, 28, col)
	return y + BTN_H + BTN_GAP

## 타이틀의 본문은 텍스트가 아니라 **16칸 중 몇 칸이 점등됐는가** 다(설계서 §7).
func _draw_title() -> void:
	# 비율(vh * 0.33)로 배치하면 화면비가 바뀔 때마다 무엇인가가 무엇인가를 덮는다 —
	# 실측으로 두 번 겹쳤다(격자가 버튼을, 그 다음 격자가 제목을).
	# **위에서 아래로 쌓고 버튼만 바닥에 앵커한다.** 그 사이 여백이 화면비 차이를 흡수한다.
	var cx := view_w * 0.5
	_draw_mark(Vector2(cx, 262.0), 80.0)
	var title := "LUMEN DRIFT"
	var tw := _f().get_string_size(title, HORIZONTAL_ALIGNMENT_LEFT, -1, 34).x
	if not dry:
		draw_string(_f(), Vector2(cx - tw * 0.5, 404.0), title,
			HORIZONTAL_ALIGNMENT_LEFT, -1, 34, COL_ACC)
	var gw: float = minf(268.0, view_w - 160.0)
	_draw_log_grid(Vector2(cx - gw * 0.5, 436.0), gw, false)
	var stack := BTN_H * 3.0 + BTN_GAP * 2.0
	var y: float = maxf(436.0 + gw + 40.0, vh - 60.0 - stack)
	y = _btn(y, "PLAY", 0)
	y = _btn(y, "LOG   %d / %d" % [SaveData.seen_count(), Patterns.BOOK.size()], 1)
	y = _btn(y, "SETTINGS", 2)

## 타이틀 표식 — 링 3겹. 보스의 몸과 같은 형태다(이 게임이 무엇인지 그림으로 말한다).
func _draw_mark(c: Vector2, r: float) -> void:
	for i in 3:
		var rr := r * (1.0 - 0.26 * float(i))
		var col := Color(COL_ACC.r, COL_ACC.g, COL_ACC.b, 0.35 + 0.25 * float(i))
		if not dry:
			draw_arc(c, rr, 0.0, TAU, 48, col, 2.0, true)
	if not dry:
		draw_circle(c, r * 0.24, Color(0.02, 0.04, 0.06, 1.0))

func _draw_diff() -> void:
	if not dry:
		draw_string(_f(), Vector2(44.0, 120.0), "DIFFICULTY", HORIZONTAL_ALIGNMENT_LEFT, -1, 30, COL_ACC)
	var y := 180.0
	for lv in [Difficulty.Level.NORMAL, Difficulty.Level.HARD]:
		var ok := SaveData.unlocked(lv)
		var label := "%s   best %d" % [Difficulty.NAMES[lv], SaveData.best[lv]]
		if not ok:
			label = "%s   [ clear Normal ]" % Difficulty.NAMES[lv]
		y = _btn(y, label, lv, ok)
		# 난이도 축을 숫자가 아니라 막대로 보인다 — 무엇이 바뀌는지가 보여야 한다.
		# 버튼 **아래**에 둔다. 버튼 안에 그리면 테두리를 덮고 라벨이 잘린다.
		_draw_axis_bars(Vector2(64.0, y + 6.0), lv)
		y += 64.0
	_btn(vh - 150.0, "BACK", -2)

## 그 축의 4단 범위 안에서 이 난이도가 어디인가. invert 면 값이 작을수록 어렵다.
static func _norm(table: Array, lv: int, invert: bool) -> float:
	var lo := INF
	var hi := -INF
	for v in table:
		lo = minf(lo, float(v))
		hi = maxf(hi, float(v))
	if hi - lo < 0.0001:
		return 0.5
	var t := (float(table[lv]) - lo) / (hi - lo)
	return 1.0 - t if invert else t

## 조류 유속 · 주기 · 탄 수 · 통과 폭 네 축을 막대로.
func _draw_axis_bars(p: Vector2, lv: int) -> void:
	# **축별로 정규화한다.** 절대 스케일로 그리면 Normal 과 Hard 의 차이가 막대 몇 픽셀이
	# 되어 "무엇이 바뀌는가" 를 못 보여준다 — 이 화면의 존재 이유가 사라진다.
	var axes := [
		["flow", _norm(Difficulty.U_MAX, lv, false)],
		["rate", _norm(Difficulty.RATE_M, lv, true)],
		["bullets", _norm(Difficulty.COUNT_M, lv, false)],
		["gap", _norm(Difficulty.PASS_D, lv, true)],
	]
	var x := p.x
	for a in axes:
		var w := 120.0
		if not dry:
			draw_rect(Rect2(x, p.y, w, 6.0), COL_LOCK)
		if not dry:
			draw_rect(Rect2(x, p.y, w * clampf(float(a[1]), 0.08, 1.0), 6.0), COL_ACC)
		if not dry:
			draw_string(_f(), Vector2(x, p.y + 26.0), String(a[0]),
				HORIZONTAL_ALIGNMENT_LEFT, -1, 15, COL_LOCK)
		x += w + 18.0

## 관측 기록 — 16칸. 어두운 칸이 남은 어휘다.
func _draw_log() -> void:
	if not dry:
		draw_string(_f(), Vector2(44.0, 120.0), "OBSERVATION   %d / %d" % [
			SaveData.seen_count(), Patterns.BOOK.size()],
			HORIZONTAL_ALIGNMENT_LEFT, -1, 30, COL_ACC)
	_draw_log_grid(Vector2(44.0, 170.0), view_w - 88.0, true)
	if not dry:
		draw_string(_f(), Vector2(44.0, vh - 200.0), "tap a lit cell to practice",
			HORIZONTAL_ALIGNMENT_LEFT, -1, 18, COL_LOCK)
	_btn(vh - 150.0, "BACK", -2)

func _draw_log_grid(p: Vector2, w: float, tappable: bool) -> void:
	var cols := 4
	var cell := w / float(cols)
	for i in Patterns.BOOK.size():
		var r := Rect2(p.x + cell * float(i % cols) + 4.0,
				p.y + cell * float(i / cols) + 4.0, cell - 8.0, cell - 8.0)
		var lit := SaveData.seen(i)
		if not dry:
			draw_rect(r, COL_ACC if lit else COL_LOCK, false, 2.0)
		if lit:
			if not dry:
				draw_rect(r, Color(COL_ACC.r, COL_ACC.g, COL_ACC.b, 0.10))
		var id: String = String(Patterns.BOOK[i]["id"])
		if not dry:
			draw_string(_f(), r.position + Vector2(10.0, r.size.y * 0.5 + 8.0), id,
				HORIZONTAL_ALIGNMENT_LEFT, -1, 22, COL_ACC if lit else COL_LOCK)
		if tappable and lit:
			_btns.append([r, i])

## 연습 — 구역 단위다. 구역이 곧 무피격 보너스 단위이자 연습 진입 단위다(설계서 §7).
func _draw_practice() -> void:
	if not dry:
		draw_string(_f(), Vector2(44.0, 120.0), "PRACTICE", HORIZONTAL_ALIGNMENT_LEFT, -1, 30, COL_ACC)
	var y := 180.0
	for z in Stage.ZONES.size():
		var clean := SaveData.zone_clean(z)
		y = _btn(y, "ZONE %d   %s" % [z + 1, "CLEAN" if clean else "-"], z)
	_btn(vh - 150.0, "BACK", -2)

func _draw_settings() -> void:
	if not dry:
		draw_string(_f(), Vector2(44.0, 120.0), "SETTINGS", HORIZONTAL_ALIGNMENT_LEFT, -1, 30, COL_ACC)
	var y := 180.0
	y = _btn(y, "SOUND     %s" % ("ON" if SaveData.sound_on else "OFF"), 0)
	y = _btn(y, "HAPTICS   %s" % ("ON" if SaveData.haptics_on else "OFF"), 1)
	if not dry:
		draw_string(_f(), Vector2(44.0, y + 40.0),
			"sound off is a supported way to play", HORIZONTAL_ALIGNMENT_LEFT, -1, 18, COL_LOCK)
	_btn(vh - 150.0, "BACK", -2)

func _draw_pause() -> void:
	if not dry:
		draw_string(_f(), Vector2(44.0, 140.0), "PAUSED", HORIZONTAL_ALIGNMENT_LEFT, -1, 34, COL_ACC)
	var y := 220.0
	y = _btn(y, "RESUME", 0)
	y = _btn(y, "RESTART", 1)
	y = _btn(y, "TITLE", 2)

func _draw_result() -> void:
	if not dry:
		draw_string(_f(), Vector2(44.0, 140.0), "CLEAR" if result_cleared else "RUN OVER",
			HORIZONTAL_ALIGNMENT_LEFT, -1, 34, COL_ACC if result_cleared else COL_FG)
	if not dry:
		draw_string(_f(), Vector2(44.0, 200.0), "SCORE   %d" % result_score,
			HORIZONTAL_ALIGNMENT_LEFT, -1, 28, COL_FG)
	if not dry:
		draw_string(_f(), Vector2(44.0, 244.0), "BEST    %d" % SaveData.best[Difficulty.level],
			HORIZONTAL_ALIGNMENT_LEFT, -1, 24, COL_DIM)
	if not dry:
		draw_string(_f(), Vector2(44.0, 296.0), "REACHED ZONE %d" % (result_zone + 1),
			HORIZONTAL_ALIGNMENT_LEFT, -1, 24, COL_DIM)
	# 버튼을 먼저 바닥에 앵커하고, 격자는 **남은 공간에 맞춰** 그린다.
	# 폭에서만 역산하면 화면이 넓을수록 격자가 길어져 버튼을 덮는다
	# (889×1280 태블릿에서 141px 겹쳤다 — 불변식은 격자가 버튼이 아니라서 못 봤다).
	var stack := BTN_H * 2.0 + BTN_GAP
	var by: float = vh - 60.0 - stack
	var top := 340.0
	var gw: float = minf(view_w - 88.0, (by - 30.0 - top))
	_draw_log_grid(Vector2(44.0, top), gw, false)
	var y := by
	y = _btn(y, "AGAIN", 0)
	y = _btn(y, "TITLE", 1)


## 조종사 선택 — 두 사람의 차이를 **문장 하나와 그림**으로 보인다.
## 숫자(대미지 0.95/1.10)를 보이지 않는 이유: 그 숫자를 비교하면 "더 센 쪽" 을 고르게 되는데
## 이 둘은 세기가 아니라 조준 방식이 다르다. 차이는 사격 폭 그림으로 말한다.
func _draw_pilot() -> void:
	if not dry:
		draw_string(_f(), Vector2(44.0, 120.0), "PILOT", HORIZONTAL_ALIGNMENT_LEFT, -1, 30, COL_ACC)
	var y := 180.0
	for i in Cast.PILOT_N:
		var r := Rect2(40.0, y, view_w - 80.0, 180.0)
		_btns.append([r, i])
		var sel := Cast.pilot == i
		if not dry:
			draw_rect(r, COL_ACC if sel else COL_FG, false, 2.0)
			Portraits.draw_into(self, i, Rect2(r.position + Vector2(14.0, 14.0), Vector2(152.0, 152.0)))
			draw_string(_f(), r.position + Vector2(186.0, 52.0), Cast.NAMES[i],
					HORIZONTAL_ALIGNMENT_LEFT, -1, 30, COL_ACC if sel else COL_FG)
			draw_string(_f(), r.position + Vector2(186.0, 92.0), Cast.TAGLINE[i],
					HORIZONTAL_ALIGNMENT_LEFT, -1, 17, COL_DIM)
			# 사격 폭을 그대로 그린다 — 이것이 두 사람의 진짜 차이다.
			var sx := r.position.x + 186.0
			var sy := r.position.y + 132.0
			for s2 in [-Cast.COL_HALF[i], Cast.COL_HALF[i]]:
				draw_line(Vector2(sx + 60.0 + s2, sy + 26.0), Vector2(sx + 60.0 + s2, sy),
						COL_ACC if sel else COL_DIM, 3.0)
			draw_arc(Vector2(sx + 60.0, sy + 34.0), Cast.PICKUP_MULT[i] * 12.0, 0.0, TAU, 20,
					COL_DIM, 1.5, true)
		y += 196.0
	_btn(vh - 150.0, "BACK", -2)

## 전투 전 대사. 초상화 + 이름 + 한 줄.
func _draw_talk() -> void:
	if talk_line >= talk_script.size():
		return
	var line: Array = talk_script[talk_line]
	var speaker := int(line[0])
	var who: int = Cast.portrait_of(speaker, talk_opponent)
	var name_: String = Cast.NAMES[Cast.pilot] if speaker < 0 else (
			Cast.MID_NAME if talk_opponent == 2 else Cast.BOSS_NAME)
	# 화면 전체가 탭 대상이다 — 어디를 눌러도 넘어간다.
	_btns.append([Rect2(0.0, 0.0, view_w, vh), 0])
	if dry:
		return
	var box := Rect2(30.0, vh - 340.0, view_w - 60.0, 260.0)
	Portraits.draw_into(self, who, Rect2(Vector2(view_w * 0.5 - 130.0, box.position.y - 250.0),
			Vector2(260.0, 260.0)))
	draw_rect(box, Color(0.03, 0.06, 0.08, 0.94))
	draw_rect(box, COL_ACC, false, 2.0)
	draw_string(_f(), box.position + Vector2(22.0, 42.0), name_,
			HORIZONTAL_ALIGNMENT_LEFT, -1, 24, COL_ACC)
	draw_multiline_string(_f(), box.position + Vector2(22.0, 92.0), String(line[1]),
			HORIZONTAL_ALIGNMENT_LEFT, box.size.x - 44.0, 22, 4, COL_FG)
	draw_string(_f(), box.position + Vector2(box.size.x - 40.0, box.size.y - 18.0), ">",
			HORIZONTAL_ALIGNMENT_LEFT, -1, 22, COL_DIM)
