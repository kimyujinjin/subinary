extends Node
## 회귀 불변식 — 감사에서 확정된 결함이 다시 생기지 않는지 헤드리스로 확인한다.
## 화면을 봐야만 알 수 있던 결함을 숫자로 바꿔 둔다.
##
##   ① 조류 띠 위상의 부호 = 유속의 부호 (tick × c 로 계산하면 램프마다 역주행했다)
##   ② 직침어의 첫 바늘이 생성된 틱을 넘겨 살아남는다 (컬링 경계 밖에서 쏘면 즉사했다)
##   ③ 조류 위상 한 주기 적분 = 0 (flow_phase 의 닫힌형 전제)
##   ⑧ P02 역기포 — 감속 → 정지 → 역행이 실제로 원점으로 돌아온다
##   ⑦ 보스 발광 기관 예고 — 모든 발사에 8틱 예고가 붙고, 오지 않는 발사를 예고하지 않는다
##   ⑥ Reach1D — 정적 벽과 틈에서 "속도 v 로 틈에 닿는가" 가 손 계산과 일치한다
##   ⑤ 보스 P1 — 호흡 창에 새 발사 0 · 링 회전 방향 = 조류 방향 (설계서 §6 의 약속)
##   ④ 터치 로직 — 합성 이벤트를 TouchRouter 에 직접 넣는다. 맥의 합성 터치는 index 0
##      하나뿐이라 실기에서만 보이던 다손가락 경로를 여기서 숫자로 확인할 수 있다.

var _fail := 0

func _ready() -> void:
	print("== 불변식 ==")
	_flow_phase_sign(false)
	_flow_phase_sign(true)
	_needle_first_shot()
	_touch_cases()
	_boss_rhythm()
	_reach_cases()
	_glow_cases()
	_bubble_cases()
	_new_pattern_cases()
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

	# 엣지 푸시 — 정지한 손가락에서 무한 지속되면 안 된다.
	# 밴드가 27 → 340 으로 넓어지면서 "끝에 닿은 손가락은 drag 이벤트가 안 온다" 는
	# 지속의 전제가 깨졌다. 이제 화면 물리 끝(EDGE_PIN) 안에서만 유지한다.
	#
	# 좌표는 뷰포트 높이에서 유도한다 — 헤드리스는 1280, 실기는 1560 이다.
	# 하드코딩하면 "여유 충분" 케이스가 헤드리스에서만 여유 부족이 되어 헛 실패한다.
	var ext := TouchRouter.view_phys.y
	var stop_y := ext - 100.0      # 여유 부족 · 제외영역 밖 · 아직 끝은 아니다
	var plenty_y := ext - 400.0    # 여유 충분 (reach = 480 > 320)
	var pin_y := ext - 10.0        # EDGE_PIN 안. 제외영역이라 press 로는 못 가고 drag 로만 간다

	_fresh(SimClock.State.RUN)
	_press(0, Vector2(360.0, stop_y))
	for i in 6:
		_drag(0, Vector2(360.0, stop_y), Vector2(0.0, 6.0))
		TouchRouter.consume(i)
	var on := TouchRouter.edge_push.y
	var drift := 0.0
	for i in 60:
		drift += TouchRouter.consume(100 + i).y     # 델타 0 — 손가락이 멈췄다
	_check(on > 0.0 and absf(drift) < 0.01,
		"정지한 손가락에서 엣지 푸시 해제 (켜짐 %.0f u/s · 이후 표류 %.2f유닛)" % [on, drift])

	# 화면 물리 끝까지 끌고 가면 유지된다 — 거기서는 원래 drag 이벤트가 오지 않는다
	_fresh(SimClock.State.RUN)
	_press(0, Vector2(360.0, stop_y))
	for i in 6:
		_drag(0, Vector2(360.0, pin_y), Vector2(0.0, 15.0))
		TouchRouter.consume(i)
	var pin_drift := 0.0
	for i in 30:
		pin_drift += TouchRouter.consume(200 + i).y
	_check(pin_drift > 10.0,
		"화면 끝에 박힌 손가락은 푸시 유지 (%.0f유닛/30틱)" % pin_drift)

	# 도달 여유가 충분하면 보조하지 않는다
	_fresh(SimClock.State.RUN)
	_press(0, Vector2(360.0, plenty_y))
	for i in 6:
		_drag(0, Vector2(360.0, plenty_y), Vector2(0.0, 6.0))
		TouchRouter.consume(i)
	_check(absf(TouchRouter.edge_push.y) < 0.01,
		"여유 충분하면 보조 없음 (y%.0f · push %.1f)" % [plenty_y, TouchRouter.edge_push.y])

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

