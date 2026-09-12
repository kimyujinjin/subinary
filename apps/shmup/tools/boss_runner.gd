extends Node
## 보스 P1 헤드리스 측정 — 게임과 같은 Boss·Patterns·BulletField·Fairness·Corridor 를 쓴다.
## 링 각속도 ω × P05 탄속 격자를 50초씩 돌려, 공정성 게이트(fairness_runner 와 같은 정의)와
## 리듬 불변식(호흡 창 발사 0)을 본다. 자탄 없음 — 보스가 50초를 전부 채우는 최악 케이스.

const BANDS := [620.0, 860.0, 1100.0]
const HOLD_MIN := 24
const MOVE_CAP := 250.0
## 1D 도달 판정의 횡속도 예산 — 5칸/틱 = 300 u/s. 설계서 최대 요구 이동 250u/0.6s(≈417 u/s)
## 는 순간값이고, 이것은 전 구간 지속값이라 더 낮게 잡는다.
const V_BUDGET := 5
## 도달 집합의 가장 넓은 연속 구간 하한. 엄지 스윕 종점 오차 ±26유닛(설계서 §4) → 52.
const COMP_MIN := 52

var _fair: Fairness = null

func _ready() -> void:
	Difficulty.apply_from_cmdline()
	_fair = Fairness.new()
	print("== 성분별 진단 (ω 0.30 · 탄속 170) ==")
	print("  성분          | 최장min 통로min 유지min@t(창)        강제점프  peak  요구횡속 도달폭")
	for c in [["P05", true, false, false], ["P09", false, true, false], ["P03", false, false, true],
			["P05+P09", true, true, false], ["P05+P03", true, false, true], ["P09+P03", false, true, true],
			["전부", true, true, true]]:
		var r := _run(0.30, 170.0, c[1], c[2], c[3])
		print("  %-13s | %6d %6d %5d@t%-4d(%-10s) %6.0f   %4d  %6s  %5d" % [
			c[0], r[0], r[1], r[2], r[6], r[7], r[3], r[4],
			"%du/s" % (int(r[8]) * 60) if int(r[8]) > 0 else ">%d" % (V_MAX * 60), r[9]])
	print("")
	print("\n== 페이즈별 (각 페이즈 제한시간 · 자탄 없음) ==")
	print("  페이즈 | 최장min 도달폭min  peak  전단틱 | 판정 (횡속 예산 %d u/s)" % (V_BUDGET * 60))
	for ph in [1, 2, 3]:
		var r := _run_phase(ph)
		var flags := PackedStringArray()
		if int(r[3]) == 0:
			flags.append("FAIL:도달불가@t%d" % int(r[6]))
		elif int(r[4]) < COMP_MIN:
			flags.append("FAIL:정밀%d" % int(r[4]))
		if flags.is_empty():
			flags.append("OK")
		print("  P%d     | %6d %8d %5d %6d | %s" % [
			ph, r[0], r[4], r[2], r[5], " ".join(flags)])

	print("\n== 보스 P1 (50초 · 자탄 없음) ==")
	print("  ω    탄속 | 최장min 도달폭min 요구횡속 강제점프  peak  호흡발사 | 판정   (유지min 은 참고)")
	for om in [0.20, 0.30, 0.40]:
		for sp in [150.0, 170.0, 200.0]:
			var r := _run(om, sp)
			var flags := PackedStringArray()
			if int(r[0]) < Tune.FREE_FLOOR: flags.append("절대벽")
			if int(r[0]) < Tune.FREE_NORMAL: flags.append("F<64")
			if int(r[8]) < 0 or int(r[8]) > V_BUDGET: flags.append("횡속")
			if int(r[9]) < COMP_MIN: flags.append("정밀")
			if int(r[5]) > 0: flags.append("호흡")
			print("  %.2f %4.0f | %6d %8d %6s   %6.0f   %4d  %6d   | %-14s (%d)" % [
				om, sp, r[0], r[9], "%du/s" % (int(r[8]) * 60) if int(r[8]) > 0 else ">%d" % (V_MAX * 60),
				r[3], r[4], r[5], "OK" if flags.is_empty() else "FAIL:" + ",".join(flags), r[2]])
	var shots_needed := Boss.HP_MAX * (1.0 - Boss.P1_END_FRAC) / Tune.SHOT_DMG
	var per_sec := 2.0 * 60.0 / float(Tune.SHOT_PERIOD_TICKS)
	print("\n  코어 정렬 100%% 가정 시 70%% 도달: %.1f초 (자탄 %.0f발 · %.1f발/초) — 상한 50초" % [
		shots_needed / per_sec, shots_needed, per_sec])
	get_tree().quit(0)

## [최장min, 통로min, 유지min, 최대강제점프, peak, 호흡창발사]
const V_MAX := 10

