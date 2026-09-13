extends Node
## 반증 시도 (재현 각도) — 셸 RESULT 가 release 를 삼켜 TouchRouter 에 유령이 남고
## 다음 런에서 릴레이가 유령으로 넘어가 기체가 영구 정지하는가.
##
## 규칙: 상태를 직접 찌르지 않는다. 모든 손가락은 진짜 InputEvent 로 뷰포트에 넣고,
## 사망은 자연사(입력 없이 벽에 맞음)로, 메뉴 탭은 셸이 _draw 로 만든 _btns 좌표로 누른다.
## 유일한 예외: lives 를 1 로 둔다(두 번 죽은 뒤의 정상 상태다. 헤드리스 시간 절약).

var _m: Node = null
var _sh = null

func _push(e: InputEvent) -> void:
	get_viewport().push_input(e, true)

func _t(idx: int, p: Vector2, pressed: bool) -> void:
	var e := InputEventScreenTouch.new()
	e.index = idx; e.position = p; e.pressed = pressed
	_push(e)

func _d(idx: int, p: Vector2, rel: Vector2) -> void:
	var e := InputEventScreenDrag.new()
	e.index = idx; e.position = p; e.screen_relative = rel
	_push(e)

func _snap(tag: String) -> void:
	print("  [%s] shell=%d sim=%d touch=%s drag=%d relay=%d" % [
		tag, _sh.screen, SimClock.state, str(TouchRouter._touch.keys()),
		TouchRouter.drag_idx, TouchRouter.relay_count])

func _frames(n: int) -> void:
	for i in n:
		await get_tree().physics_frame

func _ready() -> void:
	SaveData.reset_for_test("user://save-rpghost.json")
	_m = load("res://scenes/main.tscn").instantiate()
	_m.stage_full = true
	add_child(_m)
	await _frames(2)
	_sh = _m._shell
	print("root children: ", get_tree().root.get_children())
	print("viewport: ", get_viewport().get_visible_rect().size,
			"  view_size=", TouchRouter.view_size, "  shell.screen=", _sh.screen)

	# ── A. 플레이 중: 엄지(index 0)를 올리고 조금 끈다.
	_t(0, Vector2(300.0, 1100.0), true)
	await _frames(1)
	_d(0, Vector2(340.0, 1100.0), Vector2(40.0, 0.0))
	await _frames(1)
	_snap("A 엄지 드래그")
	print("    A 이동 확인: player.x=%.1f" % _m.player.x)

	# ── B. 마지막 라이프. 손가락을 움직이지 않고 자연사할 때까지 돌린다.
	_m.lives = 1
	var guard := 0
	while SimClock.state != SimClock.State.DEATH_REPLAY \
			and SimClock.state != SimClock.State.DEATH_FROZEN and guard < 3000:
		guard += 1
		await get_tree().physics_frame
	print("    B 자연사 대기 %d 프레임 → sim=%d lives=%d" % [guard, SimClock.state, _m.lives])
	_snap("B 사망 교재")

	# ── C. 두 번째 손가락(index 1)으로 교재를 탭 → 재시작. 엄지는 화면에 그대로.
	_t(1, Vector2(360.0, 600.0), true)
	_snap("C1 교재 탭 직후 (TouchRouter 가 press 를 봤는가)")
	await _frames(3)
	_snap("C2 결과 화면 진입")

	# ── D. 결과 화면 위에서 두 손가락을 뗀다. (실제로 손가락은 화면에서 사라졌다)
	_t(1, Vector2(360.0, 600.0), false)
	_t(0, Vector2(340.0, 1100.0), false)
	_snap("D 릴리스 후  ← 유령이 남았는가")

	# ── E. AGAIN 버튼을 진짜로 누른다 (셸이 그린 히트박스 좌표).
	var again := Rect2()
	for b in _sh._btns:
		if int(b[1]) == 0:
			again = b[0]
			break
	var ap := again.position + again.size * 0.5
	print("    E AGAIN rect=%s tap=%s" % [str(again), str(ap)])
	_t(0, ap, true)
	_t(0, ap, false)
	await _frames(2)
	_snap("E AGAIN 후")

	# ── F. 새 런. 엄지를 다시 올려 드래그한다.
	_t(0, Vector2(300.0, 1100.0), true)
	await _frames(1)
	var x0: float = _m.player.x
	_d(0, Vector2(400.0, 1100.0), Vector2(100.0, 0.0))
	await _frames(2)
	print("    F1 첫 드래그 이동 %.1f -> %.1f" % [x0, _m.player.x])
	_snap("F1")
	# 엄지를 뗀다 (재파지) → 릴레이가 유령으로 가는가
	_t(0, Vector2(400.0, 1100.0), false)
	_snap("F2 엄지 릴리스 후  ← 릴레이 대상")

	# ── G. 다시 잡고 끈다.
	_t(0, Vector2(300.0, 1100.0), true)
	await _frames(1)
	var x1: float = _m.player.x
	_d(0, Vector2(420.0, 1100.0), Vector2(120.0, 0.0))
	_d(0, Vector2(500.0, 1100.0), Vector2(80.0, 0.0))
	await _frames(3)
	print("    G 재파지 후 이동 %.1f -> %.1f   (0 이면 영구 정지)" % [x1, _m.player.x])
	_snap("G")

	# ── H. 한 번 더 (완전히 죽었는지)
	_t(0, Vector2(300.0, 1100.0), false)
	_t(0, Vector2(300.0, 1100.0), true)
	await _frames(1)
	var x2: float = _m.player.x
	_d(0, Vector2(200.0, 1100.0), Vector2(-100.0, 0.0))
	await _frames(3)
	print("    H 두 번째 재파지 이동 %.1f -> %.1f" % [x2, _m.player.x])
	_snap("H")

	_m.queue_free()
	await get_tree().process_frame
	Audio.teardown()
	await get_tree().process_frame
	get_tree().quit(0)
