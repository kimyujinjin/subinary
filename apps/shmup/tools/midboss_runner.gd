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
var _align := [1.0, 1.0, 1.0]      ## 소용돌이 ON 기준 실측 정렬률(킬타임 계산에 쓴다)
var _free := PackedByteArray()

func _ready() -> void:
	# **실제 세이브를 건드리지 않는다.** 러너는 패턴을 직접 호출하므로 mark() 가
	# _dirty 를 켜고, Main 을 띄우는 러너는 free() 때 save_now() 가 돌아
	# 최고점수·해금·무피격 기록을 0 으로 덮어쓴다(실측). 경고도 실패도 없이 사라진다.
	SaveData.reset_for_test("user://save-test-midboss_runner.json")
	Difficulty.apply_from_cmdline()
	Cast.apply_from_cmdline()
	_fair = Fairness.new()
	_free.resize(Tune.SCAN_CELLS)
	for a in OS.get_cmdline_user_args():
		if a == "--sweep":
			_sweep()
			return
		if a == "--p2-parts":
			_p2_parts()
			return
	print("== 중간보스 조류 방추체 ==")
	print("  소용돌이 반경 %.0f · P2 %.1f rad/s · P3 %.1f rad/s 를 %.1f초마다 반전" % [
		Tune.VORTEX_R, MidBoss.W_P2, MidBoss.W_P3, float(MidBoss.FLIP_EVERY) / 60.0])
	var fail := 0
	for on in [true, false]:
		print("\n-- 소용돌이 %s --" % ("ON" if on else "OFF (컷 시뮬레이션)"))
		print("  페이즈 | 최장min 도달폭min peak 정렬률 잔여피격 | 판정")
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
			elif int(r[0]) < Difficulty.free_floor():
				flags.append("WARN:F<%d" % Difficulty.free_floor())
			if flags.is_empty():
				flags.append("OK")
			if int(r[6]) > 0:
				flags.append("정렬률 무효(피격 %d)" % int(r[6]))
			if on:
				_align[ph - 1] = float(r[4])
			print("  P%d     | %6d %8d %5d %6.1f%% %6d | %s" % [
				ph, int(r[0]), int(r[2]), int(r[1]), float(r[4]) * 100.0,
				int(r[6]), " ".join(flags)])
	_killtime()
	print("\n== 실패 %d ==" % fail)
	get_tree().quit(1 if fail > 0 else 0)

## 정렬률은 여기서 **그리디 상한**으로만 쓴다 — 그리고 그 경로가 실제로 살아남는지
## 같이 센다. 안 세면 탄 안에 서 있는 채로 정렬률을 적립한 숫자가 나온다:
## `_pick` 은 예산 안에 자유 칸이 없으면 -1 을 돌려주고 호출부는 제자리에 둔다.
## killtime_runner 가 보스에서 겪은 바로 그 결함(강제피격 958회에 정렬 100%)이다.
## 피격이 0 이 아니면 그 정렬률은 달성 불가능한 값이므로 HP 유도에 쓰면 안 된다. — 몸통이 폭 84 짜리 세로 막대라
## 보스 코어(반경 70)와 달리 "중앙에 있으면 맞는다" 가 거의 항상 성립하기 때문이다.
## 보스처럼 후방 DP 를 돌리지 않는 이유는 페이즈가 8~10초로 짧아 갇힘의 영향이 작고,
## 그 짧은 구간에서 DP 와 그리디가 갈라지지 않는 것을 P1 에서 확인했다.
func _killtime() -> void:
	var per_sec := 2.0 * 60.0 / float(Tune.SHOT_PERIOD_TICKS)
	print("\n  킬타임 — %s · 자탄 %.1f발/초 × %.2f dmg = %.1f DPS (집중 %.1f)" % [
		Cast.pilot_name(), per_sec, Cast.shot_dmg(false), Cast.dps(), Cast.dps(true)])
	print("  페이즈 정렬률 | 킬타임 / 상한 | 판정")
	# **실측 정렬률로 계산한다.** 임의의 표(100/90/80/60%)를 찍으면 그 표가 게임의 숫자인지
	# 가정인지 구분이 안 되고, 실제로 HP 가 "정렬 100%" 라는 틀린 가정에서 유도됐었다.
	var total := 0.0
	for ph in [1, 2, 3]:
		var al: float = _align[ph - 1]
		var share := MidBoss.HP_MAX * (0.35 if ph < 3 else 0.30)
		var secs := share / maxf(al * Cast.dps(), 0.001)
		var cap := float(_cap(ph)) / 60.0
		total += secs
		print("   P%d %4.1f%% | %5.1f초 / 상한 %.0f초 | %s" % [ph, al * 100.0, secs, cap,
			"OK" if secs <= cap else "시간 상한으로 넘어간다"])
	print("  ─ 합계 %.1f초 + 전환 2회 2.0초 = %.1f초 · 배정 30초" % [total, total + 2.0])

