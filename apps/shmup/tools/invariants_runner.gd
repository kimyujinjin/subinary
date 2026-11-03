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
	# **실제 세이브를 건드리지 않는다.** 러너는 패턴을 직접 호출하므로 mark() 가
	# _dirty 를 켜고, Main 을 띄우는 러너는 free() 때 save_now() 가 돌아
	# 최고점수·해금·무피격 기록을 0 으로 덮어쓴다(실측). 경고도 실패도 없이 사라진다.
	SaveData.reset_for_test("user://save-test-invariants_runner.json")
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
	_boss_pattern_cases()
	_boss_phase_cases()
	_stage_cases()
	_midboss_cases()
	_runlog_cases()
	_difficulty_cases()
	_shear_window_cases()
	_spin_cases()
	_table_cases()
	_shell_cases()
	await _audio_cases()
	Audio.teardown()
	print("== 실패 %d ==" % _fail)
	get_tree().quit(1 if _fail > 0 else 0)

func _check(ok: bool, label: String) -> void:
	print("  %s %s" % ["OK  " if ok else "FAIL", label])
	if not ok:
		_fail += 1

func _flow_phase_sign(slow: bool) -> void:
	Difficulty.apply(Difficulty.Level.EASY if slow else Difficulty.Level.NORMAL)
	var period: int = Difficulty.period
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
	Difficulty.apply(Difficulty.Level.NORMAL)
	var tag := "감속" if slow else "기본"
	_check(bad == 0, "조류 위상 부호 = 유속 부호 (%s, %d틱 중 역주행 %d · 옛 공식 %d)" % [
		tag, period * 3, bad, bad_old])
	_check(wrap < 0.001, "조류 위상 한 주기 적분 = 0 (%s, 잔차 %.4f)" % [tag, wrap])

func _needle_first_shot() -> void:
	BulletField.clear()
	var ef := EnemyField.new()
	ef.spawn(0, EnemyField.Type.NEEDLEFISH, -60.0, 380.0, 380.0, 24, EnemyField.NF_HOLD, 1.0)
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
		Difficulty.apply(Difficulty.Level.EASY if slow else Difficulty.Level.NORMAL)
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
		Difficulty.apply(Difficulty.Level.NORMAL)
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

# ── 보스·중간보스 패턴 ──────────────────────────────────────────────────
func _boss_pattern_cases() -> void:
	# P13 게이트는 게임 전체에서 이 패턴 하나에만 예약된 표식이다.
	# 흰 대형탄이 정확히 2발이어야 하고, 그중 하나는 플레이어에게서 250유닛 안이어야 한다
	# (설계서 §6: "흰 게이트 2개 중 가까운 쪽(항상 250유닛 이내)").
	BulletField.clear()
	var c := Vector2(360.0, 250.0)
	var pl := Vector2(520.0, 900.0)
	Patterns.p13(0, c.x, c.y, pl.x, pl.y)
	var gates := 0
	var near := 99999.0
	for i in BulletField.n:
		if BulletField.kind[i] == Tune.Kind.GATE:
			gates += 1
			# 게이트가 수축해 플레이어 y 선에 닿았을 때의 x 를 본다
			var a := atan2(BulletField.vel_y[i], BulletField.vel_x[i])
			near = minf(near, absf(angle_difference(a + PI,
					atan2(pl.y - c.y, pl.x - c.x))))
	_check(gates == Patterns.P13_GATES,
		"P13 흰 게이트가 정확히 %d 발 (%d)" % [Patterns.P13_GATES, gates])
	_check(near < deg_to_rad(360.0 / float(Patterns.P13_COUNT)),
		"P13 게이트 하나가 플레이어 방향 (%.1f°)" % rad_to_deg(near))
	# 게이트 외에 흰 대형탄이 다른 패턴에 새지 않는다
	BulletField.clear()
	var leak := 0
	for idx in Patterns.BOOK.size():
		if idx == Patterns.Id.P13_CONTRACT:
			continue
		BulletField.clear()
		for t in 200:
			Patterns.emit_solo(idx, t, t, Vector2(360.0, 1000.0))
		for i in BulletField.n:
			if BulletField.kind[i] == Tune.Kind.GATE:
				leak += 1
	_check(leak == 0, "흰 게이트탄이 P13 외에 안 쓰인다 (누출 %d)" % leak)

	# P16 은 조류를 따르면 틀리는 유일한 패턴이다 — 응결 위치가 조류 방향으로 앞서야 한다.
	BulletField.clear()
	var t_right := -1
	var t_left := -1
	for t in Difficulty.period:
		if t_right < 0 and BulletField.flow_c(t) > 0.99:
			t_right = t
		if t_left < 0 and BulletField.flow_c(t) < -0.99:
			t_left = t
	var xr := 0.0
	var xl := 0.0
	BulletField.clear(); Patterns.p16(0, t_right, 360.0, 230.0)
	for i in BulletField.n:
		xr += BulletField.pos_x[i]
	xr /= float(maxi(BulletField.n, 1))
	BulletField.clear(); Patterns.p16(0, t_left, 360.0, 230.0)
	for i in BulletField.n:
		xl += BulletField.pos_x[i]
	xl /= float(maxi(BulletField.n, 1))
	_check(xr > 360.0 + Patterns.P16_LEAD * 0.8 and xl < 360.0 - Patterns.P16_LEAD * 0.8,
		"P16 이 조류 방향 앞에 응결한다 (우 %.0f · 좌 %.0f · 중심 360)" % [xr, xl])

	# P12 는 기포 반전 프레임과 바늘 발사 프레임이 **같은 틱**이어야 인과가 배워진다.
	# 반전은 "아래로 가던 기포가 위로 돌아서는 것" 이다 — 처음부터 위로 나간 기포를 세면
	# t=0 이 반전으로 잡힌다(첫 시도에서 그렇게 틀렸다).
	BulletField.clear()
	var needle_tick := -1
	var reverse_tick := -1
	for t in Patterns.P12_EVERY:
		Patterns.p12(t, 360.0, 1150.0, 360.0, 1000.0)
		BulletField.step_and_collide(t, Vector2(-999, -999), Vector2(-999, -999), true)
		var max_vy := -99999.0
		for i in BulletField.n:
			if BulletField.kind[i] == Tune.Kind.NEEDLE and needle_tick < 0:
				needle_tick = t
			if BulletField.kind[i] == Tune.Kind.BUBBLE:
				max_vy = maxf(max_vy, BulletField.vel_y[i])
		# 가장 아래로 가던 기포조차 위로 돌아선 순간
		if reverse_tick < 0 and max_vy < 0.0 and BulletField.n > 0:
			reverse_tick = t
	_check(needle_tick >= 0 and reverse_tick >= 0 and absi(needle_tick - reverse_tick) <= 2,
		"P12 기포 반전 = 바늘 발사 (반전 t%d · 바늘 t%d)" % [reverse_tick, needle_tick])

	# P14 는 새 어휘 0개 — 이미 배운 세 문법의 합이다. 탄종이 기존 것만 나와야 한다.
	BulletField.clear()
	var kinds := {}
	for t in Patterns.P14_CYCLE:
		Patterns.p14(t, t, 360.0, 250.0, 360.0, 1000.0)
		for i in BulletField.n:
			kinds[BulletField.kind[i]] = true
	var novel := 0
	for k in kinds:
		if k == Tune.Kind.GATE or k == Tune.Kind.POD:
			novel += 1
	_check(kinds.size() >= 2 and novel == 0,
		"P14 에 새 어휘 0개 (탄종 %d 종 · 신규 표식 %d)" % [kinds.size(), novel])
	BulletField.clear()

