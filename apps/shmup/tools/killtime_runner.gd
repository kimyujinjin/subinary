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
const MARGIN_CELLS := 4          # 벽에 붙지 않는다. 32유닛 여유를 우선한다
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

## A 생존 그리디로 마스크 기록 → B 후방 DP → C 재생. 재생에서 피격이 나면
## 그 재생의 마스크로 다시 B 를 푼다(고정점 반복). 조준 패턴 때문에 탄의 미래가
## 플레이어 경로에 의존하므로, 한 번에 푼 경로는 자기 자신이 만든 탄에 맞는다.
## ITER 회 안에 피격 0 이 안 되면 그 수를 그대로 출력한다 — 숨기면 정렬률이 거짓이 된다.
## [정렬률, 잔여피격, 반복횟수]
const ITER := 4

func _run_phase(ph: int) -> Array:
	var vol := 0
	var hit := 0
	var bad := 0
	var iters := 0
	for band in BANDS:
		var ticks := _boss(ph).phase_limit() - 1
		var masks := _record(ph, band, ticks)
		var v := 0
		var h := 0
		var bd := 0
		for it in ITER:
			iters = maxi(iters, it + 1)
			var path := _solve(masks, ticks)
			var r := _verify(ph, band, path, ticks)
			v = int(r[0])
			h = int(r[1])
			bd = int(r[2])
			masks = r[3]
			if bd == 0:
				break
		vol += v
		hit += h
		bad += bd
	return [float(hit) / maxf(float(vol), 1.0), bad, iters]

func _boss(ph: int) -> Boss:
	var b := Boss.new()
	b.reset(0)
	b.phase = ph
	b.phase_t0 = 0
	return b

## A. 생존만 보는 그리디로 돌리며 매 틱 안전 마스크를 기록한다.
func _record(ph: int, band: float, ticks: int) -> PackedByteArray:
	BulletField.clear()
	BulletField.reset_flow()
	var b := _boss(ph)
	var p := Vector2(Boss.CX, band)
	var out := PackedByteArray()
	out.resize(ticks * Tune.SCAN_CELLS)
	for t in ticks:
		b.step(t, p)
		BulletField.step_and_collide(t, p, p, true)
		_fair.scan(BulletField, p.x, p.y)
		_mask()
		for i in Tune.SCAN_CELLS:
			out[t * Tune.SCAN_CELLS + i] = _free[i]
		# 생존 우선: 예산 안에서 여유가 가장 큰 칸으로. 동률이면 덜 움직인다.
		var cx := int(round(p.x))
		var best := cx
		var best_m := -1
		var best_d := 1 << 30
		for i in range(maxi(0, cx - V_BUDGET), mini(Tune.SCAN_CELLS - 1, cx + V_BUDGET) + 1):
			if _free[i] == 0:
				continue
			var m := _margin(i)
			var d: int = absi(i - cx)
			if m > best_m or (m == best_m and d < best_d):
				best_m = m
				best_d = d
				best = i
		p.x = float(best)
	BulletField.reset_flow()
	BulletField.clear()
	return out

