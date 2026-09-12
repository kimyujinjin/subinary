extends Node
## 6구역 타임라인 자가 검증 — "각 구역을 무피격으로 통과할 수 있는가".
##
## 게이트 질문이 "5분을 무피격으로" 가 아니라 "구역별로" 인 이유: 구역은 무피격 보너스
## 단위이자 연습 모드 진입 단위다(설계서 §7). 그래서 Reach1D 를 **구역 경계에서 리셋**한다 —
## 그 구역만 연습하는 플레이어는 경계에서 자유로운 위치로 들어온다.
## 탄은 리셋하지 않는다. 앞 구역의 탄이 넘어오는 것은 실제 게임에서 일어나는 일이다.
##
## 판정은 fairness_runner 와 **같은 정의**를 쓴다(도달 불가 / 도달폭 < 52 / 절대벽).
## 다른 정의를 쓰면 두 도구가 같은 구간을 두고 엇갈리고, 그때 어느 쪽이 맞는지 알 수 없다.
##
## 구역 6(해구저)은 보스다 — tools/boss_runner.gd 의 페이즈별 측정이 담당한다.
## 여기서 보스를 또 돌리면 같은 것을 두 정의로 재게 된다.

const BANDS := [640.0, 860.0, 1040.0]
const V_BUDGET := 5
const COMP_MIN := 52

var _fair: Fairness = null
var _fail := 0

func _ready() -> void:
	_fair = Fairness.new()
	for a in OS.get_cmdline_user_args():
		if a == "--zone5-sweep":
			_sweep5()
			return
	print("== 6구역 무피격 가능성 (횡속 예산 %d u/s · 자탄 없음 = 최악) ==" % (V_BUDGET * 60))
	print("  구역                 구간      | 최장min 도달폭min peak  적수 | 판정")
	var rows := _scan(Stage.STAGE_WAVES)
	for z in rows.size():
		var r: Array = rows[z]
		var flags := PackedStringArray()
		if int(r[3]) == 0:
			flags.append("FAIL:도달불가@t%d" % int(r[4]))
			_fail += 1
		elif int(r[2]) < COMP_MIN:
			flags.append("FAIL:정밀%d" % int(r[2]))
			_fail += 1
		if int(r[0]) < Tune.FREE_FLOOR:
			flags.append("FAIL:절대벽")
			_fail += 1
		elif int(r[0]) < Tune.FREE_NORMAL:
			flags.append("WARN:F<%d" % Tune.FREE_NORMAL)
		if int(r[6]) == 0:
			flags.append("신규 적 0 — 휴식 구역")
		if flags.is_empty():
			flags.append("OK")
		print("  %d %-10s %s | %6d %8d %4d %6d | %s" % [
			z + 1, Stage.ZONE_NAMES[z], _span(z), r[0], r[2], int(r[1]), int(r[6]),
			" ".join(flags)])
	print("\n  가르치는 것")
	for z in Stage.ZONES.size():
		print("    %d %-10s %s" % [z + 1, Stage.ZONE_NAMES[z], Stage.ZONES[z][1]])
	print("\n== 실패 %d ==" % _fail)
	get_tree().quit(1 if _fail > 0 else 0)

func _span(z: int) -> String:
	var a := int(Stage.ZONES[z][0])
	var b: int = int(Stage.ZONES[z + 1][0]) if z + 1 < Stage.ZONES.size() else Stage.STAGE_TICKS
	return "%d:%02d–%d:%02d" % [a / 3600, a / 60 % 60, b / 3600, b / 60 % 60]