# ── 보스 3페이즈 ────────────────────────────────────────────────────────
## 페이즈 전이는 "안전이 무엇으로 주어지는가" 가 바뀌는 지점이다.
## 전이가 벌이 되지 않아야 하고(P15 의 틈), 전이 중에는 발사가 없어야 한다.
func _boss_phase_cases() -> void:
	BulletField.clear()
	BulletField.reset_flow()
	var b := Boss.new()
	b.reset(0)
	var pl := Vector2(200.0, 900.0)

	# HP 를 깎아 P1 → P2 전이를 만든다
	b.damage(Boss.HP_MAX, 100, pl)
	_check(b.phase == 2 and b.gap_left > 0 and not b.done,
		"P1 → P2 전이 (페이즈 %d · 연출 %d틱)" % [b.phase, b.gap_left])
	# 전이 순간 P15 가 플레이어 방향에 틈을 연다
	var safe := atan2(pl.y - Boss.CY, pl.x - Boss.CX)
	var worst := PI
	for i in BulletField.n:
		var a := atan2(BulletField.vel_y[i], BulletField.vel_x[i])
		worst = minf(worst, absf(angle_difference(a, safe)))
	_check(BulletField.n > 0 and worst >= deg_to_rad(Patterns.P15_GAP_DEG) * 0.5 - 0.01,
		"전이가 벌이 되지 않는다 — 틈이 플레이어 방향 (%.1f°)" % rad_to_deg(worst))
	# 연출 중에는 대미지가 들어가지 않는다 — 고 DPS 가 P2 를 통째로 건너뛰는 것을 막는다.
	# **연출이 끝나기 전에** 확인해야 한다(끝난 뒤에 재면 당연히 들어간다).
	var hp0 := b.hp
	b.damage(9999.0, 101, pl)
	_check(is_equal_approx(b.hp, hp0) and b.phase == 2,
		"전이 연출 중 무적 (HP %.0f · 페이즈 %d · 잔여 %d틱)" % [b.hp, b.phase, b.gap_left])
	# 연출 중에는 발사도 없다
	var before := BulletField.n
	for t in Boss.PHASE_GAP:
		b.step(101 + t, pl)
	_check(BulletField.n == before,
		"전이 연출 중 발사 0 (탄 %d → %d)" % [before, BulletField.n])

	# P2 → P3 → 격파
	b.gap_left = 0
	b.damage(Boss.HP_MAX, 400, pl)
	_check(b.phase == 3, "P2 → P3 전이 (페이즈 %d)" % b.phase)
	b.gap_left = 0
	b.damage(Boss.HP_MAX, 700, pl)
	_check(b.done and b.done_reason == "hp", "P3 격파 (done %s · %s)" % [b.done, b.done_reason])

	# P2 의 전단 — 경계가 안전 통로여야 한다.
	# 경계에서 유속이 0 이고 위아래는 반대 부호여야 "허리선에서 산다" 가 성립한다.
	BulletField.clear()
	BulletField.reset_flow()
	var b2 := Boss.new()
	b2.reset(0)
	b2.phase = 2
	b2.phase_t0 = 0
	var seen := false
	for t in Boss.beat_len() * 4:
		b2.step(t, pl)
		if BulletField.shear > 0.5:
			seen = true
			var u_mid := BulletField.flow_u(Tune.SHEAR_Y, t)
			var u_top := BulletField.flow_u(Tune.SHEAR_Y - 260.0, t)
			var u_bot := BulletField.flow_u(Tune.SHEAR_Y + 260.0, t)
			_check(absf(u_mid) < 12.0 and u_top * u_bot < 0.0,
				"전단 — 경계 유속 %.1f · 상 %.0f · 하 %.0f (부호 반대)" % [u_mid, u_top, u_bot])
			break
		BulletField.step_and_collide(t, Vector2(-999, -999), Vector2(-999, -999), true)
	_check(seen, "P2 에 전단 구간이 있다")
	BulletField.reset_flow()
	BulletField.clear()


