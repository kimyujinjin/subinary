extends Node
## 회귀 불변식 — 감사에서 확정된 결함이 다시 생기지 않는지 헤드리스로 확인한다.
## 화면을 봐야만 알 수 있던 결함을 숫자로 바꿔 둔다.
##
##   ① 조류 띠 위상의 부호 = 유속의 부호 (tick × c 로 계산하면 램프마다 역주행했다)
##   ② 직침어의 첫 바늘이 생성된 틱을 넘겨 살아남는다 (컬링 경계 밖에서 쏘면 즉사했다)
##   ③ 조류 위상 한 주기 적분 = 0 (flow_phase 의 닫힌형 전제)
##   ④ 터치 로직 — 합성 이벤트를 TouchRouter 에 직접 넣는다. 맥의 합성 터치는 index 0
##      하나뿐이라 실기에서만 보이던 다손가락 경로를 여기서 숫자로 확인할 수 있다.

var _fail := 0

func _ready() -> void:
	print("== 불변식 ==")
	_flow_phase_sign(false)
	_flow_phase_sign(true)
	_needle_first_shot()
	_touch_cases()
	print("== 실패 %d ==" % _fail)
	get_tree().quit(1 if _fail > 0 else 0)

func _check(ok: bool, label: String) -> void:
	print("  %s %s" % ["OK  " if ok else "FAIL", label])
	if not ok:
		_fail += 1

func _flow_phase_sign(slow: bool) -> void:
	BulletField.flow_slow = slow
	var period: int = Tune.FLOW_SLOW_PERIOD if slow else Tune.FLOW_PERIOD
	var bad := 0
	var bad_old := 0
	for t in period * 3:
		var d := BulletField.flow_phase(t + 1) - BulletField.flow_phase(t)
		var c := BulletField.flow_c(t) + BulletField.flow_c(t + 1)
		if absf(c) > 0.001 and signf(d) != signf(c):
			bad += 1
		# 대조: 옛 공식 tick × c
		var d_old := float(t + 1) * BulletField.flow_c(t + 1) - float(t) * BulletField.flow_c(t)
		if absf(c) > 0.001 and signf(d_old) != signf(c):
			bad_old += 1
	var wrap := absf(BulletField.flow_phase(period) - BulletField.flow_phase(0))
	BulletField.flow_slow = false
	var tag := "감속" if slow else "기본"
	_check(bad == 0, "조류 위상 부호 = 유속 부호 (%s, %d틱 중 역주행 %d · 옛 공식 %d)" % [
		tag, period * 3, bad, bad_old])
	_check(wrap < 0.001, "조류 위상 한 주기 적분 = 0 (%s, 잔차 %.4f)" % [tag, wrap])

func _needle_first_shot() -> void:
	BulletField.clear()
	var ef := EnemyField.new()
	ef.spawn(0, EnemyField.Type.NEEDLEFISH, -60.0, 380.0, 380.0, 0, 0, 1.0)
	var p := Vector2(360.0, 1000.0)
	var first_spawn := -1
	var survived := false
	for t in 240:
		var before := BulletField.n
		ef.step(t, p)
		var spawned := BulletField.n > before
		BulletField.step_and_collide(t, p, p, true)
		if spawned and first_spawn < 0:
			first_spawn = t
			survived = BulletField.n > 0
			break
	_check(first_spawn >= 0 and survived,
		"직침어 첫 바늘이 생성 틱을 넘겨 산다 (첫 발 t=%d, 생존 %s)" % [first_spawn, survived])

# ── 터치 ────────────────────────────────────────────────────────────────
func _press(idx: int, p: Vector2) -> void:
	var e := InputEventScreenTouch.new()
	e.index = idx; e.position = p; e.pressed = true
	TouchRouter._unhandled_input(e)

func _release(idx: int, p: Vector2) -> void:
	var e := InputEventScreenTouch.new()
	e.index = idx; e.position = p; e.pressed = false
	TouchRouter._unhandled_input(e)