## 요구 횡속도: 전 밴드에서 끝까지 살아남는 최소 v(칸/틱). 없으면 -1.
## 그리고 V_BUDGET 에서의 도달 집합 최소 연속폭.
func _reach(om: float, sp: float, e05: bool, e09: bool, e03: bool) -> Vector2i:
	var need := -1
	var comp_at_budget := 0
	for v in range(1, V_MAX + 1):
		var ok := true
		var comp := Tune.SCAN_CELLS
		for band in BANDS:
			BulletField.clear()
			var b := _boss(om, sp, e05, e09, e03)
			var rch := Reach1D.new()
			var p := Vector2(360.0, band)
			for t in Boss.P1_MAX_TICKS:
				b.step(t, p)
				BulletField.step_and_collide(t, p, p, true)
				_fair.scan(BulletField, p.x, p.y)
				rch.step_mask(rch.from_fairness(_fair), v, t)
				if not rch.alive:
					break
			if not rch.alive:
				ok = false
				break
			comp = mini(comp, rch.min_comp)
		if v == V_BUDGET:
			comp_at_budget = comp if ok else 0
		if ok and need < 0:
			need = v
		if need >= 0 and v >= V_BUDGET:
			break
	return Vector2i(need, comp_at_budget)

func _boss(om: float, sp: float, e05: bool, e09: bool, e03: bool) -> Boss:
	var b := Boss.new()
	b.omega = om
	b.p05_speed = sp
	b.emit_p05 = e05
	b.emit_p09 = e09
	b.emit_p03 = e03
	b.reset(0)
	return b

func _run(om: float, sp: float, e05 := true, e09 := true, e03 := true) -> Array:
	var min_gap := Tune.SCAN_CELLS
	var min_track := Tune.SCAN_CELLS
	var hold_min := 99999
	var jump := 0.0
	var peak := 0
	var breath_fire := 0
	var hold_tick := -1
	var hold_win := "-"
	for band in BANDS:
		BulletField.clear()
		var b := Boss.new()
		b.omega = om
		b.p05_speed = sp
		b.emit_p05 = e05
		b.emit_p09 = e09
		b.emit_p03 = e03
		b.reset(0)
		var cor := Corridor.new()
		var p := Vector2(360.0, band)
		for t in Boss.P1_MAX_TICKS:
			var before := BulletField.n
			b.step(t, p)
			if BulletField.n > before and b.window(t).x == 0:
				breath_fire += 1
			BulletField.step_and_collide(t, p, p, true)
			_fair.scan(BulletField, p.x, p.y)
			if _fair.in_band > 0:
				min_gap = mini(min_gap, _fair.gap_w)
			cor.update(_fair, p.x)
		peak = maxi(peak, BulletField.peak_n)
		min_track = mini(min_track, cor.min_width())
		var h: Array = cor.hold_times(Tune.FREE_NORMAL)
		if int(h[2]) > 0 and int(h[0]) < hold_min:
			hold_min = int(h[0])
			hold_tick = int(h[3])
			var w := b.window(hold_tick)
			hold_win = "%s%d y%d" % ["압" if w.x == 1 else "호", w.y, int(band)]
		jump = maxf(jump, cor.forced_jump)
	var rr := _reach(om, sp, e05, e09, e03)
	return [min_gap, min_track, hold_min, jump, peak, breath_fire, hold_tick, hold_win, rr.x, rr.y]

## 페이즈 하나를 격리해 측정한다. HP 를 강제로 그 페이즈에 두고 시간 만료까지 돌린다.
##
## v 스윕(1~10)은 하지 않는다 — P3 는 70초 × 3밴드라 스윕하면 수억 연산이 된다.
## 판정에 필요한 것은 "예산 안에서 사는가" 와 "그때 얼마나 정밀해야 하는가" 뿐이다.
## [최장min, 통로min, peak, 생존(1/0), 도달폭, 전단틱]
func _run_phase(ph: int) -> Array:
	var min_gap := Tune.SCAN_CELLS
	var min_track := Tune.SCAN_CELLS
	var peak := 0
	var shear_ticks := 0
	var comp := Tune.SCAN_CELLS
	var alive := 1
	var died := -1
	for band in BANDS:
		BulletField.clear()
		BulletField.reset_flow()
		var b := Boss.new()
		b.reset(0)
		b.phase = ph
		b.phase_t0 = 0
		var rch := Reach1D.new()
		var cor := Corridor.new()
		var p := Vector2(360.0, band)
		for t in b.phase_limit() - 1:
			b.step(t, p)
			if BulletField.shear > 0.01:
				shear_ticks += 1
			BulletField.step_and_collide(t, p, p, true)
			_fair.scan(BulletField, p.x, p.y)
			if _fair.in_band > 0:
				min_gap = mini(min_gap, _fair.gap_w)
			cor.update(_fair, p.x)
			rch.step_mask(rch.from_fairness(_fair), V_BUDGET, t)
			if not rch.alive:
				alive = 0
				died = t
				break
		peak = maxi(peak, BulletField.peak_n)
		min_track = mini(min_track, cor.min_width())
		if rch.alive:
			comp = mini(comp, rch.min_comp)
		else:
			comp = 0
	BulletField.reset_flow()
	BulletField.clear()
	return [min_gap, min_track, peak, alive, comp, shear_ticks / maxi(BANDS.size(), 1), died]
