extends Node
## 재현(독립): 실기와 같은 입력 경로만 써서 PLAY 중 Shell.Screen.PAUSE 에 닿는가.
## 모든 입력은 Viewport.push_input 으로 넣는다 — 내부 상태를 손으로 세우지 않는다.

var _m: Node = null
var _sh: Shell = null
var _reached := false
var _tried := 0

func _p(s: String) -> void:
	print("  " + s)

func _touch(idx: int, p: Vector2, pressed: bool) -> void:
	var e := InputEventScreenTouch.new()
	e.index = idx
	e.position = p
	e.pressed = pressed
	get_viewport().push_input(e, true)

func _drag(idx: int, p: Vector2, rel: Vector2) -> void:
	var e := InputEventScreenDrag.new()
	e.index = idx
	e.position = p
	e.relative = rel
	get_viewport().push_input(e, true)

func _key(code: int) -> void:
	var d := InputEventKey.new()
	d.keycode = code
	d.physical_keycode = code
	d.pressed = true
	get_viewport().push_input(d, true)
	var u := InputEventKey.new()
	u.keycode = code
	u.physical_keycode = code
	u.pressed = false
	get_viewport().push_input(u, true)

func _frames(n: int) -> void:
	for i in n:
		await get_tree().physics_frame

func _btn_rect(id: int) -> Rect2:
	_sh._btns.clear()
	_sh._draw()
	for b in _sh._btns:
		if int(b[1]) == id:
			return b[0] as Rect2
	return Rect2()

func _check(tag: String) -> void:
	_tried += 1
	if _sh.screen == Shell.Screen.PAUSE:
		_reached = true
		_p("!! PAUSE 도달: %s" % tag)

