extends Node
## 반증 시도 — 셸이 터치 릴리스를 삼켜 TouchRouter 에 유령이 남는가.

const PLAY_Y := 1100.0
var _main: Node = null

func _push(e: InputEvent) -> void:
	get_viewport().push_input(e, true)

func _touch(idx: int, p: Vector2, pressed: bool) -> void:
	var e := InputEventScreenTouch.new()
	e.index = idx; e.position = p; e.pressed = pressed
	_push(e)

func _drag(idx: int, p: Vector2, rel: Vector2) -> void:
	var e := InputEventScreenDrag.new()
	e.index = idx; e.position = p; e.screen_relative = rel
	_push(e)

func _ready() -> void:
	SaveData.reset_for_test("user://save-zzghost.json")
	_main = load("res://scenes/main.tscn").instantiate()
	_main.stage_full = true
	add_child(_main)
	await get_tree().physics_frame
	await get_tree().physics_frame
	var sh = _main._shell
	print("-- 0. 노드 순서 (누가 먼저 unhandled_input 을 받는가)")
	print("   root children: ", get_tree().root.get_children())

	# ── 1. 플레이 중 엄지 드래그
	sh.screen = 0   # PLAY
	TouchRouter.clear_touches()
	TouchRouter.reset_run()
	SimClock.state = SimClock.State.RUN
	_touch(0, Vector2(300.0, PLAY_Y), true)
	_drag(0, Vector2(340.0, PLAY_Y), Vector2(40.0, 0.0))
	await get_tree().physics_frame
	print("-- 1. 엄지 드래그: touch=%s drag_idx=%d" % [TouchRouter._touch.keys(), TouchRouter.drag_idx])

	# ── 2. 라이프 0 으로 사망 → 교재 → 두 번째 손가락으로 탭
	_main.lives = 0
	SimClock.state = SimClock.State.DEATH_REPLAY
	_touch(1, Vector2(360.0, 600.0), true)
	print("-- 2. 교재 탭(idx1): touch=%s drag_idx=%d restart_armed=%s" % [
		TouchRouter._touch.keys(), TouchRouter.drag_idx, _main._restart_armed])

	# ── 3. 다음 물리 프레임 → finish_run → RESULT
	await get_tree().physics_frame
	await get_tree().physics_frame
	print("-- 3. shell.screen=%d (RESULT=%d) sim_state=%d" % [sh.screen, 4, SimClock.state])

	# ── 4. 두 손가락을 뗀다 (RESULT 화면)
	_touch(0, Vector2(340.0, PLAY_Y), false)
	_touch(1, Vector2(360.0, 600.0), false)
	print("-- 4. 릴리스 후: touch=%s drag_idx=%d  ← 유령이 남았는가" % [
		TouchRouter._touch.keys(), TouchRouter.drag_idx])

	# ── 5. AGAIN (셸 버튼 press/release 도 셸이 삼킨다)
	sh._activate(0)
	await get_tree().physics_frame
	print("-- 5. AGAIN 후: screen=%d touch=%s drag_idx=%d state=%d" % [
		sh.screen, TouchRouter._touch.keys(), TouchRouter.drag_idx, SimClock.state])

	# ── 6. 새 런에서 엄지를 올려 드래그 → 뗀다
	_touch(0, Vector2(300.0, PLAY_Y), true)
	var x0: float = _main.player.x
	_drag(0, Vector2(400.0, PLAY_Y), Vector2(100.0, 0.0))
	await get_tree().physics_frame
	print("-- 6a. 첫 드래그 이동량 = %.1f (drag_idx=%d)" % [_main.player.x - x0, TouchRouter.drag_idx])
	_touch(0, Vector2(400.0, PLAY_Y), false)
	print("-- 6b. 엄지 릴리스 후: drag_idx=%d relay=%d touch=%s" % [
		TouchRouter.drag_idx, TouchRouter.relay_count, TouchRouter._touch.keys()])

	# ── 7. 다시 잡는다
	_touch(0, Vector2(300.0, PLAY_Y), true)
	var x1: float = _main.player.x
	_drag(0, Vector2(500.0, PLAY_Y), Vector2(200.0, 0.0))
	await get_tree().physics_frame
	await get_tree().physics_frame
	print("-- 7. 재파지 후 이동량 = %.1f (drag_idx=%d, touch=%s)  ← 0 이면 기체 영구 정지" % [
		_main.player.x - x1, TouchRouter.drag_idx, TouchRouter._touch.keys()])

	Audio.teardown()
	get_tree().quit(0)