## 6구역 타임라인. 데이터가 틀리면 러너는 조용히 다른 스테이지를 재고,
## 그 숫자를 보고 내린 판정은 전부 무효가 된다.
func _stage_cases() -> void:
	var zs: Array = Stage.ZONES
	var sorted_z := true
	for i in range(1, zs.size()):
		if int(zs[i][0]) <= int(zs[i - 1][0]):
			sorted_z = false
	_check(int(zs[0][0]) == 0 and sorted_z, "구역 경계가 0 에서 시작해 증가한다")
	_check(zs.size() == Stage.ZONE_NAMES.size(), "구역 경계 수 = 구역 이름 수 (%d/%d)" % [
		zs.size(), Stage.ZONE_NAMES.size()])
	_check(int(zs[zs.size() - 1][0]) == Stage.BOSS_AT,
		"마지막 구역 시작 = 보스 진입 틱 (%d/%d)" % [int(zs[zs.size() - 1][0]), Stage.BOSS_AT])
	_check(Stage.STAGE_TICKS > Stage.BOSS_AT, "스테이지 길이 > 보스 진입 틱")

	var sorted_w := true
	var after_boss := 0
	var bad_kind := 0
	for i in Stage.STAGE_WAVES.size():
		var w: Array = Stage.STAGE_WAVES[i]
		if i > 0 and int(w[0]) < int(Stage.STAGE_WAVES[i - 1][0]):
			sorted_w = false
		if int(w[0]) >= Stage.BOSS_AT:
			after_boss += 1
		if (int(w[1]) < 0 or int(w[1]) > 7) and int(w[1]) != Stage.KIND_MIDBOSS:
			bad_kind += 1
	_check(sorted_w, "웨이브가 틱 순으로 정렬돼 있다 — main 의 커서가 단조 전진이라 역순은 조용히 버려진다")
	_check(after_boss == 0, "보스 진입 이후 웨이브 0 (%d)" % after_boss)
	_check(bad_kind == 0, "적 타입이 전부 유효 범위(0~7 + 중간보스 %d) — %d 건 위반" % [
		Stage.KIND_MIDBOSS, bad_kind])

	# zone_of 는 화면(HUD)·러너·보너스 판정이 공유한다. 경계 양쪽을 직접 확인한다.
	var bad_zone := 0
	for i in zs.size():
		var t := int(zs[i][0])
		if Stage.zone_of(t) != i:
			bad_zone += 1
		if t > 0 and Stage.zone_of(t - 1) != i - 1:
			bad_zone += 1
	_check(bad_zone == 0, "zone_of 가 경계 양쪽에서 맞다 (%d 건 위반)" % bad_zone)

	# 보상 회랑(구역 4)은 신규 적 0 이어야 한다 — 5분 런의 유일한 완전 재앵커 창이다.
	var rest := 0
	for w in Stage.STAGE_WAVES:
		if Stage.zone_of(int(w[0])) == 3:
			rest += 1
	_check(rest == 0, "보상 회랑에 신규 적 0 (%d)" % rest)

	# 보스 접근 구간의 플레이어 하한. 순간이동 없이 내려와야 한다.
	var main_s := Main.new()
	main_s.stage_full = true
	var prev := main_s._player_min_y(Stage.BOSS_AT - Main.BOSS_APPROACH - 1)
	var mono := true
	var max_step := 0.0
	for t in range(Stage.BOSS_AT - Main.BOSS_APPROACH - 1, Stage.BOSS_AT + 2):
		var y: float = main_s._player_min_y(t)
		if y < prev - 0.001:
			mono = false
		max_step = maxf(max_step, y - prev)
		prev = y
	main_s.free()
	_check(mono, "보스 접근 — 플레이어 하한이 단조 증가한다(되돌아가면 기체가 튄다)")
	_check(max_step < 2.0, "보스 접근 — 하한 이동이 틱당 %.2f유닛 (순간이동 없음)" % max_step)


