extends Node
## 중간보스 실측 — 페이즈별 공정성 + 킬타임, 그리고 **소용돌이를 껐을 때도 성립하는가**.
##
## 마지막 항목이 이 러너의 존재 이유다. 설계서가 국소 소용돌이를 컷 후보 1순위로
## 지목했으므로, 컷 결정을 내릴 때 "끄면 무엇이 깨지는가" 를 추측이 아니라 숫자로 알아야 한다.
## 두 열을 나란히 낸다 — 소용돌이 ON / OFF.

const BANDS := [640.0, 860.0, 1040.0]
const V_BUDGET := 5
const COMP_MIN := 52
const HIT_HALF := MidBoss.HIT_HALF_W + Tune.SHOT_R

var _fair: Fairness = null
var _free := PackedByteArray()

func _ready() -> void:
	_fair = Fairness.new()
	_free.resize(Tune.SCAN_CELLS)
	for a in OS.get_cmdline_user_args():
		if a == "--sweep":
			_sweep()
			return
	print("== 중간보스 조류 방추체 ==")
	print("  소용돌이 반경 %.0f · P2 %.1f rad/s · P3 %.1f rad/s 를 %.1f초마다 반전" % [
		Tune.VORTEX_R, MidBoss.W_P2, MidBoss.W_P3, float(MidBoss.FLIP_EVERY) / 60.0])
	var fail := 0
	for on in [true, false]:
		print("\n-- 소용돌이 %s --" % ("ON" if on else "OFF (컷 시뮬레이션)"))
		print("  페이즈 | 최장min 도달폭min peak 정렬률 | 판정")
		for ph in [1, 2, 3]:
			var r := _run_phase(ph, on)
			var flags := PackedStringArray()
			if int(r[3]) == 0:
				flags.append("FAIL:도달불가@t%d" % int(r[5]))
				fail += 1
			elif int(r[2]) < COMP_MIN:
				flags.append("FAIL:정밀%d" % int(r[2]))
				fail += 1
			if int(r[0]) < Tune.FREE_FLOOR:
				flags.append("FAIL:절대벽")
				fail += 1
			elif int(r[0]) < Tune.FREE_NORMAL:
				flags.append("WARN:F<%d" % Tune.FREE_NORMAL)
			if flags.is_empty():
				flags.append("OK")
			print("  P%d     | %6d %8d %5d %6.1f%% | %s" % [
				ph, int(r[0]), int(r[2]), int(r[1]), float(r[4]) * 100.0, " ".join(flags)])
	_killtime()
	print("\n== 실패 %d ==" % fail)
	get_tree().quit(1 if fail > 0 else 0)

## 정렬률은 여기서 **그리디 상한**으로만 쓴다 — 몸통이 폭 84 짜리 세로 막대라
## 보스 코어(반경 70)와 달리 "중앙에 있으면 맞는다" 가 거의 항상 성립하기 때문이다.
## 보스처럼 후방 DP 를 돌리지 않는 이유는 페이즈가 8~10초로 짧아 갇힘의 영향이 작고,
## 그 짧은 구간에서 DP 와 그리디가 갈라지지 않는 것을 P1 에서 확인했다.
func _killtime() -> void:
	var per_sec := 2.0 * 60.0 / float(Tune.SHOT_PERIOD_TICKS)
	print("\n  킬타임 — 자탄 %.1f발/초 × %.0f dmg" % [per_sec, Tune.SHOT_DMG])
	print("  정렬률 | 킬타임 | 배정 30초(1800틱) 대비")
	for al in [1.0, 0.9, 0.8, 0.6]:
		var secs := MidBoss.HP_MAX / maxf(al * per_sec * Tune.SHOT_DMG, 0.001)
		print("   %4.0f%% | %5.1f초 | %s" % [al * 100.0, secs,
			"OK" if secs <= 28.0 else "시간 상한으로 넘어간다"])

## [최장min, peak, 도달폭min, 생존, 정렬률, 사망틱]
## 손잡이 스윕. 판정은 **소용돌이 OFF** 기준으로 한다 — 컷 후보가 공정성을 떠받치면
## 컷할 수 없고, 그러면 그것은 더 이상 컷 후보가 아니다.
func _sweep() -> void:
	print("== 중간보스 손잡이 스윕 (판정은 소용돌이 OFF 기준) ==")
	print("  P2 — p05 간격 | ON 도달폭 peak | OFF 도달폭 peak")
	for e in [30, 40, 50, 60]:
		var a := _run_phase(2, true, e, 18)
		var b := _run_phase(2, false, e, 18)
		print("  %12d | %9d %4d | %10d %4d" % [e, int(a[2]), int(a[1]), int(b[2]), int(b[1])])
	print("  P3 — p11 간격 | ON 도달폭 peak | OFF 도달폭 peak")
	for e in [18, 27, 36, 45]:
		var a := _run_phase(3, true, 30, e)
		var b := _run_phase(3, false, 30, e)
		print("  %12d | %9d %4d | %10d %4d" % [e, int(a[2]), int(a[1]), int(b[2]), int(b[1])])
	get_tree().quit(0)

func _run_phase(ph: int, vortex_on: bool, p05e: int = 0, p11e: int = 0) -> Array:
	var min_gap := Tune.SCAN_CELLS
	var peak := 0
	var comp := Tune.SCAN_CELLS
	var alive := 1
	var died := -1
	var vol := 0
	var hit := 0
	for band in BANDS:
		BulletField.clear()
		BulletField.reset_flow()
		var mb := MidBoss.new()
		mb.reset(0)
		mb.vortex_on = vortex_on
		if p05e > 0:
			mb.p05_every = p05e
		if p11e > 0:
			mb.p11_every = p11e
		mb.phase = ph
		mb.phase_t0 = 0
		var rch := Reach1D.new()
		var p := Vector2(MidBoss.CX, band)
		for t in mb.phase_limit() - 1:
			mb.step(t, p)
			BulletField.step_and_collide(t, p, p, true)
			_fair.scan(BulletField, p.x, p.y)
			if _fair.in_band > 0:
				min_gap = mini(min_gap, _fair.gap_w)
			rch.step_mask(rch.from_fairness(_fair), V_BUDGET, t)
			if not rch.alive:
				alive = 0
				died = t
				break
			# 살아 있는 칸 중 몸통에 가장 가까운 곳으로 — 정렬률 상한
			var nx := _pick(int(round(p.x)))
			if nx >= 0:
				p.x = float(nx)
			if t % Tune.SHOT_PERIOD_TICKS == 0:
				for sc in [-Tune.SHOT_COL_HALF, Tune.SHOT_COL_HALF]:
					vol += 1
					if absf(p.x + sc - MidBoss.CX) <= HIT_HALF:
						hit += 1
		peak = maxi(peak, BulletField.peak_n)
		if rch.alive:
			comp = mini(comp, rch.min_comp)
		else:
			comp = 0
	BulletField.reset_flow()
	BulletField.clear()
	return [min_gap, peak, comp, alive, float(hit) / maxf(float(vol), 1.0), died]

func _pick(cx: int) -> int:
	var n := Tune.SCAN_CELLS
	var acc := 0
	for i in n:
		acc += _fair.diff[i]
		_free[i] = 1 if (acc == 0 or _fair.in_band == 0) else 0
	var target := int(round(MidBoss.CX))
	var best := -1
	var best_d := 1 << 30
	for i in range(maxi(0, cx - V_BUDGET), mini(n - 1, cx + V_BUDGET) + 1):
		if _free[i] == 0:
			continue
		var d: int = absi(i - target)
		if d < best_d:
			best_d = d
			best = i
	return best