func _drag(idx: int, p: Vector2, rel: Vector2) -> void:
	var e := InputEventScreenDrag.new()
	e.index = idx; e.position = p; e.screen_relative = rel
	TouchRouter._unhandled_input(e)

func _fresh(state: int) -> void:
	TouchRouter.clear_touches()
	TouchRouter.reset_run()
	SimClock.state = state
	SimClock.wall_tick += 100          # 이전 케이스의 탭 창에서 벗어난다

func _touch_cases() -> void:
	var a := Vector2(300.0, 1100.0)
	var b := Vector2(420.0, 1150.0)

	# 릴레이: 두 번째 손가락이 있으면 첫 손가락을 떼도 역할이 0프레임으로 넘어간다
	_fresh(SimClock.State.RUN)
	_press(0, a); _press(1, b)
	SimClock.wall_tick += 30
	_drag(0, a + Vector2(40, 0), Vector2(40, 0))
	_release(0, a + Vector2(40, 0))
	_check(TouchRouter.drag_idx == 1 and TouchRouter.regrip_count == 0 and TouchRouter.relay_count == 1,
		"릴레이 인계 (drag=%d · 재파지 %d · 릴레이 %d)" % [
			TouchRouter.drag_idx, TouchRouter.regrip_count, TouchRouter.relay_count])

	# 플레이 중 재파지는 세고 원인을 남긴다
	_fresh(SimClock.State.RUN)
	_press(0, a)
	SimClock.wall_tick += 30
	_drag(0, a + Vector2(60, 0), Vector2(60, 0))
	_release(0, a + Vector2(60, 0))
	_check(TouchRouter.regrip_count == 1 and TouchRouter.regrip_events.size() == 1,
		"플레이 중 재파지 집계 + 원인 기록 (%d회 · 이벤트 %d)" % [
			TouchRouter.regrip_count, TouchRouter.regrip_events.size()])

	# 사망 화면에서 손을 떼는 것은 재파지가 아니다
	_fresh(SimClock.State.RUN)
	_press(0, a)
	SimClock.state = SimClock.State.DEATH_FROZEN
	SimClock.wall_tick += 30
	_drag(0, a + Vector2(60, 0), Vector2(60, 0))
	_release(0, a + Vector2(60, 0))
	_check(TouchRouter.regrip_count == 0, "사망 화면 해제는 재파지 아님 (%d회)" % TouchRouter.regrip_count)

	# 재시작 탭은 드래그 역할을 받되 이중탭 래치를 켜지 않는다
	_fresh(SimClock.State.DEATH_FROZEN)
	TouchRouter._tap_tick = SimClock.wall_tick
	TouchRouter._tap_pos = a
	_press(2, a)
	_check(TouchRouter.drag_idx == 2 and not TouchRouter.focus,
		"재시작 탭 → 역할 배정 · 집중 안 켜짐 (drag=%d · focus=%s)" % [
			TouchRouter.drag_idx, TouchRouter.focus])
	TouchRouter.reset_run()
	_check(TouchRouter.drag_idx == 2, "reset_run 뒤에도 올려 둔 손가락이 역할 유지 (drag=%d)" % TouchRouter.drag_idx)

	# 초과분 이월: 한 틱에 200px 가 와도 다음 틱들에 걸쳐 전부 반영된다
	_fresh(SimClock.State.RUN)
	_press(0, a)
	_drag(0, a + Vector2(200, 0), Vector2(200, 0))
	var sum := 0.0
	for i in 12:
		sum += TouchRouter.consume(i).x
	var want := 200.0 * TouchRouter.field_per_px * TouchRouter.k
	_check(absf(sum - want) < 0.01, "초과분 이월 (합 %.2f · 기대 %.2f)" % [sum, want])

	TouchRouter.clear_touches()
	TouchRouter.reset_run()
	SimClock.state = SimClock.State.RUN