## 중간보스 · 국소 소용돌이. 소용돌이는 조류장의 2번째 축이고 컷 후보 1순위라,
## "켜져 있는가" 보다 **"꺼지는가"** 를 더 많이 확인한다.
func _midboss_cases() -> void:
	# 1) 적분 루프의 인라인 식과 vortex_at 이 같은 값인가.
	#    둘이 갈라지면 화면의 줄무늬·바늘 방향이 실제 물과 어긋난다 — 몸을 못 믿게 된다.
	BulletField.clear()
	BulletField.reset_flow()
	BulletField.vortex_x = MidBoss.CX
	BulletField.vortex_y = MidBoss.CY
	BulletField.vortex_w = MidBoss.W_P2
	# 소용돌이 ON/OFF 두 번 돌려 **차이**를 본다. 한 번만 돌리면 전역 조류 이완분이
	# 섞여 들어와 0.055 의 오차로 나타난다 — 그건 소용돌이 오차가 아니다.
	var worst := 0.0
	for k in 8:
		var ang := TAU * float(k) / 8.0
		var r := 150.0 + 60.0 * float(k % 3)
		var px := MidBoss.CX + cos(ang) * r
		var py := MidBoss.CY + sin(ang) * r
		var d := PackedVector2Array()
		for w in [MidBoss.W_P2, 0.0]:
			BulletField.vortex_w = w
			BulletField.clear()
			BulletField.spawn(px, py, 0.0, 0.0, Tune.Kind.SPORE_TIDE)
			BulletField.step_and_collide(0, Vector2(360, 1200), Vector2(360, 1200), true)
			if BulletField.n < 1:
				worst = 9999.0
				break
			d.append(Vector2(BulletField.pos_x[0] - px, BulletField.pos_y[0] - py))
		if d.size() < 2:
			break
		BulletField.vortex_w = MidBoss.W_P2
		var want: Vector2 = BulletField.vortex_at(px, py) * Tune.DT
		worst = maxf(worst, (d[0] - d[1] - want).length())
	_check(worst < 0.001, "소용돌이 — 적분 루프와 vortex_at 이 같은 값 (최대 오차 %.4f)" % worst)

	# 1b) 조류 면역 탄(τ=∞)은 소용돌이도 안 탄다. 태우면 "조류 0%%" 표시가 거짓말이 되고,
	#     바늘은 생성 시 회전이 고정돼 있어 그림과 진로가 어긋난다.
	var imm := 0.0
	for kd in [Tune.Kind.NEEDLE, Tune.Kind.GATE]:
		BulletField.clear()
		var qx := MidBoss.CX + 150.0
		var qy := MidBoss.CY + 80.0
		BulletField.spawn(qx, qy, 0.0, 0.0, kd)
		BulletField.step_and_collide(0, Vector2(360, 1200), Vector2(360, 1200), true)
		if BulletField.n > 0:
			imm = maxf(imm, absf(BulletField.pos_x[0] - qx) + absf(BulletField.pos_y[0] - qy))
	_check(imm < 0.001, "조류 면역 탄은 소용돌이에 안 밀린다 (변위 %.4f)" % imm)

	# 2) 반경 밖은 정확히 0 이어야 한다. 꼬리가 남으면 화면 전체가 미세하게 돈다.
	var out := BulletField.vortex_at(MidBoss.CX + Tune.VORTEX_R + 0.5, MidBoss.CY)
	var edge := BulletField.vortex_at(MidBoss.CX + Tune.VORTEX_R - 0.5, MidBoss.CY)
	_check(out.length() < 0.0001 and edge.length() < 1.0,
		"소용돌이 — 반경 밖 0, 경계에서 연속 (밖 %.4f · 안 %.4f)" % [out.length(), edge.length()])
	BulletField.reset_flow()
	_check(BulletField.vortex_w == 0.0, "reset_flow 가 소용돌이를 끈다")
	BulletField.clear()

	# 3) P1 은 소용돌이를 쓰지 않는다 — 컷해도 P1 이 통째로 남아야 한다.
	var mb := MidBoss.new()
	mb.reset(0)
	var p1_any := false
	for t in MidBoss.P1_MAX_TICKS:
		if mb.vortex_w(t) != 0.0:
			p1_any = true
	_check(not p1_any, "중간보스 P1 은 전역 조류만 쓴다 (소용돌이 0)")

	# 4) P3 는 FLIP_EVERY 마다 부호가 뒤집힌다.
	mb.phase = 3
	mb.phase_t0 = 0
	var flips := 0
	var prev := mb.vortex_w(0)
	for t in range(1, MidBoss.P3_MAX_TICKS):
		var w := mb.vortex_w(t)
		if signf(w) != signf(prev):
			flips += 1
			_check(t % MidBoss.FLIP_EVERY == 0,
				"P3 반전이 %d틱 경계에서 일어난다 (t=%d)" % [MidBoss.FLIP_EVERY, t])
		prev = w
	_check(flips == MidBoss.P3_MAX_TICKS / MidBoss.FLIP_EVERY - 1,
		"P3 반전 횟수 %d (2.0초마다)" % flips)

	# 5) 격파하면 소용돌이가 꺼진다. 남으면 죽은 적이 계속 물을 돌린다.
	mb.reset(0)
	mb.phase = 3
	mb.phase_t0 = 0
	mb.step(10, Vector2(360, 1000))
	var spun: bool = BulletField.vortex_w != 0.0
	mb.damage(MidBoss.HP_MAX, 20, Vector2(360, 1000))
	_check(spun and mb.done and BulletField.vortex_w == 0.0,
		"중간보스 격파 — 소용돌이가 즉시 꺼진다 (생전 %s)" % ("돌았다" if spun else "안 돌았다"))
	BulletField.reset_flow()
	BulletField.clear()

	# 6) 전환 중 무적. 보스와 같은 규칙이다 — P15 가 화면을 비우는 동안 다음으로 넘어가면
	#    전환이 보상이 아니라 공짜 대미지 창이 된다.
	mb.reset(0)
	mb.damage(MidBoss.HP_MAX * 0.40, 30, Vector2(360, 1000))
	var ph2 := mb.phase
	var hp_before := mb.hp
	mb.damage(MidBoss.HP_MAX, 31, Vector2(360, 1000))
	_check(ph2 == 2 and mb.phase == 2 and mb.hp == hp_before,
		"중간보스 전환 중 무적 (페이즈 %d · HP %.0f→%.0f)" % [mb.phase, hp_before, mb.hp])

	# 7) 배정 시간에 들어가는가. 상한 합 + 전환 2회가 슬롯을 넘으면
	#    보상 회랑이 중간보스에게 먹힌다.
	var need := MidBoss.P1_MAX_TICKS + MidBoss.P2_MAX_TICKS + MidBoss.P3_MAX_TICKS \
			+ 2 * MidBoss.PHASE_GAP
	var slot := -1
	for w in Stage.STAGE_WAVES:
		if int(w[1]) == Stage.KIND_MIDBOSS:
			slot = int(w[5])
			_check(Stage.zone_of(int(w[0])) == 2, "중간보스가 구역 3 안에 있다")
			_check(int(w[0]) + slot <= int(Stage.ZONES[3][0]),
				"중간보스가 보상 회랑 전에 끝난다 (%d + %d ≤ %d)" % [
					int(w[0]), slot, int(Stage.ZONES[3][0])])
	_check(slot > 0 and need <= slot,
		"중간보스 시간 상한 합 %d ≤ 배정 %d" % [need, slot])


