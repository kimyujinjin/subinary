extends Node
## 킬타임 실측 — "보스전이 실제로 몇 초인가".
##
## 왜 필요한가: 페이즈는 HP 분기와 시간 상한 둘 중 먼저 오는 것으로 끊긴다. 그런데
## 자탄 DPS 15/s(집중 21/s) 로 HP 4200 을 깎으려면 정렬 100%% 여도 200~280초가 걸리는데
## 페이즈 시간 상한 합은 180초다 — HP 분기가 **한 번도 도달되지 않는다**.
## 그러면 플레이어의 사격이 전투 진행에 아무 영향을 주지 않고, 고리에 표시되는 HP 는 거짓말이 된다.
##
## 그래서 "끝까지 살아남는 경로 중 코어 정렬 볼리가 최대인 것" 을 실제로 구해 정렬률을 잰다.
##
##   A 생존 우선 그리디로 한 판 돌려 매 틱의 안전 마스크를 기록한다.
##   B 그 마스크 위에서 후방 DP 로 정렬 볼리 최대 경로를 푼다.
##     value[t][i] = free ? align(t,i) + max_{|j-i|<=v} value[t+1][j] : 죽음
##   C 그 경로를 실제 플레이어로 다시 시뮬레이션해 피격 0 을 확인한다.
##     보스 패턴 일부가 플레이어를 조준하므로 A 의 마스크와 C 의 탄이 갈라질 수 있다 —
##     갈라지면 숨기지 않고 그 수를 출력한다.
##
## 전방 그리디만으로는 안 된다: 코어에 붙어 있으려다 막다른 칸에 갇히고, 갇힌 것을
## "정렬 100%%" 로 보고한다(첫 판에서 실제로 그렇게 나왔다 — 강제피격 958회에 정렬 100%%).
## DP 경로는 완전정보 최적해이므로 여기서 나온 정렬률은 **상한**이다. 실제 플레이어는 이보다 낮다.

const BANDS := [620.0, 860.0, 1100.0]
const V_BUDGET := 5              # 300 u/s — 공정성 러너와 같은 예산
const HIT_HALF := Boss.R_CORE_HIT + Tune.SHOT_R     # 73 — 이 안에서 발사하면 명중

var _fair: Fairness = null
var _free := PackedByteArray()

func _ready() -> void:
	Difficulty.apply_from_cmdline()
	_fair = Fairness.new()
	_free.resize(Tune.SCAN_CELLS)
	print("== 킬타임 실측 (코어 정렬을 노리며 회피하는 경로) ==")
	print("  자탄 %.0f dmg × %.1f발/초 = %.0f DPS (집중 %.0f DPS)" % [
		Tune.SHOT_DMG, 2.0 * 60.0 / float(Tune.SHOT_PERIOD_TICKS),
		Tune.SHOT_DMG * 2.0 * 60.0 / float(Tune.SHOT_PERIOD_TICKS),
		Tune.SHOT_DMG * Tune.FOCUS_DMG_MULT * 2.0 * 60.0 / float(Tune.SHOT_PERIOD_TICKS)])
	print("  정렬률 = 살아남는 경로 중 코어 정렬 볼리가 최대인 것(고정점 반복). 잔여피격 0 이면 달성 가능하다.")
	print("  실제 플레이어는 완전정보가 없으므로 이보다 낮다 — 이것은 상한이다.")
	print("  페이즈 | 정렬률 잔여피격 반복 | DPS실효 | 소요 / 상한")
	var total := 0.0
	var frac_all := 0.0
	for ph in [1, 2, 3]:
		var r := _run_phase(ph)
		var align: float = r[0]
		var share := Boss.HP_MAX * _hp_share(ph)
		var cap := float(_cap(ph)) / 60.0
		var dps: float = align * Tune.SHOT_DMG * 2.0 * 60.0 / float(Tune.SHOT_PERIOD_TICKS)
		var secs: float = share / maxf(dps, 0.001)
		total += secs
		frac_all += align
		print("  P%d     | %5.1f%% %7d %4d | %6.1f  | %6.1f초 / %.0f초  %s" % [
			ph, align * 100.0, int(r[1]), int(r[2]), dps, secs, cap,
			"OK" if secs <= cap else "FAIL:HP분기 도달 불가"])
	var avg := frac_all / 3.0
	print("  ─ 합계 킬타임 %.0f초 (평균 정렬 %.1f%%) · 5분 스테이지의 보스 예산은 108초" % [
		total, avg * 100.0])
	print("  ─ 이 정렬률에서 108초에 맞는 HP = %.0f (현재 %.0f)" % [
		avg * Tune.SHOT_DMG * 2.0 * 60.0 / float(Tune.SHOT_PERIOD_TICKS) * 108.0, Boss.HP_MAX])
	get_tree().quit(0)

func _hp_share(ph: int) -> float:
	if ph == 1:
		return 1.0 - Boss.P1_END_FRAC
	if ph == 2:
		return Boss.P1_END_FRAC - Boss.P2_END_FRAC
	return Boss.P2_END_FRAC

func _cap(ph: int) -> int:
	if ph == 1:
		return Boss.P1_MAX_TICKS
	if ph == 2:
		return Boss.P2_MAX_TICKS
	return Boss.P3_MAX_TICKS

func _boss(ph: int) -> Boss:
	var b := Boss.new()
	b.reset(0)
	b.phase = ph
	b.phase_t0 = 0
	return b

## 정렬 최대 경로는 tools/align_dp.gd 가 구한다 — 중간보스 러너와 **같은 정의**를 쓴다.
## 각자 들고 있으면 한쪽만 고치게 되고, 실제로 중간보스 쪽이 전방 그리디로 남아
## "탄 안에 서 있는 채로 정렬 100%%" 를 보고했다.
## [정렬률, 잔여피격, 반복횟수]
func _run_phase(ph: int) -> Array:
	var align := 0.0
	var hits := 0
	var iters := 0
	for band in BANDS:
		var b := _boss(ph)
		var dp := AlignDP.new(_fair)
		dp.v_budget = V_BUDGET
		dp.target_x = Boss.CX
		dp.hit_half = HIT_HALF
		var r := dp.measure(func(t: int, p: Vector2) -> void: b.step(t, p), b.phase_limit() - 1, band)
		align += float(r["align"])
		hits += int(r["hits"])
		iters = maxi(iters, int(r["iters"]))
	BulletField.reset_flow()
	BulletField.clear()
	return [align / float(BANDS.size()), hits, iters]
