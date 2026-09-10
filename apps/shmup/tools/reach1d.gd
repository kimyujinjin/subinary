class_name Reach1D
## 고정 y 밴드에서 "횡속도 v 로 계속 살아남을 경로가 있는가" — 1차원 도달 가능성.
##
##   R(t+1) = dilate(R(t), v) ∩ free(t+1)        R(0) = free(0)
##
## 통로 유지 시간 지표는 "지금 있는 통로가 오래 열려 있는가" 를 묻는다. 벽-틈 패턴(P01·P07)
## 에는 맞지만, 틈이 매 줄 옮겨 가는 벽(P09)이나 격자(P05)에서는 플레이어가 원래 옆 통로로
## 옮겨 가야 하므로 판정 기준이 맞지 않는다. 이 점화식은 "옮겨 갈 수 있는가" 까지 답한다.
##
## 설계서가 기각한 것은 (x, y, t) 2D BFS 다. 이것은 고정 y 에서 720칸 비트맵의 점화식이고,
## y 방향 회피를 쓰지 않으므로 보수적이다(여기서 살면 실제로도 산다).
## 단위 테스트: tools/invariants_runner.gd 의 _reach_cases().

var reach := PackedByteArray()
var _free := PackedByteArray()
var _pre := PackedInt32Array()
var alive: bool = true
var died_at: int = -1
var min_comp: int = Tune.SCAN_CELLS     ## 도달 집합 중 가장 넓은 연속 구간의 최솟값 = 정밀도 요구

func _init() -> void:
	reach.resize(Tune.SCAN_CELLS)
	_free.resize(Tune.SCAN_CELLS)
	_pre.resize(Tune.SCAN_CELLS + 1)
	reset()

func reset() -> void:
	reach.fill(1)
	alive = true
	died_at = -1
	min_comp = Tune.SCAN_CELLS

## free: 1 = 안전한 중심 위치. Fairness.diff 에서 뽑는다(from_fairness).
func step_mask(free: PackedByteArray, v: int, t: int) -> void:
	if not alive:
		return
	var n := Tune.SCAN_CELLS
	# 딜레이션: 누적합으로 [i-v, i+v] 에 도달 칸이 하나라도 있으면 도달 가능
	_pre[0] = 0
	for i in n:
		_pre[i + 1] = _pre[i] + reach[i]
	var best := 0
	var run := 0
	var any := false
	for i in n:
		var a := maxi(0, i - v)
		var b := mini(n, i + v + 1)
		var r := 1 if (free[i] == 1 and _pre[b] - _pre[a] > 0) else 0
		reach[i] = r
		if r == 1:
			any = true
			run += 1
			if run > best:
				best = run
		else:
			run = 0
	if not any:
		alive = false
		died_at = t
		min_comp = 0
		return
	min_comp = mini(min_comp, best)

func from_fairness(fair: Fairness) -> PackedByteArray:
	var acc := 0
	for i in Tune.SCAN_CELLS:
		acc += fair.diff[i]
		_free[i] = 1 if (acc == 0 or fair.in_band == 0) else 0
	return _free