func _ready() -> void:
	SaveData.reset_for_test("user://save-zzr-pause.json")
	await get_tree().process_frame
	_m = load("res://scenes/stage_full.tscn").instantiate()
	add_child(_m)
	await get_tree().process_frame
	_sh = _m._shell
	# 헤드리스라 main 이 타이틀을 건너뛴다. 실기 기동 상태(타이틀)로 되돌린다.
	_sh.screen = Shell.Screen.TITLE
	_sh.queue_redraw()
	_p("기동: screen=%d (TITLE=%d)" % [_sh.screen, Shell.Screen.TITLE])

	# ① 타이틀 PLAY 를 진짜 터치로
	var r := _btn_rect(0)
	_touch(0, r.get_center(), true)
	_touch(0, r.get_center(), false)
	await get_tree().process_frame
	_p("PLAY 탭 → screen=%d (DIFF=%d)" % [_sh.screen, Shell.Screen.DIFF])

	# ② NORMAL 을 진짜 터치로 → 런 시작
	r = _btn_rect(Difficulty.Level.NORMAL)
	_touch(0, r.get_center(), true)
	_touch(0, r.get_center(), false)
	await get_tree().process_frame
	_p("NORMAL 탭 → screen=%d (PLAY=%d)" % [_sh.screen, Shell.Screen.PLAY])
	if _sh.screen != Shell.Screen.PLAY:
		_p("!! 런 시작 실패 — 재현 무효")
		get_tree().quit(2)
		return
	# 스윕 도중 죽어서 결과 화면으로 새지 않게 무적을 켠다(캡처 경로와 같은 손잡이).
	_m._cap_invincible = true
	await _frames(120)
	_p("런 진행 중: sim_tick=%d wall=%d state=%d" % [
		SimClock.sim_tick, SimClock.wall_tick, SimClock.state])

	# ③ 키 전수(“멈춤”을 표현할 만한 것 + 알파벳/숫자/기능키). KEY_B 는 장면 전환이라 제외.
	var keys: Array = [KEY_ESCAPE, KEY_PAUSE, KEY_MENU, KEY_BACK, KEY_HELP, KEY_TAB,
		KEY_BACKSPACE, KEY_ENTER, KEY_KP_ENTER, KEY_SPACE, KEY_INSERT, KEY_DELETE,
		KEY_HOME, KEY_END, KEY_PAGEUP, KEY_PAGEDOWN, KEY_LEFT, KEY_RIGHT, KEY_UP, KEY_DOWN,
		KEY_PRINT, KEY_CLEAR, KEY_STOP, KEY_REFRESH, KEY_SEARCH, KEY_VOLUMEDOWN]
	for f in 12:
		keys.append(KEY_F1 + f)
	for c in 26:
		var kc: int = KEY_A + c
		if kc != KEY_B:
			keys.append(kc)
	for d in 10:
		keys.append(KEY_0 + d)
	for k in keys:
		_key(int(k))
		await _frames(2)
		_check("키 %d" % int(k))
	_p("키 %d 종 시도 완료 · screen=%d" % [keys.size(), _sh.screen])

	# ④ 화면 전면 탭 격자 (상단 띠 y<64 는 3연타가 장면 전환이라 간격을 벌린다)
	var vh: float = get_viewport().get_visible_rect().size.y
	var vw: float = get_viewport().get_visible_rect().size.x
	for gy in 12:
		for gx in 6:
			var p := Vector2(vw * (float(gx) + 0.5) / 6.0, vh * (float(gy) + 0.5) / 12.0)
			_touch(0, p, true)
			await _frames(4)
			_touch(0, p, false)
			await _frames(40)   # 띠 연타 카운터(30 wall tick) 식히기
			_check("탭 %s" % str(p))
	_p("탭 격자 72점 완료 · screen=%d" % _sh.screen)

	# ⑤ 롱프레스 · 두 손가락 · 세 손가락 · 상단에서 아래로 스와이프
	_touch(0, Vector2(vw * 0.5, vh * 0.8), true)
	await _frames(180)
	_touch(0, Vector2(vw * 0.5, vh * 0.8), false)
	await _frames(4)
	_check("롱프레스 3초")

	_touch(0, Vector2(vw * 0.3, vh * 0.85), true)
	_touch(1, Vector2(vw * 0.7, vh * 0.85), true)
	await _frames(90)
	_touch(0, Vector2(vw * 0.3, vh * 0.85), false)
	_touch(1, Vector2(vw * 0.7, vh * 0.85), false)
	await _frames(4)
	_check("두 손가락 동시")

	_touch(0, Vector2(vw * 0.2, vh * 0.9), true)
	_touch(1, Vector2(vw * 0.5, vh * 0.9), true)
	_touch(2, Vector2(vw * 0.8, vh * 0.9), true)
	await _frames(60)
	_touch(0, Vector2(vw * 0.2, vh * 0.9), false)
	_touch(1, Vector2(vw * 0.5, vh * 0.9), false)
	_touch(2, Vector2(vw * 0.8, vh * 0.9), false)
	await _frames(4)
	_check("세 손가락 동시")

	_touch(0, Vector2(vw * 0.5, 20.0), true)
	for i in 20:
		_drag(0, Vector2(vw * 0.5, 20.0 + 20.0 * float(i)), Vector2(0.0, 20.0))
		await get_tree().physics_frame
	_touch(0, Vector2(vw * 0.5, 420.0), false)
	await _frames(4)
	_check("상단→아래 스와이프")

	# ⑥ 시스템 알림 (안드로이드 백 버튼 · 포커스 아웃 · 앱 일시정지)
	for what in [NOTIFICATION_WM_GO_BACK_REQUEST, NOTIFICATION_APPLICATION_FOCUS_OUT,
			NOTIFICATION_APPLICATION_PAUSED, NOTIFICATION_WM_WINDOW_FOCUS_OUT]:
		get_tree().root.propagate_notification(int(what))
		await _frames(2)
		_p("알림 %d → screen=%d · sim_tick=%d" % [int(what), _sh.screen, SimClock.sim_tick])
		_check("알림 %d" % int(what))

	# ⑦ 알림 뒤에도 시뮬이 계속 도는가 = 어디에서도 멈추지 않았다
	var t0 := SimClock.sim_tick
	await _frames(30)
	_p("알림 뒤 시뮬 진행: %d → %d" % [t0, SimClock.sim_tick])

	print("== 시도 %d 건 · PAUSE 도달 %s · 최종 screen=%d ==" % [
		_tried, "예" if _reached else "아니오", _sh.screen])
	_m.queue_free()
	await get_tree().process_frame
	Audio.teardown()
	await get_tree().process_frame
	get_tree().quit(0 if _reached else 1)