## 구역 수 × [최장min, peak, 도달폭min, 생존, 사망틱, 탄있는틱, 등장 적 수]
func _scan(waves: Array) -> Array:
	var nz := Stage.ZONES.size() - 1        # 마지막 구역은 보스 — 여기서 안 본다
	var out: Array = []
	for z in nz:
		out.append([Tune.SCAN_CELLS, 0, Tune.SCAN_CELLS, 1, -1, 0, 0])
	var ef := EnemyField.new()
	for band in BANDS:
		BulletField.clear()
		BulletField.reset_flow()
		ef.clear()
		var cursor := 0
		var p := Vector2(Tune.PF_W * 0.5, band)
		var rch := Reach1D.new()
		var zone := 0
		var spawned := 0
		for t in Stage.BOSS_AT:
			var z := Stage.zone_of(t)
			if z != zone:
				# 구역 경계 — 연습 모드 진입점이다. 도달 집합만 자유로 되돌린다.
				rch.reset()
				zone = z
			while cursor < waves.size():
				var w: Array = waves[cursor]
				if int(w[0]) > t:
					break
				var kind := int(w[1])
				var y0: float = -50.0 if kind == 0 else float(w[3])
				ef.spawn(t, kind, float(w[2]), y0, float(w[3]), int(w[4]), int(w[5]), float(w[6]))
				cursor += 1
				spawned += 1
				out[Stage.zone_of(int(w[0]))][6] = int(out[Stage.zone_of(int(w[0]))][6]) + 1
			ef.step(t, p)
			ef.kills.clear()       # 자탄이 없으니 격파도 없다. 쌓이면 메모리만 먹는다
			BulletField.step_and_collide(t, p, p, true)
			_fair.scan(BulletField, p.x, p.y)
			var row: Array = out[z]
			if _fair.in_band > 0:
				row[0] = mini(int(row[0]), _fair.gap_w)
				row[5] = int(row[5]) + 1
			row[1] = maxi(int(row[1]), BulletField.n)
			rch.step_mask(rch.from_fairness(_fair), V_BUDGET, t)
			if rch.alive:
				row[2] = mini(int(row[2]), rch.min_comp)
			elif int(row[3]) == 1:
				row[3] = 0
				row[4] = t
	BulletField.reset_flow()
	BulletField.clear()
	# 탄이 한 발도 안 온 구역은 최장폭이 초기값 그대로다 — 720 으로 보고하면 오해를 부른다.
	for r in out:
		if int(r[5]) == 0:
			r[0] = Tune.SCAN_CELLS
	return out


## 구역 5 손잡이 실측. 발광관 2기의 격자가 겹쳐 통로가 절반이 되는 구간을 넓힌다.
## 손잡이는 둘 뿐이다 — 두 기체의 시차와 x 분리. hold 를 줄이면 격자 자체가 짧아져
## "조류를 타면 통로가 유지된다" 를 가르칠 시간이 없어지므로 손잡이로 쓰지 않는다.
func _sweep5() -> void:
	print("== 구역 5 손잡이 스윕 (발광관 2기) ==")
	print("  시차  x분리 | 최장min 도달폭min peak | 판정")
	var base: Array = Stage.STAGE_WAVES
	for lag in [180, 300, 420]:
		for sep in [240, 320, 400]:
			var waves: Array = []
			for w in base:
				var row: Array = w.duplicate()
				if int(row[0]) == 7800:
					row[2] = 360.0 - float(sep) * 0.5
				elif int(row[0]) == 7980:
					row[0] = 7800 + lag
					row[2] = 360.0 + float(sep) * 0.5
				waves.append(row)
			waves.sort_custom(func(a: Array, b: Array) -> bool: return int(a[0]) < int(b[0]))
			var r: Array = _scan(waves)[4]
			var verdict := "OK"
			if int(r[3]) == 0:
				verdict = "FAIL:도달불가"
			elif int(r[2]) < COMP_MIN:
				verdict = "FAIL:정밀"
			elif int(r[0]) < Tune.FREE_NORMAL:
				verdict = "WARN:F<%d" % Tune.FREE_NORMAL
			print("  %4d  %5d | %6d %8d %4d | %s" % [lag, sep, r[0], r[2], int(r[1]), verdict])
	get_tree().quit(0)