## RunLog 의 Android 경로. 패키지명이 export 프리셋과 갈라지면 로그가 **다른 앱의 자리에**
## 쓰이거나(권한 거부) 조용히 내부 저장소로 되돌아간다. 되돌아가면 release 에서 로그를
## 꺼낼 방법이 없어지고, 그때 남는 선택지는 "에디터에서 판정" 뿐이다 — 그게 틀린 판정이다.
func _runlog_cases() -> void:
	var f := FileAccess.open("res://export_presets.cfg", FileAccess.READ)
	if f == null:
		_check(false, "export_presets.cfg 를 읽을 수 없다")
		return
	var pkg := ""
	while not f.eof_reached():
		var line := f.get_line().strip_edges()
		if line.begins_with("package/unique_name="):
			pkg = line.split("=", true, 1)[1].strip_edges().trim_prefix("\"").trim_suffix("\"")
			break
	f.close()
	_check(pkg != "", "export 프리셋에서 package/unique_name 을 찾았다 (%s)" % pkg)
	_check(pkg == RunLog.ANDROID_PKG,
		"RunLog.ANDROID_PKG 가 export 프리셋과 같다 (%s / %s)" % [RunLog.ANDROID_PKG, pkg])
	_check(RunLog.ANDROID_DIR.ends_with("/files") and RunLog.ANDROID_DIR.contains(pkg),
		"RunLog 외부 경로가 앱 소유 디렉터리다 (%s)" % RunLog.ANDROID_DIR)


