class_name Corridor
## 통로 추적기 — 헤드리스 계측 전용. 게임의 매 틱 경로에는 넣지 않는다.
##
## "가장 가까운 통로"의 중심 이동을 요구 이동량으로 재면 틀린다: 통로가 표류해
## 지나가면 다음 통로가 가장 가까워지며 중심이 pitch 만큼 점프하고, 플레이어는
## 그 점프를 할 필요가 없다(원래 통로를 따라가면 된다).
##
## 그래서 통로를 겹침으로 동일시해 따라간다. 겹침이 끊긴 틱만이 진짜 강제 전환이고,
## 그때의 점프 거리만이 진짜 요구 이동량이다.

var runs_a := PackedInt32Array()   # 이번 틱 자유 구간의 시작
var runs_b := PackedInt32Array()   # 끝(포함)
var track_a: int = -1
var track_b: int = -1
var forced: int = 0                ## 강제 전환 횟수
var forced_jump: float = 0.0       ## 그중 최대 점프 거리
var viol_ticks := PackedInt32Array()
var gap_hist := PackedInt32Array()      ## 같은 틱의 최장 자유 구간 — 대안 존재 여부
var center_hist := PackedFloat32Array()
var width_hist := PackedInt32Array()

func reset() -> void:
	track_a = -1
	track_b = -1
	forced = 0
	forced_jump = 0.0
	center_hist.clear()
	width_hist.clear()
	gap_hist.clear()
	viol_ticks.clear()

## 매 틱 호출. Fairness 의 diff 배열을 다시 쓰지 않고 직접 자유 구간을 뽑는다.
func update(fair: Fairness, player_x: float) -> void:
	runs_a.clear()
	runs_b.clear()
	var acc := 0
	var run := 0
	var c := 0
	while c <= Tune.SCAN_CELLS:
		var free: bool = c < Tune.SCAN_CELLS
		if free:
			acc += fair.diff[c]
			free = acc == 0
		if free:
			run += 1
		else:
			if run >= Tune.MIN_GAP_UNITS:
				runs_a.append(c - run)
				runs_b.append(c - 1)
			run = 0
		c += 1

	if runs_a.is_empty():
		# 절대 벽 — 통로가 없다. 추적을 끊고 기록에 남긴다.
		track_a = -1
		center_hist.append(center_hist[center_hist.size() - 1] if center_hist.size() > 0 else player_x)
		width_hist.append(0)
		gap_hist.append(0)
		return

	var pick := -1
	if track_a >= 0:
		# 직전 추적 구간과 가장 많이 겹치는 구간
		var best_ov := 0
		for i in runs_a.size():
			var ov := mini(runs_b[i], track_b) - maxi(runs_a[i], track_a) + 1
			if ov > best_ov:
				best_ov = ov
				pick = i
	if pick < 0:
		# 겹침 없음 = 강제 전환. 가장 가까운 구간으로 뛴다.
		var prev_c := float(track_a + track_b) * 0.5 if track_a >= 0 else player_x
		var best_d := INF
		for i in runs_a.size():
			var cc := float(runs_a[i] + runs_b[i]) * 0.5
			var d := absf(cc - prev_c)
			if d < best_d:
				best_d = d
				pick = i
		if track_a >= 0:
			forced += 1
			forced_jump = maxf(forced_jump, best_d)
	track_a = runs_a[pick]
	track_b = runs_b[pick]
	center_hist.append(float(track_a + track_b) * 0.5)
	width_hist.append(track_b - track_a + 1)
	gap_hist.append(fair.gap_w)

## 창 크기 win 틱 안의 최대 중심 이동 — **상한값이며 판정에 쓰지 않는다.**
##
## 정직하게: 1D 스캔으로는 이 값을 신뢰할 수 있게 정의하지 못했다. 통로가 넓게
## 열리는 짧은 순간(행간 공백 2.4틱)에 통로 정체성이 흐려지고, 그것을 배제하려고
## (a) 창 전체 좁음 강제 → 항상 0, (b) 경계 속도 클램프 → 통로가 인공적으로 짜부라져
## 위반 폭증, 두 방향 모두 실패했다. 실제 통로는 새 행이 들어올 때 표류량만큼
## 점프하기 때문이다.
##
## 그래서 이 값은 "이보다 크지는 않다"는 상한으로만 읽고, FAIL/WARN 게이트는
## 최장min · 정지창(조류 상대) · 강제전환 · 절대벽 네 개로만 낸다.
## 틀려도 "통과했다"고 보고하는 지표를 만들지 않는 것이 이 도구의 존재 이유다.
## 진짜 요구 이동량은 실기 RunLog 의 플레이어 궤적으로 잰다.
func max_demand(win: int, tight: int) -> float:
	var m := 0.0
	var n := center_hist.size()
	# 창 안의 모든 틱이 좁아야 지속 추적 요구다.
	# 중간에 통로가 화면 전체로 열리는 틱이 끼면(행간 공백은 2.4틱뿐이다) 통로 정체성이
	# 흐려지고, 양 끝만 보면 그 구간이 "600유닛 이동 요구"로 잡힌다. 실제로는
	# 그 순간 아무 압력도 없었으므로 요구가 아니다.
	for i in range(n - win):
		if width_hist[i] > 0 and width_hist[i] < tight \
				and width_hist[i + win] > 0 and width_hist[i + win] < tight:
			m = maxf(m, absf(center_hist[i + win] - center_hist[i]))
	return m

## 정지 창 규칙 — 폭 still_gap 미만 구간은 직전 win 틱간 중심 이동 ≤ move 여야 한다.
##
## 단, 조류를 타고 균일하게 흐르는 통로에까지 이 규칙을 적용하면 P07 의 설계 의도
## ("타면 아무것도 안 해도 통로 안에 머문다")를 위반으로 잡는다. 문제가 되는 것은
## "좁으면서 예측 불가하게" 움직이는 통로다. 그래서 조류 적분값이 예측하는 변위를
## 빼고 남은 잔차로 판정한다 — 이것이 훅("조류를 읽으면 통로를 예측할 수 있다")의
## 직접적인 수치 검증이고, 게이트 1 지표 ② 의 헤드리스판이다.
func still_violations(still_gap: int, win: int, move: float,
		flow_x: PackedFloat32Array = PackedFloat32Array()) -> int:
	var use_flow := flow_x.size() == center_hist.size()
	var v := 0
	for i in range(win, center_hist.size()):
		var w := width_hist[i]
		if w <= 0 or w >= still_gap:
			continue
		# 정지 창 규칙은 '반드시 통과해야 하는' 좁은 틈에만 적용된다.
		# 같은 틱에 Normal 통과 가능한 통로(≥96)가 따로 열려 있으면 그 슬라이버는
		# 공정성 문제가 아니다 — 아무도 그리로 가지 않는다. 이 조건이 없으면
		# 패턴의 희박한 꼬리와 이완 중인 탄 사이의 60유닛짜리 틈이 전부 위반으로 잡힌다.
		if gap_hist[i] >= int(Tune.GAP_NORMAL):
			continue
		var d := center_hist[i] - center_hist[i - win]
		if use_flow:
			d -= flow_x[i] - flow_x[i - win]
		if absf(d) > move:
			v += 1
			if viol_ticks.size() < 24:
				viol_ticks.append(i)
	return v

func min_width() -> int:
	var m := Tune.SCAN_CELLS
	for w in width_hist:
		if w > 0:
			m = mini(m, w)
	return m
