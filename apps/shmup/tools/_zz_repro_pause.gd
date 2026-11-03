extends Node
## 재현: PLAY 중 어떤 입력으로도 Shell.Screen.PAUSE 에 닿는가.
## 실제 입력 경로(Viewport.push_input) + 시스템 알림으로 훑는다.

var _fail := 0
var _m: Main = null
var _sh: Shell = null

func _note(s: String) -> void:
	print("  " + s)

func _touch(idx: int, p: Vector2, pressed: bool) -> void:
	var e := InputEventScreenTouch.new()
	e.index = idx; e.position = p; e.pressed = pressed
	get_viewport().push_input(e, true)

func _key(code: int) -> void:
	var d := InputEventKey.new()
	d.keycode = code; d.physical_keycode = code; d.pressed = true
	get_viewport().push_input(d, true)
	var u := InputEventKey.new()
	u.keycode = code; u.physical_keycode = code; u.pressed = false
	get_viewport().push_input(u, true)

func _tap(p: Vector2) -> void:
	_touch(0, p, true)
	_touch(0, p, false)

func _btn_rect(id: int) -> Rect2:
	_sh._btns.clear()
	_sh._draw()
	for b in _sh._btns:
		if int(b[1]) == id:
			return b[0] as Rect2
	return Rect2()

func _ready() -> void:
	SaveData.reset_for_test("user://save-pauserepro.json")
	await get_tree().process_frame
	_m = load("res://src/main.gd").new()
	_m.stage_full = true
	add_child(_m)
	await get_tree().process_frame
	_sh = _m._shell
	_sh.screen = Shell.Screen.TITLE
	_note("앱 기동 상태로 되돌림: screen=%d (TITLE=%d)" % [_sh.screen, Shell.Screen.TITLE])

	# ① 타이틀의 PLAY 버튼을 **실제 터치로** 누른다
	var r := _btn_rect(0)
	_tap(r.get_center())
	await get_tree().process_frame
	_note("PLAY 탭 → screen=%d (DIFF=%d)" % [_sh.screen, Shell.Screen.DIFF])

	# ② NORMAL 을 실제 터치로 누른다 → 런 시작
	r = _btn_rect(Difficulty.Level.NORMAL)
	_tap(r.get_center())
	await get_tree().process_frame
	_note("NORMAL 탭 → screen=%d (PLAY=%d)" % [_sh.screen, Shell.Screen.PLAY])
	for i in 60:
		await get_tree().physics_frame
	_note("런 진행 중: sim_tick=%d wall=%d" % [SimClock.sim_tick, SimClock.wall_tick])

	# ③ 이제 "멈추고 싶다" 를 표현할 수 있는 모든 입력을 넣는다.
	var tried := 0
	var reached := false

	var keys := [KEY_ESCAPE, KEY_P, KEY_ENTER, KEY_SPACE, KEY_TAB, KEY_BACKSPACE,
			KEY_MENU, KEY_F1, KEY_M, KEY_Q]
	for k in keys:
		_key(int(k))
		await get_tree().physics_frame
		tried += 1
		if _sh.screen == Shell.Screen.PAUSE:
			reached = true
			_note("!! 키 %d 로 PAUSE 도달" % int(k))

	# 화면 각처 탭 (최상단 띠는 3연타가 장면 전환이므로 2회까지만)
	var pts := [Vector2(360.0, 30.0), Vector2(360.0, 30.0),
			Vector2(360.0, 400.0), Vector2(360.0, 900.0), Vector2(40.0, 1240.0),
			Vector2(700.0, 1240.0), Vector2(360.0, 1270.0), Vector2(10.0, 10.0),
			Vector2(710.0, 10.0)]
	for p in pts:
		_tap(p)
		for i in 3:
			await get_tree().physics_frame
		tried += 1
		if _sh.screen == Shell.Screen.PAUSE:
			reached = true
			_note("!! 탭 %s 로 PAUSE 도달" % str(p))
		# 띠 연타 카운터를 식힌다 (30 wall tick)
		for i in 40:
			await get_tree().physics_frame

	# 두 손가락 동시 탭 · 길게 누르기
	_touch(0, Vector2(200.0, 1240.0), true)
	_touch(1, Vector2(520.0, 1240.0), true)
	for i in 60:
		await get_tree().physics_frame
	_touch(0, Vector2(200.0, 1240.0), false)
	_touch(1, Vector2(520.0, 1240.0), false)
	await get_tree().physics_frame
	tried += 2
	if _sh.screen == Shell.Screen.PAUSE:
		reached = true
		_note("!! 두 손가락/롱프레스로 PAUSE 도달")

	# 안드로이드 백 버튼 · 포커스 아웃 · 앱 일시정지 알림
	for what in [NOTIFICATION_WM_GO_BACK_REQUEST, NOTIFICATION_APPLICATION_FOCUS_OUT,
			NOTIFICATION_APPLICATION_PAUSED]:
		get_tree().root.propagate_notification(int(what))
		await get_tree().physics_frame
		tried += 1
		_note("알림 %d 후 screen=%d · sim_tick=%d" % [int(what), _sh.screen, SimClock.sim_tick])
		if _sh.screen == Shell.Screen.PAUSE:
			reached = true
			_note("!! 알림 %d 로 PAUSE 도달" % int(what))

	# ④ 백그라운드로 갔다 와도 시뮬이 계속 도는가 (= 멈춤이 없다)
	var t0 := SimClock.sim_tick
	for i in 30:
		await get_tree().physics_frame
	_note("포커스 아웃 뒤에도 시뮬 진행: %d → %d" % [t0, SimClock.sim_tick])

	print("== 시도 %d 건 · PAUSE 도달 %s ==" % [tried, "예" if reached else "아니오"])
	_fail = 0 if reached else 1
	_m.queue_free()
	await get_tree().process_frame
	Audio.teardown()
	await get_tree().process_frame
	get_tree().quit(_fail)
