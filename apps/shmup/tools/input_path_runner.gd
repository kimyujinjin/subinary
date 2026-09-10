extends Node
## 실제 입력 경로 검증 — Viewport.push_input 으로 넣는다.
##
## invariants_runner 는 TouchRouter._unhandled_input() 을 직접 호출하므로
## **상위 노드가 이벤트를 먼저 소비하는 경로**를 못 본다. 최상단 띠 제스처가 press 만
## 소비하고 drag 를 흘려 TouchRouter 에 유령 터치를 남기던 결함이 정확히 그 사각지대였다
## (릴레이가 화면에 없는 손가락으로 넘어가 기체가 영구히 멈췄다).
##
## 그래서 이 러너는 실제 씬(main.tscn)을 띄우고 뷰포트로 이벤트를 밀어 넣는다.

const BAND_Y := 30.0        # 최상단 64유닛 안 — 장면 전환 제스처 영역
const PLAY_Y := 1100.0

var _fail := 0
var _main: Node = null

func _check(ok: bool, label: String) -> void:
	print("  %s %s" % ["OK  " if ok else "FAIL", label])
	if not ok:
		_fail += 1

func _ready() -> void:
	print("== 실제 입력 경로 (Viewport.push_input) ==")
	_main = load("res://scenes/main.tscn").instantiate()
	add_child(_main)
	await get_tree().physics_frame
	await get_tree().physics_frame
	await _ghost_touch_case()
	_main.queue_free()
	_main = null
	await get_tree().process_frame
	await _boss_clear_case()
	print("== 실패 %d ==" % _fail)
	get_tree().quit(1 if _fail > 0 else 0)

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

## 띠를 두드리는 동안(전환 미완료) 플레이 손가락으로 계속 조작할 수 있어야 한다.
## 그리고 그 손가락을 뗐다 다시 잡아도 조작이 돌아와야 한다.
func _ghost_touch_case() -> void:
	TouchRouter.clear_touches()
	TouchRouter.reset_run()
	SimClock.state = SimClock.State.RUN

	_touch(0, Vector2(300.0, PLAY_Y), true)          # 플레이 엄지
	_touch(1, Vector2(360.0, BAND_Y), true)          # 띠 탭 1회 (전환은 3회)
	_drag(1, Vector2(361.0, BAND_Y + 1.0), Vector2(1.0, 1.0))
	_touch(1, Vector2(361.0, BAND_Y + 1.0), false)
	_check(not TouchRouter._touch.has(1) and TouchRouter.drag_idx == 0,
		"띠 탭이 TouchRouter 에 유령을 남기지 않는다 (touch %s · drag %d)" % [
			TouchRouter._touch.keys(), TouchRouter.drag_idx])

	# 플레이 엄지를 떼면 재파지다 — 갈 곳이 없으므로 릴레이가 아니다
	_drag(0, Vector2(360.0, PLAY_Y), Vector2(60.0, 0.0))
	_touch(0, Vector2(360.0, PLAY_Y), false)
	_check(TouchRouter.drag_idx == -1 and TouchRouter.relay_count == 0,
		"유령으로 릴레이되지 않는다 (drag %d · 릴레이 %d)" % [
			TouchRouter.drag_idx, TouchRouter.relay_count])

	# 다시 잡으면 조작이 돌아온다
	_touch(0, Vector2(300.0, PLAY_Y), true)
	var before: float = _main.player.x
	_drag(0, Vector2(400.0, PLAY_Y), Vector2(100.0, 0.0))
	await get_tree().physics_frame
	await get_tree().physics_frame
	_check(TouchRouter.drag_idx == 0 and absf(_main.player.x - before) > 1.0,
		"재파지 후 조작 복귀 (drag %d · x %.1f → %.1f)" % [
			TouchRouter.drag_idx, before, _main.player.x])
	TouchRouter.clear_touches()

## 보스 격파 → 재시작 경로. 무조작 헤드리스 런은 50초 전에 죽으므로 스모크 테스트로는
## 이 경로가 한 번도 실행되지 않는다. 격파 직전에 사망 판정이 돌아 clear·death 가 같은
## 틱에 기록되고 청록 플래시가 얼어붙던 결함이 여기 있었다.
func _boss_clear_case() -> void:
	TouchRouter.clear_touches()
	TouchRouter.reset_run()
	var bm: Node = load("res://scenes/boss_rush.tscn").instantiate()
	add_child(bm)
	await get_tree().physics_frame
	await get_tree().physics_frame
	var run0: int = SimClock.run_index
	var deaths0: int = bm.deaths
	# 탄이 가장 두꺼운 순간(압력 창)에 격파를 만든다 — 격파 틱의 판정이 문제였다
	while bm.boss.window(SimClock.sim_tick).x != 1:
		await get_tree().physics_frame
	for i in 40:
		await get_tree().physics_frame
	bm.boss.damage(Boss.HP_MAX, SimClock.sim_tick)
	await get_tree().physics_frame
	_check(bm.clear_anim >= 0 and bm.deaths == deaths0 and SimClock.state == SimClock.State.RUN,
		"격파 틱에 죽지 않는다 (clear_anim %d · 사망 %d → %d · state %d)" % [
			bm.clear_anim, deaths0, bm.deaths, SimClock.state])
	var restarted := false
	for i in 200:
		await get_tree().physics_frame
		if SimClock.run_index > run0:
			restarted = true
			break
	_check(restarted and bm.clear_anim < 0 and bm.boss.hp_frac() > 0.99,
		"격파 → 2초 뒤 재시작 (재시작 %s · clear_anim %d · HP %.0f%%)" % [
			restarted, bm.clear_anim, bm.boss.hp_frac() * 100.0])
	bm.queue_free()
	await get_tree().process_frame