## 난이도 프로파일. 표 하나가 게임·러너·판정기를 전부 움직이므로, 표가 깨지면
## 조용히 다른 게임을 재고 그 숫자로 통과시킨다.
func _difficulty_cases() -> void:
	var keep := Difficulty.level
	var bad_sym := 0
	var bad_period := 0
	for lv in 4:
		var sg: Array = Difficulty.SEGS[lv]
		# 좌우 대칭이어야 한 주기 적분이 0 이 되고, 그래야 flow_phase 가 누산기 없이 닫힌다.
		if int(sg[0]) != int(sg[2]) or int(sg[1]) != int(sg[3]):
			bad_sym += 1
		Difficulty.apply(lv)
		var tot := 0
		for q in sg:
			tot += int(q)
		if Difficulty.period != tot:
			bad_period += 1
		# 램프가 세그먼트보다 길면 hold 가 음수가 되어 flow_c 가 구간 밖을 읽는다.
		if Difficulty.ramp >= mini(int(sg[0]), int(sg[1])):
			bad_period += 1
	_check(bad_sym == 0, "난이도 4단 전부 조류 세그먼트가 좌우 대칭 (%d 건 위반)" % bad_sym)
	_check(bad_period == 0, "난이도 4단 전부 주기 = 세그먼트 합 · 램프 < 세그먼트 (%d 건)" % bad_period)

	# 한 주기 적분 0 — 난이도마다 확인한다. 하나라도 깨지면 그 난이도에서 조류 띠가 드리프트한다.
	var worst := 0.0
	for lv in 4:
		Difficulty.apply(lv)
		worst = maxf(worst, absf(BulletField.flow_phase(Difficulty.period) - BulletField.flow_phase(0)))
	_check(worst < 0.001, "난이도 4단 전부 조류 위상 한 주기 적분 = 0 (최대 잔차 %.4f)" % worst)

	# 출시 2단(Normal·Hard)의 게이트 하한이 정밀도 하한보다 커야 한다.
	# 작으면 "통과 가능한 폭" 이 "엄지가 낼 수 있는 정밀도" 보다 좁다는 뜻이고, 그 게이트는 못 넘는다.
	var bad_floor := 0
	for lv in [Difficulty.Level.NORMAL, Difficulty.Level.HARD]:
		Difficulty.apply(lv)
		if Difficulty.free_floor() < 52:
			bad_floor += 1
	_check(bad_floor == 0, "출시 2단의 자유폭 하한 ≥ 엄지 정밀도 52 (%d 건 위반)" % bad_floor)

	# 헬퍼의 하한. every 가 0 이면 매 틱 발사가 되어 패턴이 벽이 된다.
	Difficulty.apply(Difficulty.Level.LUNATIC)
	_check(Difficulty.every(1) >= 1, "every() 하한 1 (%d)" % Difficulty.every(1))
	var odd := 0
	for b in [24, 25, 26, 27]:
		if Difficulty.count_even(b) % 2 != 0:
			odd += 1
	_check(odd == 0, "count_even() 이 항상 짝수 — P13 게이트 2개가 정반대에 있어야 한다")

	# 탄속 축은 꺼져 있다. 켜면 조류가 미는 시간이 줄어 난이도가 거꾸로 간다(실측).
	var all_one := true
	for v in Difficulty.SPEED_M:
		if absf(float(v) - 1.0) > 0.0001:
			all_one = false
	_check(all_one, "탄속 축은 1.0 으로 꺼져 있다 — 켜면 Hard 가 더 쉬워진다(축 분해 실측)")
	Difficulty.apply(keep)


## 보스 P2 전단 창이 **난이도와 무관하게 같은 길이**로 열리는가.
## 보스가 Tune.FLOW_SEGS(Normal 표)를 읽고 있어서 Hard 에서 창이 30틱이 아니라 7틱만
## 열렸다 — 전단이 이 페이즈의 전부인데 그게 난이도에서만 조용히 사라져 있었다.
func _shear_window_cases() -> void:
	var keep := Difficulty.level
	var bad := 0
	var report := PackedStringArray()
	for lv in [Difficulty.Level.NORMAL, Difficulty.Level.HARD]:
		Difficulty.apply(lv)
		BulletField.clear()
		BulletField.reset_flow()
		var b := Boss.new()
		b.reset(0)
		b.phase = 2
		b.phase_t0 = 0
		# 한 조류 주기만 본다. 주기당 정지 구간이 2개이므로 창도 2개여야 한다.
		var on := 0
		var edges := 0
		var prev := false
		var p := Vector2(360.0, 900.0)
		for t in Difficulty.period:
			b.step(t, p)
			var now: bool = BulletField.shear > 0.01
			if now:
				on += 1
			if now and not prev:
				edges += 1
			prev = now
		# 창 하나는 sin 램프라 양 끝 2틱이 0.01 미만이다 — 30틱 창에서 28틱을 센다.
		if edges != 2 or on < 50 or on > 60:
			bad += 1
		report.append("%s 창%d 틱%d" % [Difficulty.name_of(), edges, on])
		BulletField.reset_flow()
		BulletField.clear()
	_check(bad == 0, "보스 P2 전단 창이 난이도와 무관하게 주기당 2회·약 56틱 (%s)" % " · ".join(report))
	Difficulty.apply(keep)


