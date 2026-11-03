class_name Fairness
## 1D 공정성 스캔. 세로 스크롤에서 실제로 필요한 판정은
## "플레이어의 y 밴드에서 x 축 자유 구간의 최댓값"이다.
##
## (x, y, t) 시간확장 격자의 도달가능성 BFS 는 GDScript 로 처음 짜는 탐색이고
## 틀려도 "통과했다"고 보고하는 종류의 도구라 넣지 않는다. 이 1D 스캔은
## 절대 벽(자유 구간 0)과 숨 막히는 구간(< 임계)을 전부 잡고, 최대 요구 이동량도
## 같은 배열에서 공짜로 나온다.
##
## 셀 단위 마킹(탄당 최대 33회 루프) 대신 차분 배열을 쓴다 —
## O(탄 × 폭) 이 O(탄 + 셀) 이 되고, 400탄 구간에서 12배 차이가 난다.
## 매 틱 도는 코드라 이 차이가 그대로 프레임타임이다.

var diff := PackedInt32Array()
var gap_w: int = 0          ## 최장 자유 구간 폭 (유닛)
var gap_x0: int = 0         ## 그 구간의 좌단
var gap_center: float = 0.0
var in_band: int = 0        ## 밴드에 있던 탄 수 — 0 이면 gap_w 는 의미 없다

## 플레이어가 실제로 들어 있는(또는 가장 가까운) 자유 구간.
## "최장" 구간은 절대 벽 탐지에는 맞지만 요구 이동량·정지 창 판정에는 틀린다 —
## 통로가 여러 개면 최장 구간이 A→B 로 바뀔 때 중심이 순간이동하고,
## 플레이어는 최장 통로로 갈 이유가 없으므로 그 이동은 요구가 아니다.
var near_w: int = 0
var near_x0: int = 0
var near_center: float = 0.0
var near_dist: float = 0.0  ## 플레이어 x 에서 그 구간까지의 거리 (0 = 안에 있다)

func _init() -> void:
	diff.resize(Tune.SCAN_CELLS + 1)

## bf: BulletField 오토로드. player_y 밴드의 탄을 (w + PLAYER_R) 만큼 부풀려 구간에 넣는다.
var _player_x: float = 0.0

func scan(bf: Node, player_x: float, player_y: float) -> void:
	_player_x = player_x
	diff.fill(0)
	in_band = 0
	var lo := player_y - Tune.BAND_HALF
	var hi := player_y + Tune.BAND_HALF
	var count: int = bf.n
	var i := 0
	while i < count:
		var by: float = bf.pos_y[i]
		var kd: int = bf.kind[i]
		var rh: float = Tune.KIND_H[kd]
		if by + rh < lo or by - rh > hi:
			i += 1
			continue
		var r: float = float(Tune.KIND_W[kd]) + Tune.PLAYER_R
		var a := int(floor(bf.pos_x[i] - r))
		var b := int(ceil(bf.pos_x[i] + r))
		if b < 0 or a > Tune.SCAN_CELLS - 1:
			i += 1
			continue
		if a < 0: a = 0
		if b > Tune.SCAN_CELLS - 1: b = Tune.SCAN_CELLS - 1
		diff[a] += 1
		diff[b + 1] -= 1
		in_band += 1
		i += 1

	var px := _player_x
	var acc := 0
	var best := 0
	var best_x0 := 0
	var run := 0
	var nw := 0
	var nx0 := 0
	var ndist := INF
	var c := 0
	while c <= Tune.SCAN_CELLS:
		if c < Tune.SCAN_CELLS:
			acc += diff[c]
		var free: bool = c < Tune.SCAN_CELLS and acc == 0
		if free:
			run += 1
			if run > best:
				best = run
				best_x0 = c - run + 1
		elif run >= Tune.SLIVER_FREE:
			# 구간 [c-run, c-1] 이 닫혔다 — 플레이어와의 거리를 잰다.
			# 자유 폭 SLIVER_FREE(D 64, Lunatic 미만) 미만은 통로로 세지 않는다 —
			# 세면 탄 옆의 1유닛 슬라이버가 "플레이어의 통로"로 잡힌다.
			var a := c - run
			var b := c - 1
			var d := 0.0
			if px < float(a):
				d = float(a) - px
			elif px > float(b):
				d = px - float(b)
			if d < ndist or (is_equal_approx(d, ndist) and run > nw):
				ndist = d
				nw = run
				nx0 = a
			run = 0
		else:
			run = 0
		c += 1
	gap_w = best
	gap_x0 = best_x0
	gap_center = float(best_x0) + float(best) * 0.5
	near_w = nw
	near_x0 = nx0
	near_center = float(nx0) + float(nw) * 0.5
	near_dist = 0.0 if is_inf(ndist) else ndist