func _cap(ph: int) -> int:
	if ph == 1:
		return MidBoss.P1_MAX_TICKS
	if ph == 2:
		return MidBoss.P2_MAX_TICKS
	return MidBoss.P3_MAX_TICKS

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

## P2 성분 분해. Hard·소용돌이 OFF 에서 간격을 어떻게 줘도 도달 불가가 나와서,
## 손잡이가 간격이 아니라는 것을 먼저 확인한다.
func _p2_parts() -> void:
	print("== 중간보스 P2 성분 분해 (%s · 소용돌이 OFF 기준) ==" % Difficulty.name_of())
	print("  성분            | ON 도달폭 peak | OFF 도달폭 peak")
	for c in [["P05 링만", true, false, false], ["P08 만", false, true, false],
			["P16 만", false, false, true], ["P05+P08", true, true, false],
			["P05+P16", true, false, true], ["전부", true, true, true]]:
		_only = [bool(c[1]), bool(c[2]), bool(c[3])]
		var a := _run_phase(2, true)
		var b := _run_phase(2, false)
		print("  %-14s | %9d %4d | %10d %4d" % [c[0], int(a[2]), int(a[1]), int(b[2]), int(b[1])])
	_only = []
	get_tree().quit(0)

var _only: Array = []

func _run_phase(ph: int, vortex_on: bool, p05e: int = 0, p11e: int = 0) -> Array:
	var min_gap := Tune.SCAN_CELLS
	var peak := 0
	var comp := Tune.SCAN_CELLS
	var alive := 1
	var died := -1
	var align := 0.0
	var hits := 0
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
		if _only.size() == 3:
			mb.emit_p05 = bool(_only[0])
			mb.emit_p08 = bool(_only[1])
			mb.emit_p16 = bool(_only[2])
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
		peak = maxi(peak, BulletField.peak_n)
		if rch.alive:
			comp = mini(comp, rch.min_comp)
		else:
			comp = 0
		# 정렬률은 **살아남는 경로 중 최대**를 후방 DP 로 구한다(tools/align_dp.gd).
		# 보스 러너와 같은 정의다 — 전방 그리디로 재면 탄 안에 서 있는 채로
		# 정렬 100%% 가 나오고(실측: 피격 63 · 갇힘 391틱), HP 가 그 숫자에서 유도된다.
		var mb2 := MidBoss.new()
		mb2.reset(0)
		mb2.vortex_on = vortex_on
		if p05e > 0:
			mb2.p05_every = p05e
		if p11e > 0:
			mb2.p11_every = p11e
		if _only.size() == 3:
			mb2.emit_p05 = bool(_only[0])
			mb2.emit_p08 = bool(_only[1])
			mb2.emit_p16 = bool(_only[2])
		mb2.phase = ph
		mb2.phase_t0 = 0
		var dp := AlignDP.new(_fair)
		dp.v_budget = V_BUDGET
		dp.target_x = MidBoss.CX
		dp.hit_half = HIT_HALF
		var dr := dp.measure(func(t: int, q: Vector2) -> void: mb2.step(t, q),
				mb2.phase_limit() - 1, band)
		align += float(dr["align"])
		hits += int(dr["hits"])
	BulletField.reset_flow()
	BulletField.clear()
	return [min_gap, peak, comp, alive, align / float(BANDS.size()), died, hits]