## 중간보스 자전각은 **각속도의 적분**이어야 한다. w(t)·t 로 쓰면 P3 의 반전마다
## 누적각이 통째로 점프해 몸통 줄무늬가 순간이동한다 — 그 줄무늬가 "지금 물이 어느 쪽으로
## 도는가" 의 유일한 표시이므로, 순간이동하면 플레이어가 몸을 못 믿게 된다.
func _spin_cases() -> void:
	var keep := Difficulty.level
	Difficulty.apply(Difficulty.Level.NORMAL)
	var worst := 0.0
	var worst_t := -1
	for ph in [2, 3]:
		var mb := MidBoss.new()
		mb.reset(0)
		mb.phase = ph
		mb.phase_t0 = 0
		var prev := mb.spin_angle(0)
		for t in range(1, mb.phase_limit()):
			var a := mb.spin_angle(t)
			var d := absf(a - prev)
			if d > worst:
				worst = d
				worst_t = t
			prev = a
	# 한 틱의 각 변화 상한: 자전 0.35 + 소용돌이 0.6 = 0.95 rad/s → 0.0159 rad/틱.
	_check(worst < 0.02, "중간보스 자전각이 틱당 %.4f rad 이하로 연속이다 (최대 @t%d)" % [worst, worst_t])
	Difficulty.apply(keep)


## 탄종 개수만큼 길이를 가져야 하는 표들. 탄종이 4 → 6 으로 늘 때 main.gd 의
## 로그 이름 배열만 안 늘어서, 포낭·게이트에 죽으면 배열 밖 접근으로 _on_death 가
## 중단되고 게임이 영구 정지했다. 표 길이를 전부 여기서 묶는다.
func _table_cases() -> void:
	var tables := {
		"KIND_NAMES": Tune.KIND_NAMES.size(), "KIND_W": Tune.KIND_W.size(),
		"KIND_VIS_W": Tune.KIND_VIS_W.size(), "KIND_H": Tune.KIND_H.size(),
		"KIND_TAU": Tune.KIND_TAU.size(), "KIND_RING": Tune.KIND_RING.size(),
		"KIND_ACCEL": Tune.KIND_ACCEL.size(), "KIND_FUSE": Tune.KIND_FUSE.size(),
		"KIND_TRAIL": Tune.KIND_TRAIL.size(),
	}
	var bad := PackedStringArray()
	for k in tables:
		if int(tables[k]) != Tune.KIND_N:
			bad.append("%s=%d" % [k, int(tables[k])])
	_check(bad.is_empty(), "탄종 표 길이가 전부 KIND_N(%d) 과 같다 %s" % [
		Tune.KIND_N, "" if bad.is_empty() else "— 어긋남: " + ", ".join(bad)])

	# 모든 탄종으로 실제 피격 로그 인덱싱을 돌려 본다. 러너는 대부분 무적이라
	# 이 경로를 안 지나므로, 표 길이만 보지 말고 인덱싱 자체를 한 번 돌린다.
	var names := 0
	for k in Tune.KIND_N:
		if Tune.KIND_NAMES[k] != "":
			names += 1
	_check(names == Tune.KIND_N, "탄종 이름이 전부 비어 있지 않다 (%d/%d)" % [names, Tune.KIND_N])


## 화면 레이아웃. 버튼끼리 겹치거나 화면 밖으로 나가면 누를 수 없는 버튼이 생긴다 —
## 실제로 타이틀에서 두 번 겹쳤다(격자가 버튼을, 고친 뒤엔 격자가 제목을).
## 720×1280 과 889×1280(태블릿 expand 실측값), 720×1560(S25+) 세 비율을 전부 본다.
func _shell_cases() -> void:
	var keep := SaveData.seen_mask
	SaveData.seen_mask = 0b0000101101011011      # 절반쯤 찬 상태 — 빈/꽉 찬 화면은 둘 다 거짓말이다
	var sh := Shell.new()
	sh.main = null
	var bad := PackedStringArray()
	for size in [Vector2(720.0, 1280.0), Vector2(889.0, 1280.0), Vector2(720.0, 1560.0)]:
		sh.view_w = size.x
		sh.vh = size.y
		for scr in [Shell.Screen.TITLE, Shell.Screen.DIFF, Shell.Screen.LOG,
				Shell.Screen.PRACTICE, Shell.Screen.SETTINGS, Shell.Screen.PAUSE,
				Shell.Screen.RESULT]:
			sh.screen = scr
			sh._btns.clear()
			sh.layout()                   # 그리지 않고 히트박스만 — draw_* 는 트리 밖에서 에러다
			for i in sh._btns.size():
				var a: Rect2 = sh._btns[i][0]
				if a.position.y < 0.0 or a.end.y > size.y or a.end.x > size.x:
					bad.append("s%d scr%d 화면밖" % [int(size.y), scr])
				for j in range(i + 1, sh._btns.size()):
					if a.intersects(sh._btns[j][0] as Rect2):
						bad.append("s%dx%d scr%d 버튼 %d↔%d 겹침" % [
							int(size.x), int(size.y), scr, i, j])
	sh.free()
	SaveData.seen_mask = keep
	_check(bad.is_empty(), "화면 7종 × 비율 3종 — 버튼 겹침·화면밖 0 %s" % (
		"" if bad.is_empty() else "— " + ", ".join(bad)))


