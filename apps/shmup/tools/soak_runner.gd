extends Node
## 누적 확인 — 30초 루프를 5회 돌려 활성 탄 수가 정상 상태로 수렴하는지 본다.
## 자탄을 쏘지 않는 최악 케이스(적이 방출 창을 전부 채운다)로 잰다.
func _ready() -> void:
	var ef := EnemyField.new()
	var cursor := 0
	var p := Vector2(360.0, 1040.0)
	print("루프  peak  end")
	for loop in 5:
		BulletField.peak_n = 0
		for i in Stage.LOOP_TICKS:
			var t := loop * Stage.LOOP_TICKS + i
			if i == 0:
				cursor = 0
			while cursor < Stage.WAVES.size():
				var w: Array = Stage.WAVES[cursor]
				if int(w[0]) > i:
					break
				var kind := int(w[1])
				ef.spawn(t, kind, float(w[2]), -50.0 if kind == 0 else float(w[3]),
					float(w[3]), int(w[4]), int(w[5]), float(w[6]))
				cursor += 1
			ef.step(t, p)
			BulletField.step_and_collide(t, p, p, true)
		print("%4d %5d %4d" % [loop, BulletField.peak_n, BulletField.n])
	_full_stage()
	get_tree().quit(0)

## 5분 타임라인 1회 — 웨이브 → 보스 합류까지 한 번에 돌린다.
## 구역 러너는 BOSS_AT 에서 멈추고 보스 러너는 페이즈를 격리하므로,
## "웨이브가 남긴 탄 위로 보스가 들어오는" 구간은 여기서만 지나간다.
func _full_stage() -> void:
	BulletField.clear()
	BulletField.reset_flow()
	BulletField.peak_n = 0
	var ef := EnemyField.new()
	var p := Vector2(360.0, 1040.0)
	var cursor := 0
	var boss: Boss = null
	var join_n := -1
	print("\n5분 타임라인 — 구역  peak  탄  적")
	var zone := -1
	for t in Stage.STAGE_TICKS:
		var z := Stage.zone_of(t)
		if z != zone:
			if zone >= 0:
				print("  %d %-10s %5d %4d %3d" % [zone + 1, Stage.ZONE_NAMES[zone],
						BulletField.peak_n, BulletField.n, ef.n])
			BulletField.peak_n = 0
			zone = z
		if boss == null and t >= Stage.BOSS_AT:
			boss = Boss.new()
			boss.reset(t)
			join_n = BulletField.n
		while cursor < Stage.STAGE_WAVES.size():
			var w: Array = Stage.STAGE_WAVES[cursor]
			if int(w[0]) > t:
				break
			var kind := int(w[1])
			ef.spawn(t, kind, float(w[2]), -50.0 if kind == 0 else float(w[3]),
				float(w[3]), int(w[4]), int(w[5]), float(w[6]))
			cursor += 1
		if boss != null:
			boss.step(t, p)
		ef.step(t, p)
		ef.kills.clear()
		BulletField.step_and_collide(t, p, p, true)
	print("  %d %-10s %5d %4d %3d" % [zone + 1, Stage.ZONE_NAMES[zone],
			BulletField.peak_n, BulletField.n, ef.n])
	print("  보스 합류 시 잔탄 %d · 종료 시 남은 적 %d (0 이어야 한다)" % [join_n, ef.n])
	BulletField.reset_flow()
