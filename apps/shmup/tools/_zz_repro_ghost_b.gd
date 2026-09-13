extends Node
## 독립 재현 — 셸이 뜬 뒤의 release 가 TouchRouter 를 건너뛰어 유령이 남는가.
## 메뉴 조작만 _activate 로 하고, 게임 손가락은 전부 실제 InputEvent 로 넣는다.

var _log: Array = []

func _push(e: InputEvent) -> void:
	get_viewport().push_input(e, true)

func _t(idx: int, p: Vector2, pressed: bool) -> void:
	var e := InputEventScreenTouch.new()
	e.index = idx
	e.position = p
	e.pressed = pressed
	_push(e)

func _d(idx: int, p: Vector2, rel: Vector2) -> void:
	var e := InputEventScreenDrag.new()
	e.index = idx
	e.position = p
	e.screen_relative = rel
	_push(e)

func _snap(tag: String) -> void:
	print("  [%s] shell=%d simstate=%d touch=%s drag_idx=%d relay=%d" % [
		tag, _m._shell.screen, SimClock.state,
		str(TouchRouter._touch.keys()), TouchRouter.drag_idx, TouchRouter.relay_count])

var _m: Main = null

func _ready() -> void:
	SaveData.reset_for_test("user://save-ghostb.json")
	await get_tree().process_frame
	print("root children: ", get_tree().root.get_children())
	_m = load("res://src/main.gd").new()
	_m.stage_full = true
	add_child(_m)
	await get_tree().process_frame
	await get_tree().physics_frame
	var sh: Shell = _m._shell

	# ── 0. 이벤트 전달 순서 확인: PLAY 중에는 TouchRouter 가 받는가
	sh.screen = Shell.Screen.PLAY
	TouchRouter.clear_touches()
	TouchRouter.reset_run()
	SimClock.state = SimClock.State.RUN
	await get_tree().physics_frame

	# ── 1. 엄지(index 0)로 드래그 중
	_t(0, Vector2(300.0, 1100.0), true)
	_d(0, Vector2(340.0, 1100.0), Vector2(40.0, 0.0))
	await get_tree().physics_frame
	_snap("1 엄지 드래그")

	# ── 2. 마지막 라이프로 사망 (실제 _on_death 경로)
	_m.lives = 1
	_m._on_death()
	for i in 12:
		await get_tree().physics_frame
	_snap("2 사망 교재")

	# ── 3. 두 번째 손가락(index 1)으로 탭해 재시작 arm — 엄지는 아직 화면에 있다
	_t(1, Vector2(360.0, 600.0), true)
	print("  restart_armed=%s lives=%d" % [_m._restart_armed, _m.lives])
	await get_tree().physics_frame
	await get_tree().physics_frame
	_snap("3 재시작 → 결과화면")

	# ── 4. 두 손가락을 뗀다 (결과 화면 위에서)
	_t(1, Vector2(360.0, 600.0), false)
	_t(0, Vector2(340.0, 1100.0), false)
	_snap("4 두 손가락 릴리스 후  ← 유령?")

	# ── 5. AGAIN
	sh._activate(0)
	await get_tree().physics_frame
	_snap("5 AGAIN 직후")

	# ── 6. 새 런: 엄지를 다시 올린다(index 0) → 드래그
	_t(0, Vector2(300.0, 1100.0), true)
	var x0: float = _m.player.x
	_d(0, Vector2(400.0, 1100.0), Vector2(100.0, 0.0))
	await get_tree().physics_frame
	print("  6a 이동량 = %.1f" % (_m.player.x - x0))
	_snap("6a")
	# 엄지를 뗀다 → 릴레이가 유령으로 넘어가는가
	_t(0, Vector2(400.0, 1100.0), false)
	_snap("6b 엄지 릴리스 후  ← 릴레이?")

	# ── 7. 다시 잡는다
	_t(0, Vector2(300.0, 1100.0), true)
	var x1: float = _m.player.x
	_d(0, Vector2(500.0, 1100.0), Vector2(200.0, 0.0))
	await get_tree().physics_frame
	await get_tree().physics_frame
	print("  7 재파지 후 이동량 = %.1f  (0 이면 영구 정지)" % (_m.player.x - x1))
	_snap("7")

	_m.queue_free()
	await get_tree().process_frame
	Audio.teardown()
	await get_tree().process_frame
	get_tree().quit(0)