## 8단계 게이트: **소리를 완전히 끄고도 정확히 플레이되는가.**
## 조건은 하나다 — 소리가 시뮬에 영향을 주지 않아야 하고, 소리만 있는 정보가 없어야 한다.
## 앞쪽은 여기서 기계적으로 확인한다(같은 시드로 소리 ON/OFF 두 판이 틱 단위로 같은가).
## 뒤쪽은 코드 배치로 보장한다 — Audio.play 호출은 전부 main 의 **연출 경로**에 있고
## src/bullets · src/enemies · src/patterns 어디에도 없다. 그것도 여기서 확인한다.
func _audio_cases() -> void:
	# 러너는 main 을 안 띄우므로 직접 굽는다. 굽는 것 자체가 검사 대상이기도 하다 —
	# 기동 때 한 번 굽는 비용이 얼마인지도 같이 본다(실기 기동 지연에 직결된다).
	var t0 := Time.get_ticks_usec()
	Audio.setup(self)
	var bake_ms := float(Time.get_ticks_usec() - t0) / 1000.0
	_check(bake_ms < 400.0, "SFX 8종 + 루프 트랙 굽는 데 %.0f ms (기동 지연)" % bake_ms)
	var src := ["res://src/bullets/bullet_field.gd", "res://src/enemies/boss.gd",
			"res://src/enemies/midboss.gd", "res://src/enemies/enemy_field.gd",
			"res://src/patterns/patterns.gd", "res://src/input/touch_router.gd",
			"res://src/core/sim_clock.gd"]
	var dirty := PackedStringArray()
	for path in src:
		var f := FileAccess.open(path, FileAccess.READ)
		if f == null:
			continue
		if f.get_as_text().contains("Audio."):
			dirty.append(path.get_file())
		f.close()
	_check(dirty.is_empty(), "시뮬 코드에 Audio 호출 0 %s" % (
		"" if dirty.is_empty() else "— " + ", ".join(dirty)))

	# 소리 ON/OFF 가 시뮬을 바꾸지 않는가. 같은 시드로 두 판을 돌려 탄 상태를 비교한다.
	var sig := PackedFloat64Array()
	for on in [true, false]:
		Audio.set_enabled(on)
		BulletField.clear()
		BulletField.reset_flow()
		Difficulty.apply(Difficulty.Level.NORMAL)
		var b := Boss.new()
		b.reset(0)
		var p := Vector2(360.0, 1000.0)
		for t in 900:
			b.step(t, p)
			BulletField.step_and_collide(t, p, p, true)
		var acc := 0.0
		for i in BulletField.n:
			acc += float(BulletField.pos_x[i]) * 1.0 + float(BulletField.pos_y[i]) * 3.0
		sig.append(acc + float(BulletField.n) * 1000.0)
	Audio.set_enabled(SaveData.sound_on)
	BulletField.clear()
	BulletField.reset_flow()
	_check(absf(sig[0] - sig[1]) < 0.0001,
		"소리 ON/OFF 가 시뮬을 바꾸지 않는다 (%.1f / %.1f)" % [sig[0], sig[1]])

	# 구운 소리가 실제로 소리인가 — 길이 0 이나 무음이면 "껐다" 와 구분이 안 된다.
	var silent := PackedStringArray()
	for i in Audio.SFX_N:
		var w: AudioStreamWAV = Audio._streams[i] if Audio._streams.size() > i else null
		if w == null or w.data.size() < 1000:
			silent.append(str(i))
	# 실기에서 소리가 통째로 안 났다: main._ready 안에서 트리 루트에 직접 add_child 하면
	# "Parent node is busy setting up children" 으로 실패하고, 그 뒤 모든 play() 가
	# "Playback can only happen when a node is inside the scene tree" 로 죽는다.
	# call_deferred 로 붙이므로 **한 프레임 뒤에** 트리에 들어와 있어야 한다.
	await get_tree().process_frame
	var in_tree := 0
	for pl in Audio._players:
		if is_instance_valid(pl) and pl.is_inside_tree():
			in_tree += 1
	_check(in_tree == Audio.VOICES and Audio._music != null and Audio._music.is_inside_tree(),
		"오디오 노드가 한 프레임 뒤 트리에 들어와 있다 (%d/%d · 음악 %s)" % [
			in_tree, Audio.VOICES,
			"있음" if Audio._music != null and Audio._music.is_inside_tree() else "없음"])

	_check(silent.is_empty(), "SFX 8종이 전부 구워졌다 %s" % (
		"" if silent.is_empty() else "— 빈 것: " + ", ".join(silent)))
