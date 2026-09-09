extends Node
## 패턴 값 스윕. 추측하지 않고 격자로 재서 고른다.
## 게임과 같은 Patterns.p01_ex / p07_ex 를 호출하므로 튜닝값과 게임이 갈라지지 않는다.

const BANDS := [640.0, 860.0, 1040.0]
const XS := [120.0, 360.0, 600.0]
const STILL_GAP := 88
const STILL_WIN := 21
const STILL_MOVE := 16.0
const MOVE_WIN := 36

var _fair: Fairness = null

func _ready() -> void:
	_fair = Fairness.new()
	print("== P01 스윕 · 포자낭 2기(x=200,520) 실제 배치 ==")
	print("   arc  cnt vol | 최장min 통로min 정지창 요구이동(상한) peak 강제전환(최대점프) 절대벽")
	for arc in [160.0, 140.0, 120.0, 104.0]:
		for cnt in [11, 13, 15]:
			for vol in [36, 42, 50]:
				var r := _run_p01(arc, cnt, vol)
				print("   %5.0f %3d %3d | %6d %6d %6d %7.0f %4d %6d(%4.0f) %5d" % [
					arc, cnt, vol, r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7]])

	print("\n== P07 스윕 · 단일 발광관(x=360) ==")
	print("   pitch emit amp | 최장min 통로min 정지창 요구이동(상한) peak 행간격 강제전환(최대점프)")
	for pitch in [128.0, 136.0, 144.0]:
		for emit in [12, 13, 14]:
			for amp in [10.0, 18.0, 24.0]:
				var r := _run_p07(pitch, emit, amp, 0.3)
				print("   %5.0f %4d %3.0f | %6d %6d %6d %7.0f %4d %6.1f %6d(%4.0f)" % [
					pitch, emit, amp, r[0], r[1], r[2], r[3], r[4],
					Patterns.P07_VY * float(emit) / 60.0, r[5], r[6]])
	get_tree().quit(0)

func _run_p01(arc: float, cnt: int, vol: int) -> Array:
	var ticks := vol * Patterns.P01_VOLLEYS + 420
	return _measure(ticks, func(t: int, p: Vector2) -> void:
		Patterns.p01_ex(t, 200.0, 230.0, arc, cnt, Patterns.P01_SPEED, vol, Patterns.P01_VOLLEYS)
		Patterns.p01_ex(t, 520.0, 230.0, arc, cnt, Patterns.P01_SPEED, vol, Patterns.P01_VOLLEYS))

func _run_p07(pitch: float, emit: int, amp: float, ph: float) -> Array:
	return _measure(900, func(t: int, p: Vector2) -> void:
		Patterns.p07_ex(t, t, 360.0, 220.0, pitch, emit, amp, ph))

## 반환 [최장min, 통로min, 정지창위반, 최대요구이동, peak]
func _measure(ticks: int, emit: Callable) -> Array:
	var min_gap := Tune.SCAN_CELLS
	var min_track := Tune.SCAN_CELLS
	var still := 0
	var max_move := 0.0
	var forced := 0
	var forced_jump := 0.0
	var walls := 0
	var peak := 0
	var cor := Corridor.new()
	for band in BANDS:
		for xx in XS:
			BulletField.clear()
			cor.reset()
			var p := Vector2(xx, band)
			var flow_x := PackedFloat32Array()
			var flow_acc := 0.0
			for t in ticks:
				emit.call(t, p)
				BulletField.step_and_collide(t, p, p, true)
				_fair.scan(BulletField, p.x, p.y)
				if _fair.in_band > 0:
					min_gap = mini(min_gap, _fair.gap_w)
					if _fair.gap_w == 0:
						walls += 1
				# 밴드에 탄이 없는 틱도 반드시 기록한다 — 건너뛰면 히스토리 인덱스가
				# 시간과 어긋나고, 0.35초/0.6초 창 계산이 통째로 틀린다.
				cor.update(_fair, p.x)
				flow_x.append(flow_acc)
				flow_acc += BulletField.flow_u(p.y, t) * Tune.DT
			peak = maxi(peak, BulletField.peak_n)
			min_track = mini(min_track, cor.min_width())
			still += cor.still_violations(STILL_GAP, STILL_WIN, STILL_MOVE, flow_x)
			max_move = maxf(max_move, cor.max_demand(MOVE_WIN, 200))
			forced += cor.forced
			forced_jump = maxf(forced_jump, cor.forced_jump)
	return [min_gap, min_track, still, max_move, peak, forced, forced_jump, walls]