# ── 보스 ────────────────────────────────────────────────────────────────
func _boss_rhythm() -> void:
	BulletField.clear()
	var b := Boss.new()
	b.reset(0)
	var p := Vector2(360.0, 1000.0)
	var breath_fire := 0
	var pressure_fire := 0
	var bad_dir := 0
	for t in Boss.P1_MAX_TICKS:
		var before := BulletField.n
		b.step(t, p)
		var fired := BulletField.n > before
		if fired:
			if b.window(t).x == 0:
				breath_fire += 1
			else:
				pressure_fire += 1
		var c := BulletField.flow_c(t) + BulletField.flow_c(t + 1)
		var da := b.ring_angle(t + 1) - b.ring_angle(t)
		if absf(c) > 0.001 and signf(da) != signf(c):
			bad_dir += 1
		BulletField.step_and_collide(t, p, p, true)
		if BulletField.n > Tune.MAX_BULLETS - 64:
			break
	_check(breath_fire == 0 and pressure_fire > 0,
		"보스 호흡 창 발사 0 (호흡 %d · 압력 %d틱)" % [breath_fire, pressure_fire])
	_check(bad_dir == 0, "링 회전 방향 = 조류 방향 (역방향 %d틱)" % bad_dir)
	BulletField.clear()

# ── Reach1D ─────────────────────────────────────────────────────────────
## 손 계산 가능한 장면: t=0 에 전 칸 자유, t ≥ T 에 [600, 660) 만 자유(벽 + 틈).
## 시작점은 전 칸이므로 틈까지 거리는 0 — 항상 산다. 그래서 시작 집합을 [0, 60) 으로 제한하고
## 틈까지 540칸을 T 틱 안에 가야 한다: v·T ≥ 541 이어야 산다.
func _reach_cases() -> void:
	var cells := Tune.SCAN_CELLS
	var start := PackedByteArray(); start.resize(cells); start.fill(0)
	for i in 60: start[i] = 1
	var open := PackedByteArray(); open.resize(cells); open.fill(1)
	var wall := PackedByteArray(); wall.resize(cells); wall.fill(0)
	for i in range(600, 660): wall[i] = 1
	# 경계에 딱 걸리게 고른다: 59 + v·T ≥ 600 → v5 는 T109 생존·T108 사망, v3 은 T181·T180
	for c in [[5, 109, true], [5, 108, false], [3, 181, true], [3, 180, false], [8, 68, true], [8, 67, false]]:
		var v: int = c[0]
		var T: int = c[1]
		var r := Reach1D.new()
		r.step_mask(start, v, 0)
		for t in range(1, T):
			r.step_mask(open, v, t)
		r.step_mask(wall, v, T)
		# 시작 [0,60) 끝 59 → 틱 T-1 번 확장 후 틈 시작 600 에 닿으려면 59 + v·T ≥ 600
		var expect: bool = 59 + v * T >= 600
		_check(r.alive == expect and expect == c[2],
			"Reach1D v=%d T=%d → 생존 %s (손 계산 %s)" % [v, T, r.alive, expect])

# ── 보스 예고 ───────────────────────────────────────────────────────────
## 예고와 실제 발사가 같은 출처인지. 창 경계에서 유령 예고/무예고가 났던 결함의 회귀 검사.
func _glow_cases() -> void:
	for slow in [false, true]:
		BulletField.flow_slow = slow
		var b := Boss.new()
		b.reset(0)
		var fires := PackedInt32Array()
		for t in Boss.P1_MAX_TICKS:
			if b.p05_fires(t):
				fires.append(t)
		var unwarned := 0
		for t in fires:
			# 발사 직전 8틱(t-8..t-1)에 예고가 단조 증가해야 한다
			if t >= 8 and b.organ_glow(t - 8) <= 0.0 and b.organ_glow(t - 1) < 0.8:
				unwarned += 1
		var phantom := 0
		for t in Boss.P1_MAX_TICKS:
			if b.organ_glow(t) <= 0.0:
				continue
			var has := false
			for d in 9:
				if b.p05_fires(t + d):
					has = true
					break
			if not has:
				phantom += 1
		BulletField.flow_slow = false
		var tag := "감속" if slow else "기본"
		_check(fires.size() > 0 and unwarned == 0 and phantom == 0,
			"보스 예고 = 발사 (%s · 발사 %d · 무예고 %d · 유령 %d)" % [
				tag, fires.size(), unwarned, phantom])

