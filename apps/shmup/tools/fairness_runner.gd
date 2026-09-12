extends Node
## 헤드리스 1D 공정성 스캔. 게임과 같은 BulletField·Patterns·EnemyField·Stage·Fairness 를
## 쓴다 — 별도 하네스를 만들면 게임과 갈라져서 틀린 숫자를 자신 있게 보고한다.
##
## 두 모드로 잰다:
##   A) 패턴 단독 — 진단용. 어느 패턴이 원인인지 가른다.
##   B) 웨이브 합성 — 실제 판정. 스테이지 공정성은 패턴 공정성이 아니다
##      (포자낭 2기가 겹치면 틈이 절반이 된다).
##
## 판정
## 모든 폭은 **자유 폭 F**(판정 반경만큼 부풀린 뒤 남는 폭)다. 설계서 값은 중심간 D 이고
## 포자 사이에서 F = D − 32 다(Tune 의 통과 폭 단위 주석). 출력은 F 로 하고 필요한 곳에 D 를 병기한다.
##
##   FAIL  자유 칸 0 (절대 벽)          — 기하학적 하한 D 32. 어떤 조작으로도 불가능
##   FAIL  Reach1D 도달 불가            — 횡속도 300 u/s 로도 살 경로가 없다
##   FAIL  도달 폭 < 52                 — 경로는 있으나 엄지 스윕 종점 오차(±26)보다 좁다
##   WARN  F < 64 (D < 96)              — Normal 하한 미달
##
## 정지 창·전환·유지 시간은 **진단 정보**로만 출력한다. 회전 격자·이동하는 벽에서는
## "지금 통로가 오래 열려 있는가" 가 기준이 아니기 때문이다(두 도구가 엇갈린 원인).
##
## 요구 이동량은 상한값으로만 출력하고 판정에 쓰지 않는다 — tools/corridor.gd 주석 참조.
##
## 최대 요구 이동량은 틈이 좁을 때만 센다. 400유닛짜리 틈의 중심을 쫓는 것은
## 요구가 아니므로, 그때 재면 아무 요구도 없는 구간에서 454 를 보고하는 지표가 된다.

const BANDS := [640.0, 860.0, 1040.0]
const TIGHT := 200          # 이 폭 미만일 때만 "요구 이동량"으로 센다
const STILL_GAP := Tune.FREE_STILL   # F 56 (D 88) 미만이면 정지 창 필수
const STILL_WIN := 21       # 0.35초
const STILL_MOVE := 16.0
const MOVE_WIN := 36        # 0.6초
const MOVE_CAP := 250.0
## 1D 도달 판정 — 보스 러너와 **같은 기준**이다.
## 통로 유지 시간은 벽-틈(P01·P07)에는 맞지만 회전 격자(P05)·이동하는 벽(P09)에서는
## 플레이어가 옆 통로로 옮겨 가는 것이 정상이라 기준이 맞지 않는다. 실제로 두 도구가
## 같은 패턴을 두고 엇갈렸다(여기선 실패, 보스 러너에선 OK).
const V_BUDGET := 5          # 300 u/s — 전 구간 지속 횡속도 예산
const COMP_MIN := 52         # 도달 집합의 최소 연속 폭. 엄지 스윕 종점 오차 ±26 → 52
## 통로 최소 유지 시간. 반응 250~300ms + 엄지 전이 60~100ms → 24틱(400ms) 을 하한으로 둔다.
const HOLD_MIN := 24

var _fair: Fairness = null
var _fail := 0
var _warn := 0

func _ready() -> void:
	Difficulty.apply_from_cmdline()
	_fair = Fairness.new()
	print("== 1D 공정성 스캔 ==")
	print("   자유폭F: 하한=%d  Normal=%d  정지창=<%d/0.35s이동≤%d  요구이동상한=%d유닛/0.6s" % [
		Tune.FREE_FLOOR, Difficulty.free_floor(), STILL_GAP, int(STILL_MOVE), int(MOVE_CAP)])

	print("\n-- A) 패턴 단독 --")
	# Patterns.BOOK 을 훑는다. 손으로 적으면 패턴을 추가할 때 빠뜨린다 —
	# 실제로 6종 중 3종만 검사되고 있었다(P05·P09·P02 는 보스·합성 안에서만).
	for idx in Patterns.BOOK.size():
		var b: Dictionary = Patterns.BOOK[idx]
		var ticks := int(b["solo_period"]) * 4 + 420
		_scan("%s %s" % [b["id"], Patterns.NAMES[idx]],
			func(t: int, p: Vector2) -> void: Patterns.emit_solo(idx, t, t, p), ticks)

	print("\n-- B) 웨이브 합성 (실제 판정) --")
	var ef := EnemyField.new()
	_scan("30초 루프", func(t: int, p: Vector2) -> void:
		_waves(ef, t, p), Stage.LOOP_TICKS, ef)

	print("\n== 실패 %d · 경고 %d ==" % [_fail, _warn])
	get_tree().quit(1 if _fail > 0 else 0)

