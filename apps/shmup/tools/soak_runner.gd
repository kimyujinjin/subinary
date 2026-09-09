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
	get_tree().quit(0)