# ── P02 역기포 ──────────────────────────────────────────────────────────
## "속 빈 링 = 두 번 온다" 가 실루엣 문법이므로 역행이 실제로 성립해야 한다.
## 감속 t1 = v0/a 에 정지하고 2·t1 에 원점으로 돌아온다.
func _bubble_cases() -> void:
	BulletField.clear()
	var cx := 360.0
	var cy := 400.0
	Patterns.p02_ex(cx, cy, Patterns.P02_COUNT, Patterns.P02_SPEED, Patterns.P02_STOP_SEC, 0.0)
	var n0 := BulletField.n
	var t1 := int(round(Patterns.P02_STOP_SEC * 60.0))
	var deepest := cy
	var crossings := 0        # 발사선(cy)을 아래로 넘었다가 다시 위로 넘는 탄의 수
	var below := {}
	for t in t1 * 2 + 8:
		BulletField.step_and_collide(t + 90, Vector2(-999.0, -999.0), Vector2(-999.0, -999.0), true)
		for i in BulletField.n:
			var id: int = BulletField.bid[i]
			var y: float = BulletField.pos_y[i]
			deepest = maxf(deepest, y)
			if y > cy + 40.0:
				below[id] = true
			elif below.has(id) and y < cy - 10.0:
				below.erase(id)
				crossings += 1
	_check(n0 == Patterns.P02_COUNT, "P02 발사 수 (%d)" % n0)
	# 정확히 아래로 나가는 탄은 없다 — 발수·위상에 따라 가장 아래에 가까운 각이 정해진다.
	# 그 각의 sin 으로 계산해야 맞는다(90° 를 가정하면 count=10 에서 35유닛 어긋난다).
	var sin_max := 0.0
	for i in Patterns.P02_COUNT:
		sin_max = maxf(sin_max, sin(TAU * float(i) / float(Patterns.P02_COUNT)))
	var vy := Patterns.P02_SPEED * sin_max
	var rise := Patterns.P02_SPEED / Patterns.P02_STOP_SEC
	var want_depth := cy + sin_max * 26.0 + vy * vy / (2.0 * rise)
	_check(absf(deepest - want_depth) < 12.0,
		"P02 하강 깊이 y%.0f (계산 %.0f · 최심각 sin %.3f)" % [deepest, want_depth, sin_max])
	_check(crossings >= 4,
		"P02 상승 — 같은 자리를 두 번 지난다 (복귀 %d발)" % crossings)
	BulletField.clear()

# ── 신규 패턴 ───────────────────────────────────────────────────────────
func _new_pattern_cases() -> void:
	# P10 은 "매번 똑같다" 를 3~4번째에 알아차리는 것이 학습이다 — 재현되지 않으면
	# 그 학습이 불가능하다. 해시 기반이므로 호출 순서·표현용 난수 소비와 무관해야 한다.
	BulletField.clear()
	var first := PackedFloat32Array()
	for t in 200:
		Patterns.p10(t, 360.0, 230.0)
		BulletField.step_and_collide(t, Vector2(-999, -999), Vector2(-999, -999), true)
	for i in BulletField.n:
		first.append(BulletField.pos_x[i])
	BulletField.clear()
	var _junk := randf()                       # 표현용 난수 소비 — 스트림 오염 재현
	var same := true
	var idx2 := 0
	for t in 200:
		Patterns.p10(t, 360.0, 230.0)
		BulletField.step_and_collide(t, Vector2(-999, -999), Vector2(-999, -999), true)
	if BulletField.n != first.size():
		same = false
	else:
		for i in BulletField.n:
			if absf(BulletField.pos_x[i] - first[i]) > 0.001:
				same = false
	_check(same and first.size() > 0,
		"P10 난류가 매번 똑같다 (탄 %d · 재현 %s)" % [first.size(), same])

	# P08 포낭은 퓨즈로 터진다 — 퓨즈 전에는 포낭만, 후에는 산개탄만 있어야 한다.
	BulletField.clear()
	Patterns.p08(0, 360.0, 200.0)
	var pods := BulletField.n
	for t in Tune.POD_FUSE - 2:
		BulletField.step_and_collide(t, Vector2(-999, -999), Vector2(-999, -999), true)
	var before := BulletField.n
	for t in 4:
		BulletField.step_and_collide(Tune.POD_FUSE + t, Vector2(-999, -999), Vector2(-999, -999), true)
	var after := BulletField.n
	var pods_left := 0
	for i in BulletField.n:
		if BulletField.kind[i] == Tune.Kind.POD:
			pods_left += 1
	_check(pods == 2 and before == 2 and pods_left == 0
			and after == 2 * Tune.POD_BURST_COUNT,
		"P08 포낭 파열 (포낭 %d → 퓨즈 직전 %d → 산개 %d · 잔존 포낭 %d)" % [
			pods, before, after, pods_left])

	# P15 는 플레이어 방향에 틈을 연다 — 전환 순간에 벌을 주지 않는다는 약속이다.
	BulletField.clear()
	var pl := Vector2(200.0, 900.0)
	Patterns.p15(360.0, 300.0, pl.x, pl.y)
	var safe := atan2(pl.y - 300.0, pl.x - 360.0)
	var worst := PI
	for i in BulletField.n:
		var a := atan2(BulletField.vel_y[i], BulletField.vel_x[i])
		worst = minf(worst, absf(angle_difference(a, safe)))
	_check(BulletField.n > 0 and worst >= deg_to_rad(Patterns.P15_GAP_DEG) * 0.5 - 0.01,
		"P15 틈이 플레이어를 향한다 (탄 %d · 최근접 %.1f° ≥ %.1f°)" % [
			BulletField.n, rad_to_deg(worst), Patterns.P15_GAP_DEG * 0.5])
	BulletField.clear()