## B. 후방 DP. 죽는 칸은 -1 로 두고, 슬라이딩 윈도우 최대로 O(칸수) 에 푼다.
func _solve(masks: PackedByteArray, ticks: int) -> PackedInt32Array:
	var n := Tune.SCAN_CELLS
	var dead := -1_000_000
	var val := PackedInt32Array()
	val.resize(ticks * n)
	var nxt := PackedInt32Array()
	nxt.resize(n)
	var cur := PackedInt32Array()
	cur.resize(n)
	for i in n:
		nxt[i] = 0 if masks[(ticks - 1) * n + i] == 1 else dead
	for i in n:
		val[(ticks - 1) * n + i] = nxt[i]
	var win := PackedInt32Array()          # 감소 덱(인덱스)
	win.resize(n)
	for t in range(ticks - 2, -1, -1):
		# max_{j in [i-v, i+v]} nxt[j]
		var head := 0
		var tail := 0
		var wi := 0
		for i in n:
			while wi <= mini(n - 1, i + V_BUDGET):
				while tail > head and nxt[win[tail - 1]] <= nxt[wi]:
					tail -= 1
				win[tail] = wi
				tail += 1
				wi += 1
			while win[head] < i - V_BUDGET:
				head += 1
			var m := nxt[win[head]]
			if masks[t * n + i] == 0 or m <= dead:
				cur[i] = dead
			else:
				cur[i] = m + _align_gain(t, i)
		for i in n:
			nxt[i] = cur[i]
			val[t * n + i] = cur[i]
	# 시작은 중앙. 중앙이 죽는 칸이면 살아 있는 칸 중 가장 가까운 곳에서 시작한다.
	var path := PackedInt32Array()
	path.resize(ticks)
	var x := int(round(Boss.CX))
	if val[x] <= dead:
		var f := -1
		for d in n:
			for sgn: int in [-1, 1]:
				var c: int = x + d * sgn
				if c >= 0 and c < n and val[c] > dead:
					f = c
					break
			if f >= 0:
				break
		x = maxi(f, 0)
	path[0] = x
	for t in range(1, ticks):
		var best := x
		var best_v := dead
		for i in range(maxi(0, x - V_BUDGET), mini(n - 1, x + V_BUDGET) + 1):
			var v := val[t * n + i]
			if v > best_v:
				best_v = v
				best = i
		x = best
		path[t] = x
	return path

## 이 틱 이 칸에서 발사하면 코어에 걸리는 열 수(0~2). 볼리 틱이 아니면 0.
func _align_gain(t: int, i: int) -> int:
	if t % Tune.SHOT_PERIOD_TICKS != 0:
		return 0
	var g := 0
	for s in [-Tune.SHOT_COL_HALF, Tune.SHOT_COL_HALF]:
		if absf(float(i) + s - Boss.CX) <= HIT_HALF:
			g += 1
	return g

## C. DP 경로를 실제 플레이어로 재생한다. 조준 패턴이 있으면 A 의 마스크와 갈라지므로
## 여기서 실제 피격을 센다 — 0 이 아니면 그 정렬률은 달성 불가능한 상한이다.
func _verify(ph: int, band: float, path: PackedInt32Array, ticks: int) -> Array:
	BulletField.clear()
	BulletField.reset_flow()
	var b := _boss(ph)
	var p := Vector2(float(path[0]), band)
	var prev := p
	var vol := 0
	var hit := 0
	var bad := 0
	var seen := {}
	var out := PackedByteArray()
	out.resize(ticks * Tune.SCAN_CELLS)
	for t in ticks:
		b.step(t, p)
		prev = p
		p.x = float(path[t])
		BulletField.step_and_collide(t, prev, p, false)
		_fair.scan(BulletField, p.x, p.y)
		_mask()
		for i in Tune.SCAN_CELLS:
			out[t * Tune.SCAN_CELLS + i] = _free[i]
		if BulletField.hit_bid != 0:
			# 틱이 아니라 탄으로 센다 — 무적을 끄고 재생하므로 같은 탄이 여러 틱 걸린다
			if not seen.has(BulletField.hit_bid):
				seen[BulletField.hit_bid] = true
				bad += 1
			BulletField.hit_bid = 0
		if t % Tune.SHOT_PERIOD_TICKS == 0:
			for s in [-Tune.SHOT_COL_HALF, Tune.SHOT_COL_HALF]:
				vol += 1
				if absf(p.x + s - Boss.CX) <= HIT_HALF:
					hit += 1
	BulletField.reset_flow()
	BulletField.clear()
	return [vol, hit, bad, out]

func _mask() -> void:
	var acc := 0
	for i in Tune.SCAN_CELLS:
		acc += _fair.diff[i]
		_free[i] = 1 if (acc == 0 or _fair.in_band == 0) else 0

## 이 칸에서 가장 가까운 위험 칸까지의 거리(칸). MARGIN_CELLS 를 넘으면 조기 종료한다.
func _margin(i: int) -> int:
	for d in range(1, MARGIN_CELLS + 1):
		var a := i - d
		var b := i + d
		if a < 0 or b >= Tune.SCAN_CELLS or _free[a] == 0 or _free[b] == 0:
			return d - 1
	return MARGIN_CELLS
