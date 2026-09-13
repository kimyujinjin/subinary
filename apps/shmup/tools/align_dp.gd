class_name AlignDP
## "살아남는 경로 중 목표 x 에 정렬된 볼리가 최대인 것" 을 구한다.
##
## 보스와 중간보스가 **같은 정의**를 써야 한다. 중간보스 러너가 이 계산 없이 전방 그리디로
## 재다가 "탄 안에 서 있는 채로 정렬률 100%%" 를 보고했고, 그 숫자에서 HP_MAX 가 유도됐다 —
## killtime_runner 가 보스에서 겪고 헤더에 적어 둔 결함을 중간보스에서 그대로 반복한 것이다.
##
## 절차:
##   A 생존 우선 그리디로 한 판 돌려 매 틱의 안전 마스크를 기록한다.
##   B 그 마스크 위에서 후방 DP 로 정렬 볼리 최대 경로를 푼다.
##       value[t][i] = free ? align(t,i) + max_{|j-i|<=v} value[t+1][j] : 죽음
##   C 그 경로를 실제 플레이어로 재생해 피격 0 을 확인한다. 조준 패턴이 있으면 A 의 마스크와
##     갈라지므로, 갈라지면 그 재생의 마스크로 다시 B 를 푼다(고정점 반복).
##
## 전방 그리디만으로는 안 된다: 코어에 붙어 있으려다 막다른 칸에 갇히고, 갇힌 것을
## "정렬 100%%" 로 보고한다. 여기서 나오는 정렬률은 완전정보 최적해이므로 **상한**이다.

const MARGIN_CELLS := 4          ## 벽에 붙지 않는다. 32유닛 여유를 우선한다
const ITER := 4                  ## 고정점 반복 상한

var _fair: Fairness = null
var _free := PackedByteArray()
var v_budget: int = 5
var target_x: float = 360.0
var hit_half: float = 73.0
var shot_period: int = 8

func _init(fair: Fairness) -> void:
	_fair = fair
	_free.resize(Tune.SCAN_CELLS)

## step: func(t: int, p: Vector2) -> void — 그 틱의 이미터를 진행시킨다.
## 반환: {"align": 0..1, "hits": 잔여피격, "iters": 반복횟수}
func measure(step: Callable, ticks: int, band: float) -> Dictionary:
	var masks := _record(step, ticks, band)
	var v := 0
	var h := 0
	var bd := 0
	var it := 0
	for k in ITER:
		it = k + 1
		var path := _solve(masks, ticks)
		var r := _verify(step, path, ticks, band)
		v = int(r[0]); h = int(r[1]); bd = int(r[2]); masks = r[3]
		if bd == 0:
			break
	return {"align": float(h) / maxf(float(v), 1.0), "hits": bd, "iters": it}


func _record(step: Callable, ticks: int, band: float) -> PackedByteArray:
	BulletField.clear()
	BulletField.reset_flow()
	var p := Vector2(target_x, band)
	var out := PackedByteArray()
	out.resize(ticks * Tune.SCAN_CELLS)
	for t in ticks:
		step.call(t, p)
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
		for i in range(maxi(0, cx - v_budget), mini(Tune.SCAN_CELLS - 1, cx + v_budget) + 1):
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
			while wi <= mini(n - 1, i + v_budget):
				while tail > head and nxt[win[tail - 1]] <= nxt[wi]:
					tail -= 1
				win[tail] = wi
				tail += 1
				wi += 1
			while win[head] < i - v_budget:
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
	var x := int(round(target_x))
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
		for i in range(maxi(0, x - v_budget), mini(n - 1, x + v_budget) + 1):
			var v := val[t * n + i]
			if v > best_v:
				best_v = v
				best = i
		x = best
		path[t] = x
	return path

func _align_gain(t: int, i: int) -> int:
	if t % shot_period != 0:
		return 0
	var g := 0
	for s in [-Tune.SHOT_COL_HALF, Tune.SHOT_COL_HALF]:
		if absf(float(i) + s - target_x) <= hit_half:
			g += 1
	return g

## C. DP 경로를 실제 플레이어로 재생한다. 조준 패턴이 있으면 A 의 마스크와 갈라지므로

func _verify(step: Callable, path: PackedInt32Array, ticks: int, band: float) -> Array:
	BulletField.clear()
	BulletField.reset_flow()
	var p := Vector2(float(path[0]), band)
	var prev := p
	var vol := 0
	var hit := 0
	var bad := 0
	var seen := {}
	var out := PackedByteArray()
	out.resize(ticks * Tune.SCAN_CELLS)
	for t in ticks:
		step.call(t, p)
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
		if t % shot_period == 0:
			for s in [-Tune.SHOT_COL_HALF, Tune.SHOT_COL_HALF]:
				vol += 1
				if absf(p.x + s - target_x) <= hit_half:
					hit += 1
	BulletField.reset_flow()
	BulletField.clear()
	return [vol, hit, bad, out]

func _mask() -> void:
	var acc := 0
	for i in Tune.SCAN_CELLS:
		acc += _fair.diff[i]
		_free[i] = 1 if (acc == 0 or _fair.in_band == 0) else 0

func _margin(i: int) -> int:
	for d in range(1, MARGIN_CELLS + 1):
		var a := i - d
		var b := i + d
		if a < 0 or b >= Tune.SCAN_CELLS or _free[a] == 0 or _free[b] == 0:
			return d - 1
	return MARGIN_CELLS
