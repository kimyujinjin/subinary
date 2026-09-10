extends Node
## 헤드리스 1D 공정성 스캔. 게임과 같은 BulletField·Patterns·EnemyField·Stage·Fairness 를
## 쓴다 — 별도 하네스를 만들면 게임과 갈라져서 틀린 숫자를 자신 있게 보고한다.
##
## 두 모드로 잰다:
##   A) 패턴 단독 — 진단용. 어느 패턴이 원인인지 가른다.
##   B) 웨이브 합성 — 실제 판정. 스테이지 공정성은 패턴 공정성이 아니다
##      (포자낭 2기가 겹치면 틈이 절반이 된다).
##
## 판정
## 모든 폭은 **자유 폭 F**(판정 반경만큼 부풀린 뒤 남는 폭)다. 설계서 값은 중심간 D 이고
## 포자 사이에서 F = D − 32 다(Tune 의 통과 폭 단위 주석). 출력은 F 로 하고 필요한 곳에 D 를 병기한다.
##
##   FAIL  자유 칸 0 (절대 벽)                          — 기하학적 하한 D 32. 어떤 조작으로도 불가능
##   FAIL  틈 < 88유닛인데 정지 창이 없음               — 직전 0.35초간 틈 중심 이동 ≤16유닛 규칙
##   WARN  F < 64 (D < 96)                              — Normal 하한 미달
##   FAIL  강제 전환 — 통로가 겹침 없이 사라져 점프를 강요                — 재앵커 불가
##   FAIL  통로 유지 시간 < 24틱(400ms) — 반응 시간 밑이라 인간이 통과할 수 없다
##   WARN  절대 벽 (자유 구간 0)
##
## 요구 이동량은 상한값으로만 출력하고 판정에 쓰지 않는다 — tools/corridor.gd 주석 참조.
##
## 최대 요구 이동량은 틈이 좁을 때만 센다. 400유닛짜리 틈의 중심을 쫓는 것은
## 요구가 아니므로, 그때 재면 아무 요구도 없는 구간에서 454 를 보고하는 지표가 된다.

const BANDS := [640.0, 860.0, 1040.0]
const TIGHT := 200          # 이 폭 미만일 때만 "요구 이동량"으로 센다
const STILL_GAP := Tune.FREE_STILL   # F 56 (D 88) 미만이면 정지 창 필수
const STILL_WIN := 21       # 0.35초
const STILL_MOVE := 16.0
const MOVE_WIN := 36        # 0.6초
const MOVE_CAP := 250.0
## 통로 최소 유지 시간. 반응 250~300ms + 엄지 전이 60~100ms → 24틱(400ms) 을 하한으로 둔다.
const HOLD_MIN := 24

var _fair: Fairness = null
var _fail := 0
var _warn := 0

func _ready() -> void:
	_fair = Fairness.new()
	print("== 1D 공정성 스캔 ==")
	print("   자유폭F: 하한=%d  Normal=%d  정지창=<%d/0.35s이동≤%d  요구이동상한=%d유닛/0.6s" % [
		Tune.FREE_FLOOR, Tune.FREE_NORMAL, STILL_GAP, int(STILL_MOVE), int(MOVE_CAP)])

	print("\n-- A) 패턴 단독 --")
	_scan("P01 적조 낙하", func(t: int, p: Vector2) -> void:
		Patterns.p01(t, 360.0, 220.0),
		Patterns.P01_VOLLEY_TICKS * Patterns.P01_VOLLEYS + 420)
	_scan("P03 직침", func(t: int, p: Vector2) -> void:
		Patterns.p03(t % EnemyField.NF_BURST_GAP,
			-60.0 + EnemyField.NF_SPEED * Tune.DT * float(t), 380.0, p.x, p.y),
		EnemyField.NF_BURST_GAP * 4)
	_scan("P07 조류 격자", func(t: int, p: Vector2) -> void:
		Patterns.p07(t, t, 360.0, 220.0), 900)

	print("\n-- B) 웨이브 합성 (실제 판정) --")
	var ef := EnemyField.new()
	_scan("30초 루프", func(t: int, p: Vector2) -> void:
		_waves(ef, t, p), Stage.LOOP_TICKS, ef)

	print("\n== 실패 %d · 경고 %d ==" % [_fail, _warn])
	get_tree().quit(1 if _fail > 0 else 0)

var _cursor := 0
func _waves(ef: EnemyField, tick: int, p: Vector2) -> void:
	if tick == 0:
		ef.clear()
		_cursor = 0
	while _cursor < Stage.WAVES.size():
		var w: Array = Stage.WAVES[_cursor]
		if int(w[0]) > tick:
			break
		var kind := int(w[1])
		var y0: float = -50.0 if kind == 0 else float(w[3])
		ef.spawn(tick, kind, float(w[2]), y0, float(w[3]), int(w[4]), int(w[5]), float(w[6]))
		_cursor += 1
	ef.step(tick, p)

