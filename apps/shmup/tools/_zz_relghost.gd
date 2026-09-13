extends Node
## 반증 재현: 셸(결과 화면)이 release 를 먹어 TouchRouter 에 유령 손가락이 남는가.
## 실제 입력 경로(Viewport.push_input)로만 조작한다 — sh._activate() 를 부르지 않는다.

var m: Main = null
var sh: Shell = null

func _p(e: InputEvent) -> void:
	get_viewport().push_input(e, true)

func _t(idx: int, p: Vector2, pressed: bool) -> void:
	var e := InputEventScreenTouch.new()
	e.index = idx; e.position = p; e.pressed = pressed
	_p(e)

func _d(idx: int, p: Vector2, rel: Vector2) -> void:
	var e := InputEventScreenDrag.new()
	e.index = idx; e.position = p; e.screen_relative = rel
	_p(e)

func _st() -> String:
	return "touch=%s drag=%d relay=%d screen=%d" % [
		TouchRouter._touch.keys(), TouchRouter.drag_idx, TouchRouter.relay_count, sh.screen]

func _ready() -> void:
	SaveData.reset_for_test("user://save-relghost.json")
	await get_tree().process_frame
	m = load("res://src/main.gd").new()
	m.stage_full = true
	add_child(m)
	await get_tree().physics_frame
	await get_tree().physics_frame
	sh = m._shell
	sh.screen = Shell.Screen.PLAY
	TouchRouter.clear_touches()
	TouchRouter.reset_run()
	m.bombs = 0
	m.lives = 1
	await get_tree().physics_frame

	# 1. 플레이 중 엄지(index 0) 를 올린다
	_t(0, Vector2(300.0, 900.0), true)
	await get_tree().physics_frame
	print("1) 엄지 press: ", _st())

	# 2. 마지막 사망을 만든다 (lives 1 → 0)
	m.invincible_left = 0
	BulletField.spawn(m.player.x, m.player.y, 0.0, 0.0, Tune.Kind.SPORE_TIDE)
	for i in 60:
		await get_tree().physics_frame
		if SimClock.state == SimClock.State.DEATH_REPLAY \
				or SimClock.state == SimClock.State.DEATH_FROZEN:
			break
	print("2) 사망: state=%d lives=%d  %s" % [SimClock.state, m.lives, _st()])

	# 3. 둘째 손가락(index 1) 으로 탭해 재시작 — press 만 넣고 아직 떼지 않는다
	#    (사람 탭은 80~150ms = 5~9틱. 결과 화면은 다음 틱(16ms)에 뜬다.)
	_t(1, Vector2(500.0, 700.0), true)
	print("3) 재시작 탭 press: ", _st())
	await get_tree().physics_frame
	print("   다음 틱 뒤: screen=%d (RESULT=%d)" % [sh.screen, Shell.Screen.RESULT])

	# 4. 결과 화면이 뜬 뒤 두 손가락을 뗀다
	_t(1, Vector2(500.0, 700.0), false)
	_t(0, Vector2(300.0, 900.0), false)
	await get_tree().physics_frame
	print("4) 두 손가락 release 후: ", _st())
	var ghosts: Array = TouchRouter._touch.keys()

	# 5. AGAIN 버튼을 실제 좌표로 누른다
	sh.queue_redraw()
	await get_tree().process_frame
	var rect := Rect2()
	for b in sh._btns:
		if int(b[1]) == 0:
			rect = b[0] as Rect2
	var c := rect.position + rect.size * 0.5
	print("5) AGAIN 버튼 rect=%s center=%s" % [rect, c])
	_t(2, c, true)
	_t(2, c, false)
	await get_tree().physics_frame
	print("   AGAIN 후: playing=%s  %s" % [sh.playing(), _st()])

	# 6. 새 런 — 엄지를 다시 index 0 으로 올린다
	m.invincible_left = 100000
	_t(0, Vector2(300.0, 900.0), true)
	var x0: float = m.player.x
	_d(0, Vector2(400.0, 900.0), Vector2(100.0, 0.0))
	await get_tree().physics_frame
	print("6) 재파지 전 드래그: x %.1f -> %.1f  %s" % [x0, m.player.x, _st()])

	# 7. 한 번 재파지한다 (뗀다)
	for i in 15:
		await get_tree().physics_frame
	_t(0, Vector2(400.0, 900.0), false)
	await get_tree().physics_frame
	print("7) 엄지 release(재파지): ", _st())

	# 8. 다시 잡고 드래그 — 기체가 움직이는가
	_t(0, Vector2(300.0, 900.0), true)
	var x1: float = m.player.x
	for i in 5:
		_d(0, Vector2(300.0 + 20.0 * float(i + 1), 900.0), Vector2(20.0, 0.0))
		await get_tree().physics_frame
	print("8) 재파지 후 드래그 100px: x %.1f -> %.1f  %s" % [x1, m.player.x, _st()])
	print("판정: ghosts=%s  frozen=%s" % [ghosts, absf(m.player.x - x1) < 1.0])

	# 9. 영구성 — 움직이지 못해 또 죽고, 결과 화면에서 AGAIN 을 눌러도 그대로인가
	m.invincible_left = 0
	m.lives = 1
	BulletField.spawn(m.player.x, m.player.y, 0.0, 0.0, Tune.Kind.SPORE_TIDE)
	for i in 60:
		await get_tree().physics_frame
		if not sh.playing():
			break
		if SimClock.state == SimClock.State.DEATH_REPLAY \
				or SimClock.state == SimClock.State.DEATH_FROZEN:
			_t(3, Vector2(500.0, 700.0), true)
			_t(3, Vector2(500.0, 700.0), false)
	print("9) 또 죽고 결과 화면: ", _st())
	sh.queue_redraw()
	await get_tree().process_frame
	for b in sh._btns:
		if int(b[1]) == 0:
			rect = b[0] as Rect2
	c = rect.position + rect.size * 0.5
	_t(4, c, true)
	_t(4, c, false)
	await get_tree().physics_frame
	m.invincible_left = 100000
	_t(0, Vector2(300.0, 900.0), true)
	var x2: float = m.player.x
	for i in 5:
		_d(0, Vector2(300.0 + 20.0 * float(i + 1), 900.0), Vector2(20.0, 0.0))
		await get_tree().physics_frame
	print("10) 새 런에서도 드래그 100px: x %.1f -> %.1f  %s" % [x2, m.player.x, _st()])

	# 11. 앱을 백그라운드로 (clear_touches) 만 복구시키는가
	TouchRouter.clear_touches()
	_t(0, Vector2(300.0, 900.0), true)
	var x3: float = m.player.x
	for i in 5:
		_d(0, Vector2(300.0 + 20.0 * float(i + 1), 900.0), Vector2(20.0, 0.0))
		await get_tree().physics_frame
	print("11) clear_touches 후: x %.1f -> %.1f  %s" % [x3, m.player.x, _st()])

	m.queue_free()
	await get_tree().process_frame
	Audio.teardown()
	await get_tree().process_frame
	get_tree().quit(0)