var _cursor := 0
func _waves(ef: EnemyField, tick: int, p: Vector2) -> void:
	if tick == 0:
		ef.clear()
		_cursor = 0
	while _cursor < Stage.WAVES.size():
		var w: Array = Stage.WAVES[_cursor]
		if int(w[0]) > tick:
			break
		ef.spawn_wave(tick, w)
		_cursor += 1
	ef.step(tick, p)

func _scan(label: String, emit: Callable, ticks: int, ef: EnemyField = null) -> void:
	for band in BANDS:
		BulletField.clear()
		if ef != null:
			ef.clear()
		var p := Vector2(Tune.PF_W * 0.5, band)
		var gaps := PackedInt32Array()
		var rch := Reach1D.new()
		var comp_min := Tune.SCAN_CELLS
		var flow_x := PackedFloat32Array()
		var flow_acc := 0.0
		var cor := Corridor.new()
		for t in ticks:
			emit.call(t, p)
			BulletField.step_and_collide(t, p, p, true)
			_fair.scan(BulletField, p.x, p.y)
			gaps.append(_fair.gap_w if _fair.in_band > 0 else -1)
			# 밴드에 탄이 없는 틱도 반드시 기록한다 — 건너뛰면 히스토리 인덱스가
			# 시간과 어긋나고 0.35초/0.6초 창 계산이 통째로 틀린다.
			cor.update(_fair, p.x)
			rch.step_mask(rch.from_fairness(_fair), V_BUDGET, t)
			if rch.alive:
				comp_min = mini(comp_min, rch.min_comp)
			flow_x.append(flow_acc)
			flow_acc += BulletField.flow_u(p.y, t) * Tune.DT

		var min_gap := Tune.SCAN_CELLS
		var min_tick := -1
		var sum := 0
		var samples := 0
		var below_normal := 0
		var walls := 0
		var peak := BulletField.peak_n
		var min_track := cor.min_width()
		var still_viol := cor.still_violations(STILL_GAP, STILL_WIN, STILL_MOVE, flow_x)
		var max_move := cor.max_demand(MOVE_WIN, TIGHT)
		# 통로 유지 시간 — 통과 폭 이상으로 열려 있던 연속 구간
		var hold: Array = cor.hold_times(Difficulty.free_floor())
		for t in ticks:
			var g := gaps[t]
			if g < 0:
				continue                    # 밴드에 탄이 없다
			samples += 1
			sum += g
			if g == 0:
				walls += 1
			if g < Difficulty.free_floor():
				below_normal += 1
			if g < min_gap:
				min_gap = g
				min_tick = t
		if samples == 0:
			print("  %-14s y%4d : 밴드 도달 탄 0" % [label, int(band)])
			continue

		var flags := PackedStringArray()
		if min_gap < Tune.FREE_FLOOR:
			flags.append("FAIL:절대벽"); _fail += 1
		if not rch.alive:
			flags.append("FAIL:도달불가@t%d" % rch.died_at); _fail += 1
		elif comp_min < COMP_MIN:
			flags.append("FAIL:정밀%d" % comp_min); _fail += 1
		if still_viol > 0:
			flags.append("정지창%d" % still_viol)
		# 유지 시간은 **진단 정보**다. 회전 격자·이동하는 벽에서는 플레이어가 옆 통로로
		# 옮겨 가는 것이 정상이라 "지금 통로가 오래 열려 있는가" 가 기준이 아니다 —
		# 판정은 Reach1D 가 한다(두 도구가 같은 패턴을 두고 엇갈린 원인).
		if int(hold[2]) > 0 and int(hold[0]) < HOLD_MIN:
			flags.append("유지%d틱@t%d" % [int(hold[0]), int(hold[3])])
		# 통로 간 이동은 탄막의 정상 동작이다. 엄지가 낼 수 없는 거리를 강요하는지는
		# Reach1D 의 도달폭이 이미 잡는다.
		if cor.forced > 0:
			flags.append("전환%d(%.0fu)" % [cor.forced, cor.forced_jump])
		if walls > 0:
			flags.append("WARN:절대벽%d" % walls); _warn += 1
		if min_gap < Difficulty.free_floor() and min_gap >= Tune.FREE_FLOOR:
			flags.append("WARN:F<64"); _warn += 1
		if flags.is_empty():
			flags.append("OK")
		print("  %-16s y%4d : 최장min=%3d avg=%3d 도달폭=%3d 통로min=%3d 유지min=%3d peak=%3d  %s" % [
			label, int(band), min_gap, sum / samples,
			comp_min if rch.alive else 0, min_track, int(hold[0]), peak, " ".join(flags)])