func _scan(label: String, emit: Callable, ticks: int, ef: EnemyField = null) -> void:
	for band in BANDS:
		BulletField.clear()
		if ef != null:
			ef.clear()
		var p := Vector2(Tune.PF_W * 0.5, band)
		var gaps := PackedInt32Array()
		var flow_x := PackedFloat32Array()
		var flow_acc := 0.0
		var cor := Corridor.new()
		for t in ticks:
			emit.call(t, p)
			BulletField.step_and_collide(t, p, p, true)
			_fair.scan(BulletField, p.x, p.y)
			gaps.append(_fair.gap_w if _fair.in_band > 0 else -1)
			# 밴드에 탄이 없는 틱도 반드시 기록한다 — 건너뛰면 히스토리 인덱스가
			# 시간과 어긋나고 0.35초/0.6초 창 계산이 통째로 틀린다.
			cor.update(_fair, p.x)
			flow_x.append(flow_acc)
			flow_acc += BulletField.flow_u(p.y, t) * Tune.DT

		var min_gap := Tune.SCAN_CELLS
		var min_tick := -1
		var sum := 0
		var samples := 0
		var below_normal := 0
		var walls := 0
		var peak := BulletField.peak_n
		var min_track := cor.min_width()
		var still_viol := cor.still_violations(STILL_GAP, STILL_WIN, STILL_MOVE, flow_x)
		var max_move := cor.max_demand(MOVE_WIN, TIGHT)
		# 통로 유지 시간 — 통과 폭 이상으로 열려 있던 연속 구간
		var hold: Array = cor.hold_times(Tune.FREE_NORMAL)
		for t in ticks:
			var g := gaps[t]
			if g < 0:
				continue                    # 밴드에 탄이 없다
			samples += 1
			sum += g
			if g == 0:
				walls += 1
			if g < Tune.FREE_NORMAL:
				below_normal += 1
			if g < min_gap:
				min_gap = g
				min_tick = t
		if samples == 0:
			print("  %-14s y%4d : 밴드 도달 탄 0" % [label, int(band)])
			continue

		var flags := PackedStringArray()
		if min_gap < Tune.FREE_FLOOR:
			flags.append("FAIL:하한%d" % min_gap); _fail += 1
		if still_viol > 0:
			flags.append("FAIL:정지창%d@%s" % [still_viol,
				",".join(Array(cor.viol_ticks).slice(0, 6).map(func(x): return str(x)))])
			_fail += 1
		# 반응 시간 하한: 단순 시각 자극 반응 중앙값 250~300ms + 엄지 전이 60~100ms.
		# 통로가 그보다 짧게 열리면 폭이 충분해도 인간이 통과할 수 없다 —
		# 실기에서 모든 런이 8초에 끝났는데 사망 순간 최장 구간은 144~352유닛이었다.
		# 폭만 보는 지표는 그 상황을 통과시킨다.
		if int(hold[2]) > 0 and int(hold[0]) < HOLD_MIN:
			flags.append("FAIL:유지%d틱@t%d" % [int(hold[0]), int(hold[3])]); _fail += 1
		# 통로 간 이동 자체는 탄막의 정상 동작이다. 불공정한 것은 엄지 스윕이 낼 수 없는
		# 거리를 강요하는 것 — 그래서 점프 거리가 요구 이동 상한(250유닛)을 넘을 때만 실패다.
		if cor.forced > 0:
			if cor.forced_jump > MOVE_CAP:
				flags.append("FAIL:강제점프%.0fu" % cor.forced_jump); _fail += 1
			else:
				flags.append("전환%d(%.0fu)" % [cor.forced, cor.forced_jump])
		if walls > 0:
			flags.append("WARN:절대벽%d" % walls); _warn += 1
		if min_gap < Tune.FREE_NORMAL and min_gap >= Tune.FREE_FLOOR:
			flags.append("WARN:F<64"); _warn += 1
		if flags.is_empty():
			flags.append("OK")
		print("  %-14s y%4d : 최장min=%3d avg=%3d <64:%3d/%-4d 통로min=%3d 유지min=%2d@t%-4d p50=%3d(n%d) peak=%3d  %s" % [
			label, int(band), min_gap, sum / samples, below_normal, samples,
			min_track, int(hold[0]), int(hold[3]), int(hold[1]), int(hold[2]), peak, " ".join(flags)])
